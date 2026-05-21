import { V0MessageInsightStore } from '../forum/messageInsightStore';
import { V0MessageStore } from '../forum/messageStore';
import {
  V0AgentReference,
  V0PersonaDistillPayload,
  V0PersonaDistillResult,
  V0PersonaEvidenceRecord,
  V0PersonaEvidenceBucket,
  V0PersonaProfileJsonV2,
  V0PersonaProfileResult,
  V0ParsedForumMessage,
  V0StoredForumMessage,
} from '../shared/types';
import { LLMService } from '../../core/llm';
import { V0PersonaStore, V0PersonaChunkSeed, V0PersonaChunkView } from './personaStore';
import { V0MarketDataProvider } from '../market/marketBinding';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { toBeijingISOString } from '../shared/time';

type PersonaAxis = {
  key: string;
  label: string;
  query: string;
};

const PERSONA_AXES: PersonaAxis[] = [
  { key: 'stance', label: '整体立场', query: '这个作者对市场整体偏多还是偏空，语气更积极还是更谨慎' },
  { key: 'style', label: '表达风格', query: '这个作者更偏向实盘、复盘、推演、还是情绪表达' },
  { key: 'horizon', label: '时间尺度', query: '这个作者更关注短线、波段、还是中长期' },
  { key: 'risk', label: '风险偏好', query: '这个作者更激进还是更保守，是否经常追涨杀跌' },
  { key: 'theme', label: '主题偏好', query: '这个作者经常关注哪些股票、题材、板块和行情线索' },
];

const DEFAULT_AXIS_TOP_K = 20;
const DEFAULT_EVIDENCE_POOL_SIZE = 300;
const PROFILE_PROMPT_EVIDENCE_LIMIT = 120;
const PROFILE_PROMPT_RECENT_LIMIT = 40;
const V2_PROFILE_PROMPT_EVIDENCE_LIMIT = 260;
const V2_ANALYSIS_EVIDENCE_LIMIT = 80;

const PERSONA_V2_BUCKETS: Array<{
  key: V0PersonaEvidenceBucket;
  label: string;
  query: string;
  role: string;
}> = [
  {
    key: 'longformTheory',
    label: '长篇理论',
    query: '作者长篇解释市场框架、交易体系、复盘方法和底层经验的内容',
    role: '抽取稳定方法论和底层规则',
  },
  {
    key: 'intradayDecision',
    label: '盘中决策',
    query: '作者盘中对指数、个股、板块、买卖点、承接和回封的即时判断',
    role: '抽取即时判断流程和触发条件',
  },
  {
    key: 'riskWarning',
    label: '风险提示',
    query: '作者提示风险、否定买点、提醒不追、失败复盘、谨慎观察的内容',
    role: '抽取风控、失效和仓位边界',
  },
  {
    key: 'sectorStockReasoning',
    label: '板块个股',
    query: '作者分析具体股票、板块、题材、产业链和资金承接的内容',
    role: '抽取选股选板块逻辑',
  },
  {
    key: 'marketStructure',
    label: '市场结构',
    query: '作者分析指数、情绪、黄白线、量能、风格切换、周期位置的内容',
    role: '抽取大盘和结构判断变量',
  },
  {
    key: 'expressionStyle',
    label: '表达风格',
    query: '作者常用语气、句式、确定性表达、反讽、提醒和复盘表达',
    role: '抽取可识别表达 DNA',
  },
  {
    key: 'recentSignals',
    label: '近期信号',
    query: '作者最近一段时间的新关注、新判断、新变化和短期线索',
    role: '补充近期漂移和新主题',
  },
  {
    key: 'contradictionCandidates',
    label: '矛盾候选',
    query: '作者观点变化、前后判断可能冲突、强弱切换或需要人工确认的内容',
    role: '识别矛盾和边界',
  },
];

type V2BucketAnalysis = {
  bucket: V0PersonaEvidenceBucket;
  label: string;
  findings: string[];
  rules: string[];
  contradictions: string[];
  confidence: number;
};

interface HistoricalMessageRow {
  id: number;
  threadKey: string;
  floorId: string;
  authorName: string;
  postedAt: string;
  rawContent: string;
  normalizedContent: string;
  sourceUrl: string;
}

export interface V0PersonaRebuildOptions {
  force?: boolean;
  version?: 1 | 2;
  fullHistory?: boolean;
  maxChunks?: number;
  axisTopK?: number;
  evidencePoolSize?: number;
  recentChunkLimit?: number;
}

export class V0PersonaService {
  constructor(
    private readonly database: Database.Database,
    private readonly personaStore: V0PersonaStore,
    private readonly insightStore: V0MessageInsightStore,
    private readonly messageStore: V0MessageStore,
    private readonly llmService: LLMService = new LLMService(),
    private readonly marketDataProvider?: V0MarketDataProvider
  ) {}

  indexStoredMessages(threadKey: string, messages: Array<V0StoredForumMessage | V0ParsedForumMessage>): void {
    for (const message of messages) {
      this.indexMessage(threadKey, message);
    }
  }

  bootstrapHistoricalMessages(maxMessages?: number): { indexedMessageCount: number; indexedChunkCount: number } {
    const safeLimit =
      typeof maxMessages === 'number' && Number.isInteger(maxMessages) && maxMessages > 0
        ? maxMessages
        : undefined;
    const rows = this.getHistoricalMessages(safeLimit);
    let indexedChunkCount = 0;

    for (const row of rows) {
      const message = {
        id: row.id,
        threadKey: row.threadKey,
        floorId: row.floorId,
        authorName: row.authorName,
        postedAt: row.postedAt,
        rawContent: row.rawContent,
        normalizedContent: row.normalizedContent,
        sourceUrl: row.sourceUrl,
      };
      const chunks = this.buildChunks(message);
      indexedChunkCount += chunks.length;
      this.indexMessage(row.threadKey, message);
    }

    return {
      indexedMessageCount: rows.length,
      indexedChunkCount,
    };
  }

  async runDistillation(payload: V0PersonaDistillPayload = {}): Promise<V0PersonaDistillResult> {
    const shouldBootstrap = payload.bootstrap ?? this.getIndexedMessageCount() === 0;
    const bootstrapResult = shouldBootstrap
      ? this.bootstrapHistoricalMessages(payload.maxMessages)
      : { indexedMessageCount: 0, indexedChunkCount: 0 };

    const targetAuthors = this.resolveDistillationTargets(payload.authorNames);
    const profiles = [];
    for (const authorName of targetAuthors) {
      profiles.push(
        await this.rebuildAuthorProfile(authorName, {
          force: payload.force,
          version: payload.version,
          fullHistory: payload.fullHistory,
          maxChunks: payload.maxChunks,
          axisTopK: payload.axisTopK,
          evidencePoolSize: payload.evidencePoolSize,
          recentChunkLimit: payload.recentChunkLimit,
        })
      );
    }

    return {
      bootstrapped: shouldBootstrap,
      indexedMessageCount: bootstrapResult.indexedMessageCount,
      indexedChunkCount: bootstrapResult.indexedChunkCount,
      processedAuthors: profiles.length,
      profiles,
      targetAuthors,
    };
  }

  indexMessage(threadKey: string, message: V0StoredForumMessage | V0ParsedForumMessage): void {
    const chunks = this.buildChunks(message);

    chunks.forEach((chunkText, chunkIndex) => {
      this.personaStore.upsertMessageChunk({
        messageId: 'id' in message ? message.id : this.lookupMessageId(threadKey, message),
        threadKey,
        floorId: message.floorId,
        authorName: message.authorName,
        chunkIndex,
        chunkText,
        chunkHash: this.hashChunk(chunkText),
        sourceUrl: message.sourceUrl,
        sourcePostedAt: message.postedAt,
      });
    });
  }

  async rebuildAuthorProfile(
    authorName: string,
    options: V0PersonaRebuildOptions = {}
  ): Promise<V0PersonaProfileResult> {
    const profileRunId = this.personaStore.createProfileRun({
      authorName,
      triggerSource: 'agent',
    });

    try {
      const targetVersion = options.version ?? 2;
      const useFullHistory = targetVersion === 2 ? options.fullHistory !== false : false;
      const existingProfile = this.personaStore.getAuthorProfile(authorName);
      if (
        existingProfile &&
        !options.force &&
        existingProfile.status === 'ready' &&
        existingProfile.profileVersion >= targetVersion
      ) {
        const reusedResult = this.buildResultFromProfile(existingProfile, false, profileRunId);
        this.personaStore.completeProfileRun(profileRunId, {
          status: 'success',
          summaryText: `复用现有画像，作者 ${authorName}`,
          metadata: {
            authorName,
            reused: true,
            sourceMessageCount: existingProfile.sourceMessageCount,
            sourceChunkCount: existingProfile.sourceChunkCount,
          },
        });
        return {
          ...reusedResult,
          run: this.personaStore.getLatestProfileRun(authorName) ?? reusedResult.run,
        };
      }

      const chunkLimit = useFullHistory ? undefined : options.recentChunkLimit;
      const chunks = this.personaStore.getAuthorChunks(authorName, chunkLimit);
      if (chunks.length === 0) {
        const emptyProfileJson =
          targetVersion === 2
            ? this.buildFallbackProfileV2(authorName, [], [], [], {
                totalChunks: 0,
                evidencePoolSize: 0,
                promptEvidenceCount: 0,
                recentPromptCount: 0,
                evidenceByBucket: {},
              })
            : { authorName, axes: {}, themes: [] };
        const emptyProfile = this.personaStore.upsertAuthorProfile({
          authorName,
          status: 'pending',
          summaryText: '暂无可用语料',
          profileJson: JSON.stringify(emptyProfileJson),
          evidenceJson: '[]',
          sourceMessageCount: 0,
          sourceChunkCount: 0,
          lastMessageAt: '',
          lastBuiltAt: null,
          profileVersion: targetVersion,
        });
        this.personaStore.completeProfileRun(profileRunId, {
          status: 'success',
          summaryText: `作者 ${authorName} 暂无可用语料`,
          metadata: { authorName, sourceChunkCount: 0 },
        });
        const completedRun = this.personaStore.getLatestProfileRun(authorName);
        return {
          authorName,
          profile: emptyProfile,
          evidence: [],
          run: completedRun ?? {
            id: profileRunId,
            authorName,
            triggerSource: 'agent',
            status: 'success',
            startedAt: toBeijingISOString(),
            finishedAt: toBeijingISOString(),
            summaryText: '',
            errorMessage: '',
            metadataJson: '{}',
          },
          rebuilt: true,
        };
      }

      await this.ensureEmbeddings(chunks, options.maxChunks);
      const refreshedChunks = this.personaStore.getAuthorChunks(authorName, chunkLimit);
      const evidence =
        targetVersion === 2
          ? await this.collectEvidenceV2(
              authorName,
              refreshedChunks,
              options.evidencePoolSize ?? DEFAULT_EVIDENCE_POOL_SIZE
            )
          : await this.collectEvidence(
              authorName,
              refreshedChunks,
              options.axisTopK ?? DEFAULT_AXIS_TOP_K,
              options.evidencePoolSize ?? DEFAULT_EVIDENCE_POOL_SIZE
            );
      const profilePayload =
        targetVersion === 2
          ? await this.summarizeProfileV2(authorName, refreshedChunks, evidence)
          : await this.summarizeProfile(authorName, refreshedChunks, evidence);
      const stats = this.personaStore.getAuthorMessageStats(authorName);
      const profile = this.personaStore.upsertAuthorProfile({
        authorName,
        status: 'ready',
        summaryText: profilePayload.summaryText,
        profileJson: JSON.stringify(profilePayload.profile),
        evidenceJson: JSON.stringify(evidence),
        sourceMessageCount: stats.messageCount,
        sourceChunkCount: stats.chunkCount,
        lastMessageAt: stats.lastMessageAt,
        lastBuiltAt: toBeijingISOString(),
        profileVersion: targetVersion,
      });

      this.personaStore.completeProfileRun(profileRunId, {
        status: 'success',
        summaryText: `作者 ${authorName} 画像已刷新，覆盖 ${stats.messageCount} 条消息`,
        metadata: {
          authorName,
          sourceMessageCount: stats.messageCount,
          sourceChunkCount: stats.chunkCount,
          evidenceCount: evidence.length,
          evidencePoolSize: options.evidencePoolSize ?? DEFAULT_EVIDENCE_POOL_SIZE,
          profileVersion: targetVersion,
          fullHistory: useFullHistory,
          llmModel: this.llmService.isEnabled() ? this.llmService.getModelName() : 'local-fallback',
          embeddingModel: this.llmService.isEmbeddingEnabled()
            ? this.llmService.getEmbeddingModelName()
            : process.env.LLM_EMBEDDING_FALLBACK_MODE === 'hash'
              ? 'hash-fallback-v1'
              : 'unconfigured',
        },
      });
      const completedRun = this.personaStore.getLatestProfileRun(authorName);

      return {
        authorName,
        profile,
        evidence,
        run: completedRun ?? {
          id: profileRunId,
          authorName,
          triggerSource: 'agent',
          status: 'success',
          startedAt: toBeijingISOString(),
          finishedAt: toBeijingISOString(),
          summaryText: '',
          errorMessage: '',
          metadataJson: '{}',
        },
        rebuilt: true,
      };
    } catch (error) {
      this.personaStore.completeProfileRun(profileRunId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'unknown persona rebuild error',
      });
      throw error;
    }
  }

  getAuthorProfile(authorName: string): V0PersonaProfileResult | null {
    const profile = this.personaStore.getAuthorProfile(authorName);
    if (!profile) {
      return null;
    }

    const evidence = this.parseEvidence(profile.evidenceJson);
    const run = this.personaStore.getLatestProfileRun(authorName);
    return {
      authorName,
      profile,
      evidence,
      run:
        run ?? {
          id: 0,
          authorName,
          triggerSource: 'agent',
          status: 'success',
          startedAt: profile.updatedAt,
          finishedAt: profile.lastBuiltAt,
          summaryText: profile.summaryText,
          errorMessage: '',
          metadataJson: '{}',
        },
      rebuilt: false,
    };
  }

  async answerProfileQuery(authorName: string, question: string): Promise<{ answer: string; references: V0AgentReference[] }> {
    const profile = this.getAuthorProfile(authorName) ?? (await this.rebuildAuthorProfile(authorName));
    const references = this.buildReferences(profile.evidence);

    if (this.llmService.isEnabled()) {
      const evidenceText = profile.evidence
        .slice(0, 8)
        .map((item, index) => `${index + 1}. [${item.bucket ?? item.axis}] ${item.postedAt} ${item.excerpt}`)
        .join('\n');
      const prompt = [
        '你是一个论坛人物画像分析器。根据画像和证据，直接回答用户问题。',
        `作者：${authorName}`,
        `画像摘要：${profile.profile.summaryText}`,
        `问题：${question}`,
        `证据：\n${evidenceText}`,
        '要求：回答要短、具体、可复核，不要编造。',
      ].join('\n\n');
      const answer = await this.llmService.chat(
        [
          { role: 'system', content: '你输出简洁、准确的中文画像分析。' },
          { role: 'user', content: prompt },
        ],
        {
          traceLabel: 'v0.persona.answerProfileQuery',
          tracePayload: {
            authorName,
            question,
            evidenceCount: profile.evidence.length,
            profileSummary: profile.profile.summaryText,
          },
        }
      );
      return { answer: answer || profile.profile.summaryText, references };
    }

    return {
      answer: profile.profile.summaryText || '当前暂无足够的画像信息。',
      references,
    };
  }

  private async ensureEmbeddings(chunks: V0PersonaChunkView[], maxChunks?: number): Promise<void> {
    const targetChunks = chunks
      .filter((chunk) => chunk.embeddingStatus !== 'success')
      .slice(0, maxChunks ?? chunks.length);

    if (targetChunks.length === 0) {
      return;
    }

    const texts = targetChunks.map((chunk) => this.prepareEmbeddingText(chunk.chunkText));
    const { embeddings, modelName } = await this.resolveEmbeddings(texts);
    embeddings.forEach((embedding, index) => {
      const chunk = targetChunks[index];
      this.personaStore.upsertChunkEmbedding(chunk.id, modelName, embedding, 'success');
    });
  }

  private async collectEvidence(
    authorName: string,
    chunks: V0PersonaChunkView[],
    axisTopK: number,
    evidencePoolSize: number
  ): Promise<V0PersonaEvidenceRecord[]> {
    const safePoolSize = Math.max(axisTopK * PERSONA_AXES.length, evidencePoolSize);
    const perAxisLimit = Math.max(axisTopK, Math.ceil(safePoolSize * 0.6 / PERSONA_AXES.length));
    const recentLimit = Math.max(10, Math.ceil(safePoolSize * 0.2));
    const longformLimit = Math.max(10, Math.ceil(safePoolSize * 0.15));
    const marketLimit = Math.max(10, Math.ceil(safePoolSize * 0.2));
    const axisQueries = PERSONA_AXES.map((axis) => axis.query);
    const { embeddings: axisEmbeddings } = await this.resolveEmbeddings(axisQueries);
    const scoredByAxis = PERSONA_AXES.flatMap((axis, axisIndex) => {
      const axisEmbedding = axisEmbeddings[axisIndex] ?? [];
      return chunks
        .map((chunk) => ({
          chunk,
          embedding: this.parseEmbedding(chunk.embeddingJson),
          score: this.cosineSimilarity(axisEmbedding, this.parseEmbedding(chunk.embeddingJson)),
        }))
        .filter((item) => item.embedding.length > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, perAxisLimit)
        .map((item) => this.buildEvidenceRecord(authorName, item.chunk, axis.key, item.score));
    });

    const recentEvidence = chunks
      .slice()
      .sort((left, right) => this.compareChunkTime(right, left))
      .slice(0, recentLimit)
      .map((chunk) => this.buildEvidenceRecord(authorName, chunk, 'recent', 0));

    const longformEvidence = chunks
      .filter((chunk) => chunk.chunkText.length >= 180)
      .slice()
      .sort((left, right) => right.chunkText.length - left.chunkText.length)
      .slice(0, longformLimit)
      .map((chunk) => this.buildEvidenceRecord(authorName, chunk, 'longform', 0));

    const marketEvidence = chunks
      .map((chunk) => this.buildEvidenceRecord(authorName, chunk, 'market', 0))
      .filter((item) => item.mentions.length > 0 || item.marketSummaries.length > 0)
      .slice(0, marketLimit);

    return this.mergeEvidence(
      [...recentEvidence, ...longformEvidence, ...marketEvidence, ...scoredByAxis],
      safePoolSize
    );
  }

  private async collectEvidenceV2(
    authorName: string,
    chunks: V0PersonaChunkView[],
    evidencePoolSize: number
  ): Promise<V0PersonaEvidenceRecord[]> {
    const safePoolSize = Math.max(evidencePoolSize, 240);
    const perBucketSemanticLimit = Math.max(12, Math.ceil(safePoolSize * 0.35 / PERSONA_V2_BUCKETS.length));
    const perBucketRuleLimit = Math.max(14, Math.ceil(safePoolSize * 0.5 / PERSONA_V2_BUCKETS.length));
    const bucketQueries = PERSONA_V2_BUCKETS.map((bucket) => bucket.query);
    const { embeddings: bucketEmbeddings } = await this.resolveEmbeddings(bucketQueries);
    const chunkEmbeddings = chunks.map((chunk) => ({
      chunk,
      embedding: this.parseEmbedding(chunk.embeddingJson),
    }));

    const semanticEvidence = PERSONA_V2_BUCKETS.flatMap((bucket, bucketIndex) => {
      const bucketEmbedding = bucketEmbeddings[bucketIndex] ?? [];
      return chunkEmbeddings
        .map((item) => ({
          chunk: item.chunk,
          score: this.cosineSimilarity(bucketEmbedding, item.embedding),
        }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, perBucketSemanticLimit)
        .map((item) => this.buildEvidenceRecordV2(authorName, item.chunk, bucket.key, item.score));
    });

    const ruleEvidence = PERSONA_V2_BUCKETS.flatMap((bucket) =>
      chunks
        .filter((chunk) => this.matchesV2Bucket(chunk, bucket.key))
        .map((chunk) => this.buildEvidenceRecordV2(authorName, chunk, bucket.key, 0))
        .sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0))
        .slice(0, perBucketRuleLimit)
    );

    const recentEvidence = chunks
      .slice()
      .sort((left, right) => this.compareChunkTime(right, left))
      .slice(0, Math.max(30, Math.ceil(safePoolSize * 0.12)))
      .map((chunk) => this.buildEvidenceRecordV2(authorName, chunk, 'recentSignals', 0));

    const longformEvidence = chunks
      .filter((chunk) => chunk.chunkText.length >= 180)
      .slice()
      .sort((left, right) => right.chunkText.length - left.chunkText.length)
      .slice(0, Math.max(30, Math.ceil(safePoolSize * 0.18)))
      .map((chunk) => this.buildEvidenceRecordV2(authorName, chunk, 'longformTheory', 0));

    return this.mergeEvidenceV2(
      [...longformEvidence, ...recentEvidence, ...ruleEvidence, ...semanticEvidence],
      safePoolSize
    );
  }

  private matchesV2Bucket(chunk: V0PersonaChunkView, bucket: V0PersonaEvidenceBucket): boolean {
    const text = chunk.chunkText;
    switch (bucket) {
      case 'longformTheory':
        return text.length >= 180 || /(复盘|方法|体系|框架|逻辑|经验|周期|本质|理解|为什么|核心)/.test(text);
      case 'intradayDecision':
        return /(今天|现在|盘中|早盘|午后|尾盘|开盘|回封|承接|拉升|分歧|弱转强|买|卖|等|观察)/.test(text);
      case 'riskWarning':
        return /(风险|不追|别追|谨慎|失效|不确认|杀跌|回落|不行|撤|止损|亏|坑|小心)/.test(text);
      case 'sectorStockReasoning':
        return (
          this.hasMessageMention(chunk.messageId, ['stock', 'sector']) ||
          /(板块|个股|股票|题材|龙头|标的|机器人|证券|算力|AI|传媒|芯片|新能源|军工)/i.test(text)
        );
      case 'marketStructure':
        return /(指数|大盘|黄线|白线|量能|情绪|北向|资金|周期|风格|主线|轮动|冰点|高潮|分歧)/.test(text);
      case 'expressionStyle':
        return /(我觉得|不急|先看|再说|看看|别|简单说|说白了|大概|应该|可能|注意)/.test(text);
      case 'recentSignals':
        return true;
      case 'contradictionCandidates':
        return /(但是|不过|反而|变了|切换|之前|现在|修正|不对|错|打脸|预期差|否定)/.test(text);
      default:
        return false;
    }
  }

  private hasMessageMention(messageId: number, entityTypes: string[]): boolean {
    const message = this.messageStore.getMessageById(messageId);
    return Boolean(message?.mentions?.some((mention) => entityTypes.includes(mention.entityType)));
  }

  private buildEvidenceRecord(
    authorName: string,
    chunk: V0PersonaChunkView,
    axis: string,
    score: number
  ): V0PersonaEvidenceRecord {
    const message = this.messageStore.getMessageById(chunk.messageId);
    return {
      chunkId: chunk.id,
      messageId: chunk.messageId,
      threadKey: chunk.threadKey,
      floorId: chunk.floorId,
      authorName,
      postedAt: chunk.sourcePostedAt,
      sourceUrl: chunk.sourceUrl,
      chunkIndex: chunk.chunkIndex,
      similarity: Number(score.toFixed(4)),
      axis,
      excerpt: chunk.chunkText.slice(0, 260),
      rawContent: message?.rawContent ?? chunk.chunkText,
      mentions: message?.mentions?.map((mention) => `${mention.entityType}:${mention.entityName}`) ?? [],
      marketSummaries: message?.marketStates?.map((state) => state.summaryText) ?? [],
    };
  }

  private buildEvidenceRecordV2(
    authorName: string,
    chunk: V0PersonaChunkView,
    bucket: V0PersonaEvidenceBucket,
    score: number
  ): V0PersonaEvidenceRecord {
    const record = this.buildEvidenceRecord(authorName, chunk, bucket, score);
    const qualityScore = this.calculateEvidenceQuality(chunk, bucket, score, record);
    return {
      ...record,
      bucket,
      qualityScore,
      evidenceRole: PERSONA_V2_BUCKETS.find((item) => item.key === bucket)?.role ?? '补充画像证据',
      beijingTime: chunk.sourcePostedAt || chunk.createdAt,
      messageFloor: chunk.floorId,
    };
  }

  private calculateEvidenceQuality(
    chunk: V0PersonaChunkView,
    bucket: V0PersonaEvidenceBucket,
    score: number,
    record: V0PersonaEvidenceRecord
  ): number {
    let value = 0.35;
    if (chunk.chunkText.length >= 120) {
      value += 0.12;
    }
    if (chunk.chunkText.length >= 260) {
      value += 0.12;
    }
    if (record.mentions.length > 0) {
      value += 0.1;
    }
    if (record.marketSummaries.length > 0) {
      value += 0.08;
    }
    if (score > 0) {
      value += Math.min(0.18, score * 0.2);
    }
    if (bucket === 'longformTheory') {
      value += 0.12;
    }
    if (bucket === 'riskWarning' || bucket === 'contradictionCandidates') {
      value += 0.05;
    }
    return Number(Math.max(0.05, Math.min(1, value)).toFixed(4));
  }

  private mergeEvidence(
    evidence: V0PersonaEvidenceRecord[],
    limit: number
  ): V0PersonaEvidenceRecord[] {
    const seen = new Set<string>();
    const merged: V0PersonaEvidenceRecord[] = [];

    for (const item of evidence) {
      const key = `${item.chunkId}:${item.axis}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) {
        break;
      }
    }

    return merged;
  }

  private mergeEvidenceV2(
    evidence: V0PersonaEvidenceRecord[],
    limit: number
  ): V0PersonaEvidenceRecord[] {
    const seen = new Set<string>();
    const byBucket = new Map<V0PersonaEvidenceBucket, V0PersonaEvidenceRecord[]>();
    const orderedBuckets = PERSONA_V2_BUCKETS.map((bucket) => bucket.key);

    const sorted = evidence
      .slice()
      .sort((left, right) => {
        const qualityDelta = (right.qualityScore ?? 0) - (left.qualityScore ?? 0);
        if (Math.abs(qualityDelta) > 0.0001) {
          return qualityDelta;
        }
        return right.postedAt.localeCompare(left.postedAt) || right.chunkId - left.chunkId;
      });

    for (const item of sorted) {
      const bucket = item.bucket ?? (item.axis as V0PersonaEvidenceBucket);
      const key = `${item.chunkId}:${bucket}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const list = byBucket.get(bucket) ?? [];
      list.push(item);
      byBucket.set(bucket, list);
    }

    const merged: V0PersonaEvidenceRecord[] = [];
    const minPerBucket = Math.max(6, Math.floor(limit / PERSONA_V2_BUCKETS.length / 2));
    for (const bucket of orderedBuckets) {
      for (const item of (byBucket.get(bucket) ?? []).slice(0, minPerBucket)) {
        merged.push(item);
      }
    }

    for (const item of sorted) {
      if (merged.some((existing) => existing.chunkId === item.chunkId && existing.bucket === item.bucket)) {
        continue;
      }
      merged.push(item);
      if (merged.length >= limit) {
        break;
      }
    }

    return merged.slice(0, limit);
  }

  private compareChunkTime(left: V0PersonaChunkView, right: V0PersonaChunkView): number {
    const leftTime = left.sourcePostedAt || left.createdAt;
    const rightTime = right.sourcePostedAt || right.createdAt;
    return leftTime.localeCompare(rightTime) || left.id - right.id;
  }

  private async summarizeProfile(
    authorName: string,
    chunks: V0PersonaChunkView[],
    evidence: V0PersonaEvidenceRecord[]
  ): Promise<{ summaryText: string; profile: Record<string, unknown> }> {
    const recentTexts = chunks
      .slice(0, PROFILE_PROMPT_RECENT_LIMIT)
      .map((chunk) => `[${chunk.sourcePostedAt || chunk.createdAt}] ${chunk.chunkText}`)
      .join('\n');
    const evidenceText = evidence
      .slice(0, PROFILE_PROMPT_EVIDENCE_LIMIT)
      .map((item, index) => `${index + 1}. ${item.postedAt} ${item.excerpt}`)
      .join('\n');
    const evidenceStats = {
      totalChunks: chunks.length,
      evidencePoolSize: evidence.length,
      promptEvidenceCount: Math.min(evidence.length, PROFILE_PROMPT_EVIDENCE_LIMIT),
      recentPromptCount: Math.min(chunks.length, PROFILE_PROMPT_RECENT_LIMIT),
      evidenceByAxis: evidence.reduce<Record<string, number>>((acc, item) => {
        acc[item.axis] = (acc[item.axis] ?? 0) + 1;
        return acc;
      }, {}),
    };

    if (this.llmService.isEnabled()) {
      const prompt = [
        '请根据下面的论坛发言证据，生成一个可持久化的作者画像 JSON。',
        `作者：${authorName}`,
        `最近语料：\n${recentTexts}`,
        `精选证据：\n${evidenceText}`,
        '输出要求：',
        '1. 只输出 JSON。',
        '2. 顶层至少包含 summaryText、axes、methodology、themes、stocks、concepts、riskLevel、timeHorizon、confidence。',
        '3. summaryText 要用一句话概括这个人的稳定思想和表达风格。',
        '4. methodology 要描述可复用的看盘方法：核心变量、推理步骤、确认/否定条件、仓位或风险处理、适用边界。',
        '5. 不要只总结他评价过哪些行情，要提炼“他会如何分析一个新的 A 股盘面或标的”。',
      ].join('\n\n');
      const raw = await this.llmService.chat(
        [
          { role: 'system', content: '你是一个人物画像蒸馏器，只输出严谨的 JSON。' },
          { role: 'user', content: prompt },
        ],
        {
          traceLabel: 'v0.persona.summarizeProfile',
          tracePayload: {
            authorName,
            chunkCount: chunks.length,
            evidenceCount: evidence.length,
            promptEvidenceCount: Math.min(evidence.length, PROFILE_PROMPT_EVIDENCE_LIMIT),
            recentPromptCount: Math.min(chunks.length, PROFILE_PROMPT_RECENT_LIMIT),
          },
        }
      );
      const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(cleaned);
        return {
          summaryText: typeof parsed.summaryText === 'string' ? parsed.summaryText : `作者 ${authorName} 的画像已生成`,
          profile: {
            ...parsed,
            evidenceStats,
          },
        };
      } catch {
        return {
          summaryText: `作者 ${authorName} 的画像已生成，但模型输出无法解析为 JSON`,
          profile: {
            authorName,
            raw,
            evidenceStats,
            axes: {},
            themes: [],
          },
        };
      }
    }

    return {
      summaryText: `作者 ${authorName} 的近期观点已整理，偏重对消息和行情的连续观察。`,
      profile: {
        authorName,
        evidenceStats,
        axes: {
          stance: '谨慎观察',
          style: '偏向连续复盘和提示',
          horizon: '短线到波段',
          risk: '中性偏保守',
          theme: evidence.slice(0, 5).map((item) => item.axis),
        },
        methodology: {
          coreVariables: ['指数强弱', '板块轮动', '资金承接', '情绪变化', '个股反馈'],
          reasoningSteps: ['先看大盘和情绪背景', '再看板块强弱和资金承接', '最后落到个股位置与反馈'],
          invalidationSignals: ['承接不足', '板块回落', '指数继续走弱', '量价反馈不支持原判断'],
          riskHandling: '优先观察确认信号，避免在证据不足时追高或重仓下结论。',
        },
        themes: evidence.slice(0, 5).map((item) => item.excerpt),
      },
    };
  }

  private async summarizeProfileV2(
    authorName: string,
    chunks: V0PersonaChunkView[],
    evidence: V0PersonaEvidenceRecord[]
  ): Promise<{ summaryText: string; profile: V0PersonaProfileJsonV2 }> {
    const evidenceStats = this.buildEvidenceStatsV2(chunks, evidence);
    const bucketAnalyses = await this.analyzeEvidenceBuckets(authorName, evidence, evidenceStats);
    const draftProfile = await this.buildProfileV2(authorName, evidence, bucketAnalyses, evidenceStats);
    const checkedProfile = await this.qualityCheckProfileV2(authorName, draftProfile, evidence, evidenceStats);
    return {
      summaryText: checkedProfile.summaryText,
      profile: checkedProfile,
    };
  }

  private buildEvidenceStatsV2(
    chunks: V0PersonaChunkView[],
    evidence: V0PersonaEvidenceRecord[]
  ): Record<string, unknown> {
    const bucketCounts = evidence.reduce<Record<string, number>>((acc, item) => {
      const bucket = item.bucket ?? item.axis;
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    }, {});
    const longformCount = evidence.filter((item) => item.bucket === 'longformTheory' || item.excerpt.length >= 180).length;
    const recentCount = evidence.filter((item) => item.bucket === 'recentSignals').length;
    const weakAreas = PERSONA_V2_BUCKETS
      .filter((bucket) => (bucketCounts[bucket.key] ?? 0) < 3)
      .map((bucket) => bucket.label);

    return {
      totalChunks: chunks.length,
      evidencePoolSize: evidence.length,
      promptEvidenceCount: Math.min(evidence.length, V2_PROFILE_PROMPT_EVIDENCE_LIMIT),
      recentPromptCount: Math.min(chunks.length, PROFILE_PROMPT_RECENT_LIMIT),
      evidenceByBucket: bucketCounts,
      longformRatio: evidence.length > 0 ? Number((longformCount / evidence.length).toFixed(4)) : 0,
      recentRatio: evidence.length > 0 ? Number((recentCount / evidence.length).toFixed(4)) : 0,
      weakAreas,
      llmModel: this.llmService.isEnabled() ? this.llmService.getModelName() : 'local-fallback',
      embeddingModel: this.llmService.isEmbeddingEnabled()
        ? this.llmService.getEmbeddingModelName()
        : process.env.LLM_EMBEDDING_FALLBACK_MODE === 'hash'
          ? 'hash-fallback-v1'
          : 'unconfigured',
    };
  }

  private async analyzeEvidenceBuckets(
    authorName: string,
    evidence: V0PersonaEvidenceRecord[],
    evidenceStats: Record<string, unknown>
  ): Promise<V2BucketAnalysis[]> {
    const fallback = this.buildFallbackBucketAnalyses(evidence);
    if (!this.llmService.isEnabled()) {
      return fallback;
    }

    const groupedEvidence = PERSONA_V2_BUCKETS.map((bucket) => ({
      bucket: bucket.key,
      label: bucket.label,
      role: bucket.role,
      evidence: evidence
        .filter((item) => (item.bucket ?? item.axis) === bucket.key)
        .slice(0, V2_ANALYSIS_EVIDENCE_LIMIT)
        .map((item) => ({
          time: item.beijingTime ?? item.postedAt,
          floor: item.messageFloor ?? item.floorId,
          qualityScore: item.qualityScore ?? null,
          excerpt: item.excerpt,
          mentions: item.mentions,
          marketSummaries: item.marketSummaries,
        })),
    }));

    const prompt = [
      '请对论坛作者的证据桶做结构化分析。只输出 JSON，不要输出解释文本。',
      `作者：${authorName}`,
      '目标：不是总结他说过什么，而是抽取他如何分析 A 股、板块、个股、风险和表达不确定性。',
      'JSON 格式：{"analyses":[{"bucket":"longformTheory","label":"长篇理论","findings":["..."],"rules":["..."],"contradictions":["..."],"confidence":0.0}]}',
      '要求：每个 bucket 最多 5 条 findings、5 条 rules；不能编造证据里没有的具体股票、行情或原话。',
      JSON.stringify({ evidenceStats, groupedEvidence }, null, 2),
    ].join('\n\n');

    const raw = await this.llmService.chat(
      [
        { role: 'system', content: '你是严谨的金融论坛人物方法论分析器，只输出可解析 JSON。' },
        { role: 'user', content: prompt },
      ],
      {
        traceLabel: 'v0.persona.v2.analyzeEvidenceBuckets',
        tracePayload: {
          authorName,
          evidenceCount: evidence.length,
          bucketCounts: evidenceStats.evidenceByBucket,
        },
      }
    );
    const parsed = this.parseJsonObject(raw);
    const analyses = Array.isArray(parsed?.analyses) ? parsed.analyses : [];
    const normalized = analyses
      .map((item) => this.normalizeBucketAnalysis(item))
      .filter((item): item is V2BucketAnalysis => Boolean(item));

    return normalized.length > 0 ? this.mergeBucketAnalyses(fallback, normalized) : fallback;
  }

  private async buildProfileV2(
    authorName: string,
    evidence: V0PersonaEvidenceRecord[],
    bucketAnalyses: V2BucketAnalysis[],
    evidenceStats: Record<string, unknown>
  ): Promise<V0PersonaProfileJsonV2> {
    const fallbackProfile = this.buildFallbackProfileV2(authorName, evidence, bucketAnalyses, [], evidenceStats);
    if (!this.llmService.isEnabled()) {
      return fallbackProfile;
    }

    const evidenceSample = evidence.slice(0, V2_PROFILE_PROMPT_EVIDENCE_LIMIT).map((item) => ({
      bucket: item.bucket ?? item.axis,
      time: item.beijingTime ?? item.postedAt,
      floor: item.messageFloor ?? item.floorId,
      qualityScore: item.qualityScore ?? null,
      role: item.evidenceRole ?? '',
      excerpt: item.excerpt,
      mentions: item.mentions,
      marketSummaries: item.marketSummaries,
    }));
    const prompt = [
      '请基于证据桶分析，生成 Persona Distillation V2 作者市场方法论画像。只输出 JSON。',
      `作者：${authorName}`,
      '顶层字段必须包含：schemaVersion、authorName、summaryText、coreRules、marketMethodology、decisionHeuristics、expressionDNA、topicMap、evidenceQuality、contradictions、honestBoundaries、agenticProtocol、correctionLog。',
      'marketMethodology 必须包含 coreVariables、reasoningSteps、confirmationSignals、invalidationSignals、riskHandling、applicableScenarios。',
      'agenticProtocol 必须说明 agent 面对行情归因、个股分析、板块判断、人物观点追踪、复盘、策略模拟时如何选上下文与校准置信度。',
      '不要把模拟判断写成作者原话；不要编造没有证据支持的股票、新闻或行情数据。',
      JSON.stringify({ evidenceStats, bucketAnalyses, evidenceSample }, null, 2),
    ].join('\n\n');

    const raw = await this.llmService.chat(
      [
        { role: 'system', content: '你是 A 股论坛人物方法论蒸馏器，只输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      {
        traceLabel: 'v0.persona.v2.buildProfile',
        tracePayload: {
          authorName,
          evidenceCount: evidence.length,
          analysisCount: bucketAnalyses.length,
        },
      }
    );

    const parsed = this.parseJsonObject(raw);
    return this.normalizeProfileV2(authorName, parsed, fallbackProfile, evidenceStats);
  }

  private async qualityCheckProfileV2(
    authorName: string,
    profile: V0PersonaProfileJsonV2,
    evidence: V0PersonaEvidenceRecord[],
    evidenceStats: Record<string, unknown>
  ): Promise<V0PersonaProfileJsonV2> {
    const deterministic = this.applyDeterministicQualityCheck(profile, evidence, evidenceStats);
    if (!this.llmService.isEnabled()) {
      return deterministic;
    }

    const prompt = [
      '请检查这个人物方法论画像是否证据充足、是否过度自信、是否存在编造或边界不清。只输出 JSON。',
      'JSON 格式：{"confidence":0.0,"weakAreas":["..."],"honestBoundaries":["..."],"contradictions":["..."],"qualityNotes":["..."]}',
      JSON.stringify(
        {
          authorName,
          profile: deterministic,
          evidenceStats,
          evidenceSample: evidence.slice(0, 80).map((item) => ({
            bucket: item.bucket ?? item.axis,
            time: item.beijingTime ?? item.postedAt,
            excerpt: item.excerpt,
          })),
        },
        null,
        2
      ),
    ].join('\n\n');
    const raw = await this.llmService.chat(
      [
        { role: 'system', content: '你是画像质量审计器，只输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      {
        traceLabel: 'v0.persona.v2.qualityCheck',
        tracePayload: {
          authorName,
          evidenceCount: evidence.length,
          confidence: deterministic.evidenceQuality.confidence,
        },
      }
    );
    const parsed = this.parseJsonObject(raw);
    if (!parsed) {
      return deterministic;
    }

    return {
      ...deterministic,
      contradictions: this.uniqueStrings([
        ...deterministic.contradictions,
        ...this.asStringArray(parsed.contradictions),
      ]).slice(0, 12),
      honestBoundaries: this.uniqueStrings([
        ...deterministic.honestBoundaries,
        ...this.asStringArray(parsed.honestBoundaries),
        ...this.asStringArray(parsed.weakAreas).map((item) => `薄弱区域：${item}`),
      ]).slice(0, 12),
      evidenceQuality: {
        ...deterministic.evidenceQuality,
        weakAreas: this.uniqueStrings([
          ...deterministic.evidenceQuality.weakAreas,
          ...this.asStringArray(parsed.weakAreas),
        ]),
        confidence: this.clampConfidence(
          typeof parsed.confidence === 'number' ? parsed.confidence : deterministic.evidenceQuality.confidence
        ),
      },
    };
  }

  private buildFallbackBucketAnalyses(evidence: V0PersonaEvidenceRecord[]): V2BucketAnalysis[] {
    return PERSONA_V2_BUCKETS.map((bucket) => {
      const items = evidence.filter((item) => (item.bucket ?? item.axis) === bucket.key);
      const topItems = items
        .slice()
        .sort((left, right) => (right.qualityScore ?? 0) - (left.qualityScore ?? 0))
        .slice(0, 5);
      return {
        bucket: bucket.key,
        label: bucket.label,
        findings: topItems.map((item) => item.excerpt).filter(Boolean),
        rules: this.inferRulesForBucket(bucket.key, topItems),
        contradictions:
          bucket.key === 'contradictionCandidates'
            ? topItems.map((item) => item.excerpt).slice(0, 5)
            : [],
        confidence: this.clampConfidence(items.length / 12),
      };
    });
  }

  private buildFallbackProfileV2(
    authorName: string,
    evidence: V0PersonaEvidenceRecord[],
    bucketAnalyses: V2BucketAnalysis[],
    contradictions: string[],
    evidenceStats: Record<string, unknown>
  ): V0PersonaProfileJsonV2 {
    const bucketCounts = this.asRecordNumber(evidenceStats.evidenceByBucket);
    const mentions = this.extractTopicMap(evidence);
    const coreRules = this.uniqueStrings(
      bucketAnalyses.flatMap((analysis) => analysis.rules).filter(Boolean)
    ).slice(0, 10);
    const fallbackRules =
      coreRules.length > 0
        ? coreRules
        : [
            '先观察指数、情绪和承接，再落到板块与个股反馈。',
            '没有确认信号时降低结论强度，避免把观察当成买点。',
            '用风险和失效条件约束模拟推演，不把历史方法论等同于当天原话。',
          ];
    const confidence = this.clampConfidence(
      Math.min(0.82, 0.28 + evidence.length / 400 + (bucketCounts.longformTheory ?? 0) / 120)
    );

    return {
      schemaVersion: 2,
      authorName,
      summaryText: `作者 ${authorName} 的 V2 方法论画像已生成：以历史证据提炼其看盘变量、板块个股推理、风险边界和表达风格，用于后续行情问题的可审计模拟。`,
      coreRules: fallbackRules,
      marketMethodology: {
        coreVariables: this.uniqueStrings([
          '指数强弱',
          '市场情绪',
          '量能与承接',
          '板块轮动',
          '个股反馈',
          ...mentions.macroVariables,
        ]).slice(0, 10),
        reasoningSteps: [
          '先判断大盘、情绪和流动性背景。',
          '再观察主线板块、轮动方向和资金承接。',
          '最后落到具体标的的位置、量价反馈和确认/失效信号。',
          '若缺少当天原话，则只做历史方法论模拟，并降低置信度。',
        ],
        confirmationSignals: ['承接增强', '板块走强', '量价反馈支持', '指数或情绪止跌修复'],
        invalidationSignals: ['承接不足', '板块回落', '指数继续走弱', '观点证据不足或前后冲突'],
        riskHandling: '把风险提示和失效条件前置；没有确认信号时偏观察，不把模拟判断包装成作者当天原话。',
        applicableScenarios: ['行情归因', '板块强弱判断', '个股观察', '复盘', '策略模拟'],
      },
      decisionHeuristics: [
        '如果指数走弱但某板块逆势放量，则优先观察该板块是否有持续承接。',
        '如果个股缺少回封、放量或承接确认，则只保留观察，不给高置信判断。',
        '如果当天没有作者发言，则基于长期方法论模拟，并明确证据边界。',
      ],
      expressionDNA: {
        phrases: this.extractFrequentPhrases(evidence),
        sentenceStyle: '偏短句、盘中观察式表达，常把判断写成条件和提醒。',
        certaintyStyle: '倾向用“先看、观察、确认、再说”等方式校准确定性。',
        rhetoric: ['提醒风险', '条件判断', '复盘归因'],
      },
      topicMap: mentions,
      evidenceQuality: {
        totalEvidence: evidence.length,
        totalChunks: Number(evidenceStats.totalChunks ?? 0),
        longformRatio: Number(evidenceStats.longformRatio ?? 0),
        recentRatio: Number(evidenceStats.recentRatio ?? 0),
        bucketCounts,
        weakAreas: this.asStringArray(evidenceStats.weakAreas),
        confidence,
      },
      contradictions: this.uniqueStrings(contradictions).slice(0, 12),
      honestBoundaries: [
        '画像输出的是历史方法论模拟，不代表作者对未发言日期或标的的当天原话。',
        '缺少实时行情、新闻或成交数据时，只能做有限归因。',
        '证据桶覆盖不足的主题需要降低置信度并优先补充语料。',
      ],
      agenticProtocol: {
        questionTypes: ['行情归因', '个股分析', '板块判断', '人物观点追踪', '复盘', '策略模拟'],
        requiredContext: ['作者 V2 方法论', '相关证据桶', '指定日期发言', '近期发言', '盘面/板块/个股快照'],
        analysisSteps: ['识别问题类型', '选择证据桶', '提取当前事实', '按方法论模拟推演', '输出边界与置信度'],
        confidenceCalibration: '直接发言和长篇理论证据优先；只有历史方法论时必须标注为模拟并降低置信度。',
      },
      correctionLog: [],
      evidenceStats,
    };
  }

  private applyDeterministicQualityCheck(
    profile: V0PersonaProfileJsonV2,
    evidence: V0PersonaEvidenceRecord[],
    evidenceStats: Record<string, unknown>
  ): V0PersonaProfileJsonV2 {
    const weakAreas = this.asStringArray(evidenceStats.weakAreas);
    const bucketCounts = this.asRecordNumber(evidenceStats.evidenceByBucket);
    const confidenceCeiling = evidence.length < 30 ? 0.45 : bucketCounts.longformTheory < 3 ? 0.62 : 0.86;
    const confidence = this.clampConfidence(Math.min(profile.evidenceQuality.confidence, confidenceCeiling));
    const boundaries = [...profile.honestBoundaries];
    if (evidence.length < 30) {
      boundaries.push('当前证据量较少，不能生成高置信的人物方法论。');
    }
    if ((bucketCounts.longformTheory ?? 0) < 3) {
      boundaries.push('长篇理论证据不足，底层方法论应视为初稿。');
    }
    return {
      ...profile,
      evidenceQuality: {
        ...profile.evidenceQuality,
        totalEvidence: evidence.length,
        totalChunks: Number(evidenceStats.totalChunks ?? profile.evidenceQuality.totalChunks),
        bucketCounts,
        weakAreas,
        confidence,
      },
      honestBoundaries: this.uniqueStrings(boundaries).slice(0, 12),
    };
  }

  private normalizeBucketAnalysis(value: unknown): V2BucketAnalysis | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const bucket = record.bucket;
    if (!PERSONA_V2_BUCKETS.some((item) => item.key === bucket)) {
      return null;
    }
    const bucketMeta = PERSONA_V2_BUCKETS.find((item) => item.key === bucket);
    return {
      bucket: bucket as V0PersonaEvidenceBucket,
      label: this.pickString(record.label) || bucketMeta?.label || String(bucket),
      findings: this.asStringArray(record.findings).slice(0, 8),
      rules: this.asStringArray(record.rules).slice(0, 8),
      contradictions: this.asStringArray(record.contradictions).slice(0, 8),
      confidence: this.clampConfidence(typeof record.confidence === 'number' ? record.confidence : 0.4),
    };
  }

  private mergeBucketAnalyses(
    fallback: V2BucketAnalysis[],
    generated: V2BucketAnalysis[]
  ): V2BucketAnalysis[] {
    return PERSONA_V2_BUCKETS.map((bucket) => {
      const generatedItem = generated.find((item) => item.bucket === bucket.key);
      const fallbackItem = fallback.find((item) => item.bucket === bucket.key);
      return generatedItem ?? fallbackItem ?? {
        bucket: bucket.key,
        label: bucket.label,
        findings: [],
        rules: [],
        contradictions: [],
        confidence: 0,
      };
    });
  }

  private normalizeProfileV2(
    authorName: string,
    parsed: Record<string, unknown> | null,
    fallback: V0PersonaProfileJsonV2,
    evidenceStats: Record<string, unknown>
  ): V0PersonaProfileJsonV2 {
    if (!parsed) {
      return fallback;
    }
    const methodology = this.asRecord(parsed.marketMethodology);
    const expressionDNA = this.asRecord(parsed.expressionDNA);
    const topicMap = this.asRecord(parsed.topicMap);
    const evidenceQuality = this.asRecord(parsed.evidenceQuality);
    const agenticProtocol = this.asRecord(parsed.agenticProtocol);

    return {
      ...fallback,
      schemaVersion: 2,
      authorName,
      summaryText: this.pickString(parsed.summaryText) || fallback.summaryText,
      coreRules: this.asStringArray(parsed.coreRules).length > 0 ? this.asStringArray(parsed.coreRules) : fallback.coreRules,
      marketMethodology: {
        coreVariables: this.asStringArray(methodology.coreVariables).length > 0
          ? this.asStringArray(methodology.coreVariables)
          : fallback.marketMethodology.coreVariables,
        reasoningSteps: this.asStringArray(methodology.reasoningSteps).length > 0
          ? this.asStringArray(methodology.reasoningSteps)
          : fallback.marketMethodology.reasoningSteps,
        confirmationSignals: this.asStringArray(methodology.confirmationSignals).length > 0
          ? this.asStringArray(methodology.confirmationSignals)
          : fallback.marketMethodology.confirmationSignals,
        invalidationSignals: this.asStringArray(methodology.invalidationSignals).length > 0
          ? this.asStringArray(methodology.invalidationSignals)
          : fallback.marketMethodology.invalidationSignals,
        riskHandling: this.pickString(methodology.riskHandling) || fallback.marketMethodology.riskHandling,
        applicableScenarios: this.asStringArray(methodology.applicableScenarios).length > 0
          ? this.asStringArray(methodology.applicableScenarios)
          : fallback.marketMethodology.applicableScenarios,
      },
      decisionHeuristics: this.asStringArray(parsed.decisionHeuristics).length > 0
        ? this.asStringArray(parsed.decisionHeuristics)
        : fallback.decisionHeuristics,
      expressionDNA: {
        phrases: this.asStringArray(expressionDNA.phrases).length > 0
          ? this.asStringArray(expressionDNA.phrases)
          : fallback.expressionDNA.phrases,
        sentenceStyle: this.pickString(expressionDNA.sentenceStyle) || fallback.expressionDNA.sentenceStyle,
        certaintyStyle: this.pickString(expressionDNA.certaintyStyle) || fallback.expressionDNA.certaintyStyle,
        rhetoric: this.asStringArray(expressionDNA.rhetoric).length > 0
          ? this.asStringArray(expressionDNA.rhetoric)
          : fallback.expressionDNA.rhetoric,
      },
      topicMap: {
        stocks: this.asStringArray(topicMap.stocks).length > 0 ? this.asStringArray(topicMap.stocks) : fallback.topicMap.stocks,
        sectors: this.asStringArray(topicMap.sectors).length > 0 ? this.asStringArray(topicMap.sectors) : fallback.topicMap.sectors,
        concepts: this.asStringArray(topicMap.concepts).length > 0 ? this.asStringArray(topicMap.concepts) : fallback.topicMap.concepts,
        macroVariables: this.asStringArray(topicMap.macroVariables).length > 0
          ? this.asStringArray(topicMap.macroVariables)
          : fallback.topicMap.macroVariables,
      },
      evidenceQuality: {
        ...fallback.evidenceQuality,
        ...this.asRecord(evidenceQuality),
        totalEvidence: Number(evidenceQuality.totalEvidence ?? fallback.evidenceQuality.totalEvidence),
        totalChunks: Number(evidenceQuality.totalChunks ?? fallback.evidenceQuality.totalChunks),
        longformRatio: Number(evidenceQuality.longformRatio ?? fallback.evidenceQuality.longformRatio),
        recentRatio: Number(evidenceQuality.recentRatio ?? fallback.evidenceQuality.recentRatio),
        bucketCounts: this.asRecordNumber(evidenceQuality.bucketCounts) ?? fallback.evidenceQuality.bucketCounts,
        weakAreas: this.asStringArray(evidenceQuality.weakAreas).length > 0
          ? this.asStringArray(evidenceQuality.weakAreas)
          : fallback.evidenceQuality.weakAreas,
        confidence: this.clampConfidence(
          typeof evidenceQuality.confidence === 'number'
            ? evidenceQuality.confidence
            : fallback.evidenceQuality.confidence
        ),
      },
      contradictions: this.asStringArray(parsed.contradictions).length > 0
        ? this.asStringArray(parsed.contradictions)
        : fallback.contradictions,
      honestBoundaries: this.asStringArray(parsed.honestBoundaries).length > 0
        ? this.asStringArray(parsed.honestBoundaries)
        : fallback.honestBoundaries,
      agenticProtocol: {
        questionTypes: this.asStringArray(agenticProtocol.questionTypes).length > 0
          ? this.asStringArray(agenticProtocol.questionTypes)
          : fallback.agenticProtocol.questionTypes,
        requiredContext: this.asStringArray(agenticProtocol.requiredContext).length > 0
          ? this.asStringArray(agenticProtocol.requiredContext)
          : fallback.agenticProtocol.requiredContext,
        analysisSteps: this.asStringArray(agenticProtocol.analysisSteps).length > 0
          ? this.asStringArray(agenticProtocol.analysisSteps)
          : fallback.agenticProtocol.analysisSteps,
        confidenceCalibration:
          this.pickString(agenticProtocol.confidenceCalibration) ||
          fallback.agenticProtocol.confidenceCalibration,
      },
      correctionLog: Array.isArray(parsed.correctionLog) ? (parsed.correctionLog as Array<Record<string, unknown>>) : [],
      evidenceStats,
    };
  }

  private buildChunks(message: V0StoredForumMessage | V0ParsedForumMessage): string[] {
    const content = (message.normalizedContent || message.rawContent || '').trim();
    if (!content) {
      return [];
    }

    const segments = content
      .split(/[\r\n。！？!?；;]+/g)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length <= 1) {
      return [content];
    }

    const chunks: string[] = [];
    let buffer = '';
    for (const segment of segments) {
      const candidate = buffer ? `${buffer} ${segment}` : segment;
      if (candidate.length > 500 && buffer) {
        chunks.push(buffer);
        buffer = segment;
      } else {
        buffer = candidate;
      }
    }

    if (buffer) {
      chunks.push(buffer);
    }

    return chunks.length > 0 ? chunks : [content];
  }

  private getHistoricalMessages(limit?: number): HistoricalMessageRow[] {
    const sql = `
      SELECT
        id,
        thread_key AS threadKey,
        floor_id AS floorId,
        author_name AS authorName,
        posted_at AS postedAt,
        raw_content AS rawContent,
        normalized_content AS normalizedContent,
        source_url AS sourceUrl
      FROM v0_forum_messages
      ORDER BY id ASC
      ${limit !== undefined ? 'LIMIT ?' : ''}
    `;
    const statement = this.database.prepare(sql);
    return (limit !== undefined ? statement.all(limit) : statement.all()) as HistoricalMessageRow[];
  }

  private getIndexedMessageCount(): number {
    const row = this.database
      .prepare('SELECT COUNT(DISTINCT message_id) AS count FROM v0_message_chunks')
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  private resolveDistillationTargets(authorNames?: string[]): string[] {
    if (authorNames && authorNames.length > 0) {
      return Array.from(
        new Set(
          authorNames
            .map((authorName) => authorName.replace(/^UID:/i, '').trim())
            .filter((authorName) => authorName.length > 0)
        )
      );
    }

    const chunkAuthors = this.database
      .prepare(
        `SELECT DISTINCT author_name AS authorName
         FROM v0_message_chunks
         ORDER BY author_name ASC`
      )
      .all() as Array<{ authorName: string }>;

    if (chunkAuthors.length > 0) {
      return Array.from(
        new Set(
          chunkAuthors
            .map((row) => row.authorName.replace(/^UID:/i, '').trim())
            .filter((authorName) => authorName.length > 0)
        )
      );
    }

    const legacyAuthors = this.database
      .prepare(
        `SELECT DISTINCT author_name AS authorName
         FROM v0_forum_messages
         ORDER BY author_name ASC`
      )
      .all() as Array<{ authorName: string }>;

    return Array.from(
      new Set(
        legacyAuthors
          .map((row) => row.authorName.replace(/^UID:/i, '').trim())
          .filter((authorName) => authorName.length > 0)
      )
    );
  }

  private prepareEmbeddingText(chunkText: string): string {
    return chunkText.replace(/\s+/g, ' ').trim().slice(0, 1200);
  }

  private lookupMessageId(threadKey: string, message: V0ParsedForumMessage): number {
    const row = this.database
      .prepare(
        `SELECT id
         FROM v0_forum_messages
         WHERE thread_key = ? AND floor_id = ? AND author_name = ?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(threadKey, message.floorId, message.authorName) as { id: number } | undefined;

    if (!row) {
      throw new Error(`unable to resolve stored message id for floor ${message.floorId}`);
    }

    return row.id;
  }

  private parseEmbedding(value: string): number[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => Number(item)).filter(Number.isFinite) : [];
    } catch {
      return [];
    }
  }

  private localEmbedding(text: string): number[] {
    const size = 64;
    const vector = Array.from({ length: size }, () => 0);
    const tokens = text
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .filter(Boolean);

    for (const token of tokens.length > 0 ? tokens : [text]) {
      const digest = crypto.createHash('sha256').update(token).digest();
      for (let index = 0; index < digest.length; index += 1) {
        vector[index % size] += digest[index] / 255;
      }
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude > 0 ? vector.map((value) => value / magnitude) : vector;
  }

  private async resolveEmbeddings(texts: string[]): Promise<{ embeddings: number[][]; modelName: string }> {
    const fallbackMode = (process.env.LLM_EMBEDDING_FALLBACK_MODE || '').trim().toLowerCase();
    if (fallbackMode === 'hash') {
      return {
        embeddings: texts.map((text) => this.localEmbedding(text)),
        modelName: 'hash-fallback-v1',
      };
    }

    if (!this.llmService.isEmbeddingEnabled()) {
      throw new Error(
        'LLM embeddings are not configured. Set LLM_EMBEDDING_BASE_URL and LLM_EMBEDDING_MODEL, or enable LLM_EMBEDDING_FALLBACK_MODE=hash for development.'
      );
    }

    try {
      return {
        embeddings: await this.llmService.embedTexts(texts),
        modelName: this.llmService.getEmbeddingModelName(),
      };
    } catch (error) {
      throw new Error(
        `LLM embeddings failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    if (left.length === 0 || right.length === 0 || left.length !== right.length) {
      return 0;
    }

    let dot = 0;
    let leftMagnitude = 0;
    let rightMagnitude = 0;
    for (let index = 0; index < left.length; index += 1) {
      dot += left[index] * right[index];
      leftMagnitude += left[index] * left[index];
      rightMagnitude += right[index] * right[index];
    }

    if (leftMagnitude === 0 || rightMagnitude === 0) {
      return 0;
    }

    return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
  }

  private hashChunk(chunkText: string): string {
    return crypto.createHash('sha256').update(chunkText).digest('hex');
  }

  private parseJsonObject(content: string): Record<string, unknown> | null {
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) {
      return null;
    }

    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private asRecordNumber(value: unknown): Record<string, number> {
    const record = this.asRecord(value);
    return Object.fromEntries(
      Object.entries(record)
        .map(([key, item]) => [key, Number(item)] as const)
        .filter(([, item]) => Number.isFinite(item))
    );
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.pickString(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private pickString(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.pickString(item)).filter(Boolean).join(' / ');
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return this.pickString(record.summary ?? record.value ?? record.label ?? record.description);
    }

    return '';
  }

  private clampConfidence(value: number): number {
    return Number(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)).toFixed(4));
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private inferRulesForBucket(
    bucket: V0PersonaEvidenceBucket,
    evidence: V0PersonaEvidenceRecord[]
  ): string[] {
    const hasEvidence = evidence.length > 0;
    switch (bucket) {
      case 'longformTheory':
        return hasEvidence ? ['从长篇理论和复盘中提炼稳定框架，优先作为模拟推演底座。'] : [];
      case 'intradayDecision':
        return hasEvidence ? ['盘中判断优先看承接、回封、量能和指数/情绪配合。'] : [];
      case 'riskWarning':
        return hasEvidence ? ['出现不确认、承接不足或回落信号时降低结论强度。'] : [];
      case 'sectorStockReasoning':
        return hasEvidence ? ['板块和个股需要同时看题材位置、资金反馈和具体标的强度。'] : [];
      case 'marketStructure':
        return hasEvidence ? ['先判断指数、黄白线、情绪和风格切换，再推导板块/个股。'] : [];
      case 'expressionStyle':
        return hasEvidence ? ['表达上保留条件式、提醒式和观察式语气。'] : [];
      case 'recentSignals':
        return hasEvidence ? ['近期信号只作为短期漂移补充，不覆盖长期方法论。'] : [];
      case 'contradictionCandidates':
        return hasEvidence ? ['前后观点冲突时优先标注边界，不强行合并为单一结论。'] : [];
      default:
        return [];
    }
  }

  private extractTopicMap(evidence: V0PersonaEvidenceRecord[]): V0PersonaProfileJsonV2['topicMap'] {
    const stocks: string[] = [];
    const sectors: string[] = [];
    const concepts: string[] = [];
    const macroVariables = ['指数', '情绪', '量能', '资金', '黄线', '白线'];

    for (const item of evidence) {
      for (const mention of item.mentions) {
        const cleaned = mention.replace(/^(stock|sector|yellow_line|white_line):/i, '').trim();
        if (!cleaned) {
          continue;
        }
        if (/^stock:/i.test(mention)) {
          stocks.push(cleaned);
        } else if (/^sector:/i.test(mention)) {
          sectors.push(cleaned);
        } else {
          concepts.push(cleaned);
        }
      }

      const matches = item.excerpt.match(/机器人|证券|算力|AI|传媒|芯片|新能源|军工|黄线|白线|指数|大盘|情绪|量能/g) ?? [];
      concepts.push(...matches);
    }

    return {
      stocks: this.uniqueStrings(stocks).slice(0, 24),
      sectors: this.uniqueStrings(sectors).slice(0, 24),
      concepts: this.uniqueStrings(concepts).slice(0, 32),
      macroVariables: this.uniqueStrings(macroVariables).slice(0, 16),
    };
  }

  private extractFrequentPhrases(evidence: V0PersonaEvidenceRecord[]): string[] {
    const phrases = ['先看', '观察', '确认', '承接', '不追', '再说'];
    const text = evidence.map((item) => item.excerpt).join('\n');
    return phrases.filter((phrase) => text.includes(phrase)).slice(0, 12);
  }

  private buildReferences(evidence: V0PersonaEvidenceRecord[]): V0AgentReference[] {
    return evidence.slice(0, 5).map((item) => ({
      messageId: item.messageId,
      authorName: item.authorName,
      postedAt: item.postedAt,
      rawContent: item.rawContent,
      mentions: item.mentions,
      marketSummaries: item.marketSummaries,
    }));
  }

  private parseEvidence(value: string): V0PersonaEvidenceRecord[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private buildResultFromProfile(profile: any, rebuilt: boolean, profileRunId: number): V0PersonaProfileResult {
    return {
      authorName: profile.authorName,
      profile,
      evidence: this.parseEvidence(profile.evidenceJson),
      run: {
        id: profileRunId,
        authorName: profile.authorName,
        triggerSource: 'agent',
        status: 'success',
        startedAt: profile.updatedAt,
        finishedAt: profile.lastBuiltAt,
        summaryText: profile.summaryText,
        errorMessage: '',
        metadataJson: '{}',
      },
      rebuilt,
    };
  }
}
