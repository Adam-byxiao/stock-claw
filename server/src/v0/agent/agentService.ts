import Database from 'better-sqlite3';
import { LLMService, AgentQueryIntent } from '../../core/llm';
import { V0MessageEnricher } from '../forum/messageEnricher';
import { V0MessageInsightStore } from '../forum/messageInsightStore';
import { V0MarketDataProvider } from '../market/marketBinding';
import { V0MarketFactsService } from '../market/marketFacts';
import { V0PersonaService } from '../persona/personaService';
import { sameAuthor, toBeijingDateString } from '../shared/authorIdentity';
import { addBeijingDays, toBeijingDateParts } from '../shared/time';
import {
  V0AgentQueryResponse,
  V0AgentReference,
  V0AuthorProfileRecord,
  V0MarketFactsResponse,
  V0MessageMarketState,
  V0MessageMention,
  V0PersonaEvidencePack,
  V0PersonaEvidenceRecord,
  V0PersonaInferenceCitation,
  V0PersonaInferencePayload,
  V0PersonaInferenceResponse,
  V0PersonaInferenceScenario,
  V0PersonaRecentWeightPayload,
  V0PersonaRecentWeightResponse,
  V0PersonaRecentWeightSignal,
} from '../shared/types';

type QueryType = V0AgentQueryResponse['queryType'];
type AgentIntentType = QueryType | 'market_analysis';

interface AgentMessageRow {
  id: number;
  authorName: string;
  postedAt: string;
  rawContent: string;
  normalizedContent: string;
  createdAt: string;
  mentions: V0MessageMention[];
  marketStates: V0MessageMarketState[];
}

interface WatchlistAuthor {
  authorName: string;
  alias: string | null;
}

interface AgentQueryPlan {
  intent: AgentIntentType;
  authorName: string | null;
  authorAlias: string | null;
  queryDate: string | null;
  topic: string | null;
  stockHints: string[];
  sectorHints: string[];
  usePersona: boolean;
  needsMarketOverview: boolean;
  confidence: number;
  clarify: string | null;
}

interface UnifiedAgentContext {
  query: string;
  plan: AgentQueryPlan;
  authorName: string | null;
  profile: V0AuthorProfileRecord | null;
  profileJson: Record<string, unknown>;
  profileEvidence: V0PersonaEvidenceRecord[];
  recentMessages: AgentMessageRow[];
  dateMessages: AgentMessageRow[];
  dateMessageTotalCount: number;
  relevantMessages: AgentMessageRow[];
  targetMessage: AgentMessageRow | null;
  queryMentions: V0MessageMention[];
  marketOverviewText: string;
  marketSnapshotsText: string[];
  marketFacts: V0MarketFactsResponse | null;
  references: V0AgentReference[];
}

interface PersonaInferenceDraft {
  summary: string;
  methodologyBasis: string[];
  currentFacts: string[];
  scenarioSimulations: V0PersonaInferenceScenario[];
  riskBoundaries: string[];
  missingInputs: string[];
}

interface RecentAxisDefinition {
  key: string;
  label: string;
  patterns: RegExp[];
  profileHints: string[];
}

const PERSONA_INFERENCE_BUCKET_LABELS: Record<string, string> = {
  longformTheory: '长篇理论',
  marketStructure: '市场结构',
  riskWarning: '风险提示',
  sectorStockReasoning: '板块个股',
  recentSignals: '近期信号',
  intradayDecision: '盘中决策',
  contradictionCandidates: '矛盾候选',
  expressionStyle: '表达风格',
};

const PERSONA_INFERENCE_BUCKET_PRIORITY = [
  'longformTheory',
  'marketStructure',
  'riskWarning',
  'sectorStockReasoning',
  'recentSignals',
  'intradayDecision',
  'contradictionCandidates',
  'expressionStyle',
];

const RECENT_WEIGHT_AXES: RecentAxisDefinition[] = [
  {
    key: 'marketStructure',
    label: '大盘结构',
    patterns: [/大盘|指数|黄线|白线|量能|缩量|放量|高开|低开|情绪|趋势|支撑|压力/],
    profileHints: ['marketStructure', '市场', '指数', '黄白线', '量能', '结构'],
  },
  {
    key: 'riskControl',
    label: '风险/仓位',
    patterns: [/风险|减仓|降仓|仓位|止损|防守|不追|清仓|亏损|杠杆|保命|谨慎|观察/],
    profileHints: ['riskWarning', 'riskHandling', '风险', '仓位', '止损', '防守'],
  },
  {
    key: 'sectorRotation',
    label: '板块轮动',
    patterns: [/板块|主线|题材|轮动|补涨|回流|防御|光伏|机器人|半导体|芯片|算力|存储|AI|金融|证券|银行|军工/],
    profileHints: ['sectorStockReasoning', '板块', '题材', '主线', '轮动'],
  },
  {
    key: 'stockExecution',
    label: '个股执行',
    patterns: [/个股|标的|回封|承接|买点|卖点|做T|加仓|开仓|低吸|追高|冲高|出货|龙头/],
    profileHints: ['intradayDecision', '个股', '承接', '买点', '卖点', '做T'],
  },
  {
    key: 'macroEvent',
    label: '宏观/事件',
    patterns: [/消息|新闻|传闻|IPO|政策|监管|利好|利空|发言|会议|宏观|外力|不确定性|落地/],
    profileHints: ['macroVariables', '消息', '政策', '宏观', '不确定性'],
  },
];

export class V0AgentService {
  constructor(
    private readonly database: Database.Database,
    private readonly insightStore: V0MessageInsightStore,
    private readonly marketProvider: V0MarketDataProvider,
    private readonly llmService: LLMService = new LLMService(),
    private readonly messageEnricher = new V0MessageEnricher(),
    private readonly personaService?: V0PersonaService,
    private readonly marketFactsService: V0MarketFactsService = new V0MarketFactsService(marketProvider)
  ) {}

  async query(userQuery: string, debug = false): Promise<V0AgentQueryResponse> {
    const normalizedQuery = userQuery.trim();
    if (!normalizedQuery) {
      return {
        queryType: 'fallback',
        answer: '先给我一个具体问题，我可以按作者、股票、板块或盘面来分析。',
        references: [],
      };
    }

    const plan = await this.resolveQueryPlan(normalizedQuery);
    let response: V0AgentQueryResponse;

    switch (plan.intent) {
      case 'author_profile':
        response = await this.buildAuthorProfile(plan, normalizedQuery);
        break;
      case 'author_daily_summary':
        response = await this.buildAuthorDailySummary(plan, normalizedQuery);
        break;
      case 'author_stock_status':
        response = await this.buildAuthorStockStatus(plan, normalizedQuery);
        break;
      case 'opinion_validation':
        response = await this.buildOpinionValidation(plan, normalizedQuery);
        break;
      case 'market_analysis':
        response = await this.buildMarketAnalysis(plan, normalizedQuery);
        break;
      default:
        response = await this.buildFallbackAnswer(plan, normalizedQuery);
    }

    if (!debug) {
      return response;
    }

    return {
      ...response,
      debugTrace: {
        plan,
        llmEnabled: this.llmService.isEnabled(),
        llmModel: this.llmService.isEnabled() ? this.llmService.getModelName() : 'disabled',
      },
    };
  }

  async inferWithPersona(
    payload: V0PersonaInferencePayload
  ): Promise<V0PersonaInferenceResponse> {
    const query = payload.query.trim();
    const watchlist = this.getWatchlistAuthors();
    const explicitAuthor = payload.authorName?.trim() ?? '';
    const matchedAuthor = explicitAuthor
      ? this.matchAuthor(explicitAuthor, watchlist).authorName ?? explicitAuthor
      : this.matchAuthor(query, watchlist).authorName;

    if (!matchedAuthor) {
      throw new Error('authorName is required or must match a watched author');
    }

    const localPlan = this.inferLocalPlan(query, watchlist);
    const queryDate = payload.queryDate ?? localPlan.queryDate ?? null;
    const plan: AgentQueryPlan = {
      ...localPlan,
      intent: 'market_analysis',
      authorName: matchedAuthor,
      authorAlias: localPlan.authorAlias,
      queryDate,
      topic: payload.eventText?.trim() || localPlan.topic || query.slice(0, 80),
      stockHints: this.uniqueStrings([...(payload.stockHints ?? []), ...localPlan.stockHints]),
      sectorHints: this.uniqueStrings([...(payload.sectorHints ?? []), ...localPlan.sectorHints]),
      usePersona: true,
      needsMarketOverview: true,
      confidence: Math.max(localPlan.confidence, 0.7),
      clarify: null,
    };
    const context = await this.buildUnifiedContext(plan, query);

    if (!context.profile) {
      throw new Error(`profile not found for ${matchedAuthor}`);
    }

    const evidencePack = this.buildPersonaEvidencePack(context, payload);
    const recentWeight = this.buildRecentWeightFromContext(context, payload.debug);
    const fallbackDraft = this.buildFallbackInferenceDraft(context, payload, evidencePack);
    const modelDraft = await this.buildModelPersonaInferenceDraft(
      context,
      payload,
      evidencePack,
      fallbackDraft
    );
    const draft = modelDraft ?? fallbackDraft;
    const normalized = this.normalizePersonaInferenceDraft(draft, fallbackDraft, evidencePack);
    const markdown = this.renderPersonaInferenceMarkdown(normalized, evidencePack);
    const debugTrace = payload.debug
      ? {
          plan,
          llmEnabled: this.llmService.isEnabled(),
          llmModel: this.llmService.isEnabled() ? this.llmService.getModelName() : 'disabled',
          contextStats: {
            profileEvidenceCount: context.profileEvidence.length,
            dateMessageTotalCount: context.dateMessageTotalCount,
            dateMessages: context.dateMessages.length,
            recentMessages: context.recentMessages.length,
            relevantMessages: context.relevantMessages.length,
            marketFactCount: context.marketFacts?.facts.length ?? 0,
            evidenceCitationCount: evidencePack.citations.length,
          },
        }
      : undefined;

    return {
      query,
      authorName: matchedAuthor,
      queryDate,
      summary: normalized.summary,
      methodologyBasis: normalized.methodologyBasis,
      currentFacts: normalized.currentFacts,
      evidencePack,
      scenarioSimulations: normalized.scenarioSimulations,
      riskBoundaries: normalized.riskBoundaries,
      missingInputs: normalized.missingInputs,
      evidenceCitations: evidencePack.citations,
      marketFacts: context.marketFacts ?? undefined,
      recentWeight,
      markdown,
      debugTrace,
    };
  }

  async analyzeRecentWeights(
    payload: V0PersonaRecentWeightPayload
  ): Promise<V0PersonaRecentWeightResponse> {
    const query = payload.query.trim();
    const watchlist = this.getWatchlistAuthors();
    const explicitAuthor = payload.authorName?.trim() ?? '';
    const matchedAuthor = explicitAuthor
      ? this.matchAuthor(explicitAuthor, watchlist).authorName ?? explicitAuthor
      : this.matchAuthor(query, watchlist).authorName;

    if (!matchedAuthor) {
      throw new Error('authorName is required or must match a watched author');
    }

    const localPlan = this.inferLocalPlan(query, watchlist);
    const queryDate = payload.queryDate ?? localPlan.queryDate ?? null;
    const plan: AgentQueryPlan = {
      ...localPlan,
      intent: 'market_analysis',
      authorName: matchedAuthor,
      authorAlias: localPlan.authorAlias,
      queryDate,
      topic: localPlan.topic || query.slice(0, 80),
      stockHints: localPlan.stockHints,
      sectorHints: localPlan.sectorHints,
      usePersona: true,
      needsMarketOverview: false,
      confidence: Math.max(localPlan.confidence, 0.65),
      clarify: null,
    };
    const context = await this.buildUnifiedContext(plan, query);

    if (!context.profile) {
      throw new Error(`profile not found for ${matchedAuthor}`);
    }

    const sampleSize = this.clampInteger(payload.sampleSize ?? 20, 5, 80);
    const recentMessages = this.rankRecentMessages(context.recentMessages, sampleSize);
    const recentEvidence = this.buildRecentWeightEvidence(context, recentMessages, sampleSize);
    const recentSignals = this.buildRecentWeightSignals(context, recentMessages, recentEvidence);
    const baselineSummary = this.buildRecentWeightBaseline(context);
    const recentFocus = this.buildRecentWeightFocus(recentSignals, recentEvidence);
    const methodologyBasis = this.buildRecentWeightMethodology(context, recentSignals);
    const summary = this.buildRecentWeightSummary(context, recentSignals, recentFocus);
    const markdown = this.renderRecentWeightMarkdown({
      authorName: matchedAuthor,
      queryDate,
      sampleSize,
      summary,
      baselineSummary,
      recentFocus,
      recentSignals,
      recentEvidence,
      methodologyBasis,
      missingInputs: this.buildRecentWeightMissingInputs(context, recentMessages),
    });
    const citations = this.buildRecentWeightCitations(recentSignals, recentEvidence);

    return {
      query,
      authorName: matchedAuthor,
      queryDate,
      sampleSize,
      summary,
      baselineSummary,
      recentFocus,
      recentSignals,
      recentEvidence,
      methodologyBasis,
      missingInputs: this.buildRecentWeightMissingInputs(context, recentMessages),
      evidenceCitations: citations,
      markdown,
      debugTrace: payload.debug
        ? {
            plan,
            profileVersion: context.profile?.profileVersion ?? null,
            recentMessageCount: context.recentMessages.length,
            sampleSize,
            signalKeys: recentSignals.map((item) => item.key),
          }
        : undefined,
    };
  }

  private rankRecentMessages(messages: AgentMessageRow[], limit: number): AgentMessageRow[] {
    return [...messages]
      .sort((left, right) =>
        (right.postedAt || right.createdAt).localeCompare(left.postedAt || left.createdAt)
      )
      .slice(0, limit);
  }

  private buildRecentWeightEvidence(
    context: UnifiedAgentContext,
    recentMessages: AgentMessageRow[],
    limit: number
  ): V0PersonaInferenceCitation[] {
    const citations: V0PersonaInferenceCitation[] = recentMessages.slice(0, limit).map((message, index) => ({
      id: `recent-weight-${message.id}`,
      source: 'recent_message',
      title: `近期发言 ${index + 1}`,
      excerpt: message.rawContent,
      postedAt: message.postedAt || message.createdAt,
      messageId: message.id,
      confidence: this.scoreRecentMessage(message, index),
    }));

    const recentEvidence = context.profileEvidence
      .filter((item) => item.bucket === 'recentSignals')
      .slice()
      .sort(
        (left, right) =>
          right.postedAt.localeCompare(left.postedAt) ||
          (right.qualityScore ?? 0) - (left.qualityScore ?? 0)
      )
      .slice(0, Math.max(0, limit - citations.length))
      .map((item, index): V0PersonaInferenceCitation => ({
        id: `recent-profile-${item.chunkId}`,
        source: 'profile_evidence',
        bucket: 'recentSignals',
        title: `画像近期证据 ${index + 1}`,
        excerpt: item.excerpt,
        postedAt: item.postedAt,
        messageId: item.messageId,
        floorId: item.floorId,
        confidence: item.qualityScore,
      }));

    return [...citations, ...recentEvidence].slice(0, limit);
  }

  private buildRecentWeightSignals(
    context: UnifiedAgentContext,
    recentMessages: AgentMessageRow[],
    recentEvidence: V0PersonaInferenceCitation[]
  ): V0PersonaRecentWeightSignal[] {
    const baselineWeights = this.buildProfileAxisWeights(context);
    const scoredAxes = RECENT_WEIGHT_AXES.map((axis) => {
      const matchedMessages = recentMessages.filter((message) =>
        axis.patterns.some((pattern) => pattern.test(`${message.rawContent} ${message.normalizedContent}`))
      );
      const matchedEvidence = recentEvidence.filter((item) =>
        axis.patterns.some((pattern) => pattern.test(item.excerpt))
      );
      return {
        axis,
        evidenceCount: matchedMessages.length + matchedEvidence.length,
        examples: this.uniqueStrings([
          ...matchedMessages.map((message) => message.rawContent),
          ...matchedEvidence.map((item) => item.excerpt),
        ]).slice(0, 3),
      };
    });
    const totalEvidence = scoredAxes.reduce((sum, item) => sum + item.evidenceCount, 0);
    const fallbackWeight = Number((1 / RECENT_WEIGHT_AXES.length).toFixed(4));

    return scoredAxes
      .map((item) => {
        const weight = totalEvidence > 0
          ? Number((item.evidenceCount / totalEvidence).toFixed(4))
          : fallbackWeight;
        const baseline = baselineWeights[item.axis.key] ?? fallbackWeight;
        const delta = Number((weight - baseline).toFixed(4));
        const direction: V0PersonaRecentWeightSignal['direction'] =
          Math.abs(delta) < 0.08 ? 'flat' : delta > 0 ? 'up' : 'down';
        return {
          key: item.axis.key,
          label: item.axis.label,
          weight,
          deltaFromProfile: delta,
          direction,
          evidenceCount: item.evidenceCount,
          examples: item.examples,
        };
      })
      .sort((left, right) => right.weight - left.weight || right.evidenceCount - left.evidenceCount);
  }

  private buildProfileAxisWeights(context: UnifiedAgentContext): Record<string, number> {
    const profileText = JSON.stringify({
      profile: context.profileJson,
      evidence: context.profileEvidence.slice(0, 80).map((item) => ({
        bucket: item.bucket,
        excerpt: item.excerpt,
      })),
    });
    const scores: Record<string, number> = {};

    for (const axis of RECENT_WEIGHT_AXES) {
      const hintScore = axis.profileHints.reduce(
        (sum, hint) => sum + (profileText.includes(hint) ? 1 : 0),
        0
      );
      const evidenceScore = context.profileEvidence.filter((item) =>
        axis.patterns.some((pattern) => pattern.test(item.excerpt))
      ).length;
      scores[axis.key] = hintScore * 2 + evidenceScore;
    }

    const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      const equal = Number((1 / RECENT_WEIGHT_AXES.length).toFixed(4));
      return Object.fromEntries(RECENT_WEIGHT_AXES.map((axis) => [axis.key, equal]));
    }

    return Object.fromEntries(
      RECENT_WEIGHT_AXES.map((axis) => [axis.key, Number(((scores[axis.key] ?? 0) / total).toFixed(4))])
    );
  }

  private buildRecentWeightBaseline(context: UnifiedAgentContext): string {
    const profileJson = context.profileJson;
    const coreRules = this.pickStringArray(profileJson.coreRules).slice(0, 3);
    const methodology = this.pickRecord(profileJson.marketMethodology);
    const reasoningSteps = this.pickStringArray(methodology.reasoningSteps).slice(0, 3);
    const confidence = this.pickConfidence(profileJson);
    return [
      context.profile?.summaryText || this.pickString(profileJson.summaryText) || `${context.authorName} 的历史画像提供长期方法论底座。`,
      coreRules.length > 0 ? `长期核心规则：${coreRules.join('；')}` : '',
      reasoningSteps.length > 0 ? `长期推理步骤：${reasoningSteps.join(' -> ')}` : '',
      `历史画像置信度 ${Math.round(confidence * 100)}%。`,
    ].filter(Boolean).join('\n');
  }

  private buildRecentWeightFocus(
    signals: V0PersonaRecentWeightSignal[],
    recentEvidence: V0PersonaInferenceCitation[]
  ): string[] {
    const activeSignals = signals
      .filter((signal) => signal.evidenceCount > 0)
      .slice(0, 4)
      .map((signal) => `${signal.label}：近期权重 ${Math.round(signal.weight * 100)}%，相对历史 ${signal.direction === 'up' ? '上升' : signal.direction === 'down' ? '下降' : '持平'}`);
    const keywordFocus = this.uniqueStrings(
      recentEvidence
        .flatMap((item) => this.extractKeywords(item.excerpt))
        .filter((keyword) => keyword.length >= 2)
    ).slice(0, 8);

    return [
      ...activeSignals,
      keywordFocus.length > 0 ? `近期高频词：${keywordFocus.join(' / ')}` : '',
    ].filter(Boolean);
  }

  private buildRecentWeightMethodology(
    context: UnifiedAgentContext,
    signals: V0PersonaRecentWeightSignal[]
  ): string[] {
    const profileJson = context.profileJson;
    const methodology = this.pickRecord(profileJson.marketMethodology);
    const protocol = this.pickRecord(profileJson.agenticProtocol);
    const topSignals = signals.slice(0, 3).map((signal) => signal.label).join('、');
    return [
      '长期画像只提供方法论底座，不直接覆盖当前焦点。',
      topSignals ? `近期分析优先观察：${topSignals}。` : '',
      ...this.pickStringArray(methodology.coreVariables).slice(0, 3).map((item) => `历史核心变量：${item}`),
      ...this.pickStringArray(protocol.analysisSteps).slice(0, 3).map((item) => `分析协议：${item}`),
    ].filter(Boolean);
  }

  private buildRecentWeightSummary(
    context: UnifiedAgentContext,
    signals: V0PersonaRecentWeightSignal[],
    recentFocus: string[]
  ): string {
    const topSignal = signals[0];
    if (!topSignal || topSignal.evidenceCount === 0) {
      return `基于 ${context.authorName} 的历史画像，近期样本不足，当前仍以长期方法论作为主依据。`;
    }

    return `基于 ${context.authorName} 的历史画像作为底座，近期发言焦点更集中在“${topSignal.label}”，本轮推演应把近期线索作为短期权重覆盖层，而不是替代长期规则。${recentFocus[0] ? ` ${recentFocus[0]}` : ''}`;
  }

  private buildRecentWeightMissingInputs(
    context: UnifiedAgentContext,
    recentMessages: AgentMessageRow[]
  ): string[] {
    return [
      recentMessages.length > 0 ? '' : '缺少近期发言样本，无法判断短期权重漂移。',
      context.profile ? '' : '缺少 V2 历史画像，无法建立长期基准。',
      context.dateMessageTotalCount === 0 && context.plan.queryDate ? '指定日期没有作者直接发言，近期权重来自最近样本。' : '',
      '近期权重是内容频率和证据强度分析，不等同于作者实际仓位或真实交易动作。',
    ].filter(Boolean);
  }

  private buildRecentWeightCitations(
    signals: V0PersonaRecentWeightSignal[],
    recentEvidence: V0PersonaInferenceCitation[]
  ): V0PersonaInferenceCitation[] {
    const signalCitations = signals.slice(0, 5).map((signal): V0PersonaInferenceCitation => ({
      id: `recent-signal-${signal.key}`,
      source: 'profile_methodology',
      title: `近期权重：${signal.label}`,
      excerpt: `近期权重 ${Math.round(signal.weight * 100)}%，相对历史 ${signal.deltaFromProfile >= 0 ? '+' : ''}${Math.round(signal.deltaFromProfile * 100)}%，证据 ${signal.evidenceCount} 条。`,
      confidence: Math.max(0.4, Math.min(0.95, signal.weight + 0.35)),
    }));

    return [...signalCitations, ...recentEvidence].slice(0, 30);
  }

  private renderRecentWeightMarkdown(input: {
    authorName: string;
    queryDate: string | null;
    sampleSize: number;
    summary: string;
    baselineSummary: string;
    recentFocus: string[];
    recentSignals: V0PersonaRecentWeightSignal[];
    recentEvidence: V0PersonaInferenceCitation[];
    methodologyBasis: string[];
    missingInputs: string[];
  }): string {
    return [
      `### 近期权重分析：${input.authorName}`,
      '',
      input.summary,
      '',
      `- 查询日期：${input.queryDate ?? '未指定'}`,
      `- 样本上限：${input.sampleSize}`,
      '',
      '### 历史方法论底座',
      input.baselineSummary,
      '',
      '### 近期焦点',
      ...input.recentFocus.map((item) => `- ${item}`),
      '',
      '### 权重漂移',
      ...input.recentSignals.map(
        (signal) =>
          `- ${signal.label}：${Math.round(signal.weight * 100)}%，相对历史 ${signal.deltaFromProfile >= 0 ? '+' : ''}${Math.round(signal.deltaFromProfile * 100)}%，${signal.direction}`
      ),
      '',
      '### 方法论约束',
      ...input.methodologyBasis.map((item) => `- ${item}`),
      '',
      '### 缺失与边界',
      ...input.missingInputs.map((item) => `- ${item}`),
      '',
      '### 近期证据',
      ...input.recentEvidence.slice(0, 8).map((item) => `- [${item.id}] ${item.excerpt}`),
    ].join('\n');
  }

  private buildRecentWeightFromContext(
    context: UnifiedAgentContext,
    debug?: boolean
  ): V0PersonaRecentWeightResponse {
    const sampleSize = 20;
    const recentMessages = this.rankRecentMessages(context.recentMessages, sampleSize);
    const recentEvidence = this.buildRecentWeightEvidence(context, recentMessages, sampleSize);
    const recentSignals = this.buildRecentWeightSignals(context, recentMessages, recentEvidence);
    const baselineSummary = this.buildRecentWeightBaseline(context);
    const recentFocus = this.buildRecentWeightFocus(recentSignals, recentEvidence);
    const methodologyBasis = this.buildRecentWeightMethodology(context, recentSignals);
    const missingInputs = this.buildRecentWeightMissingInputs(context, recentMessages);
    const summary = this.buildRecentWeightSummary(context, recentSignals, recentFocus);

    return {
      query: context.query,
      authorName: context.authorName ?? '',
      queryDate: context.plan.queryDate,
      sampleSize,
      summary,
      baselineSummary,
      recentFocus,
      recentSignals,
      recentEvidence,
      methodologyBasis,
      missingInputs,
      evidenceCitations: this.buildRecentWeightCitations(recentSignals, recentEvidence),
      markdown: this.renderRecentWeightMarkdown({
        authorName: context.authorName ?? '',
        queryDate: context.plan.queryDate,
        sampleSize,
        summary,
        baselineSummary,
        recentFocus,
        recentSignals,
        recentEvidence,
        methodologyBasis,
        missingInputs,
      }),
      debugTrace: debug
        ? {
            recentMessageCount: context.recentMessages.length,
            sampleSize,
            signalKeys: recentSignals.map((item) => item.key),
          }
        : undefined,
    };
  }

  private scoreRecentMessage(message: AgentMessageRow, index: number): number {
    const mentionBoost = Math.min(0.15, message.mentions.length * 0.03);
    const marketBoost = Math.min(0.1, message.marketStates.length * 0.03);
    const recencyPenalty = Math.min(0.25, index * 0.01);
    return Number(Math.max(0.35, Math.min(0.95, 0.75 + mentionBoost + marketBoost - recencyPenalty)).toFixed(4));
  }

  private clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }

    return Math.max(min, Math.min(max, Math.round(value)));
  }

  private async resolveQueryPlan(query: string): Promise<AgentQueryPlan> {
    const watchlist = this.getWatchlistAuthors();
    const localPlan = this.inferLocalPlan(query, watchlist);
    const modelPlan = await this.llmService.parseAgentIntent({
      query,
      referenceDate: toBeijingDateString(),
      knownAuthors: watchlist,
    });

    const mergedPlan = this.mergePlans(localPlan, modelPlan);
    const authorName = this.resolveAuthorName(query, mergedPlan, watchlist);

    return this.finalizePlan(query, mergedPlan, authorName);
  }

  private inferLocalPlan(query: string, watchlist: WatchlistAuthor[]): AgentQueryPlan {
    const author = this.matchAuthor(query, watchlist);
    const queryDate = this.extractQueryDate(query);
    const stockHints = this.extractStockHints(query);
    const sectorHints = this.extractSectorHints(query);
    const topic = this.extractTopic(query);

    let intent: AgentIntentType = 'fallback';
    if (this.isProfileQuery(query)) {
      intent = 'author_profile';
    } else if (this.isDailySummaryQuery(query)) {
      intent = 'author_daily_summary';
    } else if (this.isStockStatusQuery(query)) {
      intent = 'author_stock_status';
    } else if (this.isValidationQuery(query)) {
      intent = 'opinion_validation';
    } else if (this.isMarketAnalysisQuery(query)) {
      intent = 'market_analysis';
    }

    return {
      intent,
      authorName: author.authorName,
      authorAlias: author.alias,
      queryDate,
      topic,
      stockHints,
      sectorHints,
      usePersona: Boolean(author.authorName),
      needsMarketOverview:
        intent === 'market_analysis' || intent === 'author_stock_status' || intent === 'opinion_validation',
      confidence: author.authorName ? 0.7 : 0.5,
      clarify: null,
    };
  }

  private mergePlans(localPlan: AgentQueryPlan, modelPlan: AgentQueryIntent | null): AgentQueryPlan {
    if (!modelPlan) {
      return localPlan;
    }

    const intent =
      localPlan.intent === 'fallback'
        ? this.normalizeIntent(modelPlan.intent, localPlan.intent)
        : localPlan.intent;
    return {
      intent,
      authorName: modelPlan.authorName ?? localPlan.authorName,
      authorAlias: modelPlan.authorAlias ?? localPlan.authorAlias,
      queryDate: modelPlan.queryDate ?? localPlan.queryDate,
      topic: modelPlan.topic ?? localPlan.topic,
      stockHints: this.uniqueStrings([...(localPlan.stockHints ?? []), ...(modelPlan.stockHints ?? [])]),
      sectorHints: this.uniqueStrings([...(localPlan.sectorHints ?? []), ...(modelPlan.sectorHints ?? [])]),
      usePersona: modelPlan.usePersona ?? localPlan.usePersona,
      needsMarketOverview: modelPlan.needsMarketOverview ?? localPlan.needsMarketOverview,
      confidence: Math.max(localPlan.confidence, modelPlan.confidence ?? 0),
      clarify: modelPlan.clarify ?? localPlan.clarify,
    };
  }

  private finalizePlan(
    query: string,
    plan: AgentQueryPlan,
    resolvedAuthorName: string | null
  ): AgentQueryPlan {
    const authorName = resolvedAuthorName ?? plan.authorName ?? null;
    const fallbackIntent =
      plan.intent === 'fallback'
        ? this.resolveFallbackIntent(query, authorName, plan.queryDate)
        : plan.intent;

    return {
      ...plan,
      intent: fallbackIntent,
      authorName,
      usePersona: Boolean(authorName) || plan.usePersona,
      needsMarketOverview:
        plan.needsMarketOverview || fallbackIntent === 'market_analysis' || plan.intent === 'market_analysis',
    };
  }

  private resolveFallbackIntent(
    query: string,
    authorName: string | null,
    queryDate: string | null
  ): AgentIntentType {
    if (authorName && this.isDailySummaryQuery(query)) {
      return 'author_daily_summary';
    }

    if (authorName && this.isStockStatusQuery(query)) {
      return 'author_stock_status';
    }

    if (this.isProfileQuery(query)) {
      return 'author_profile';
    }

    if (this.isValidationQuery(query)) {
      return 'opinion_validation';
    }

    if (this.isMarketAnalysisQuery(query) || Boolean(queryDate)) {
      return 'market_analysis';
    }

    return 'fallback';
  }

  private normalizeIntent(
    candidate: AgentQueryIntent['intent'] | undefined,
    fallback: AgentIntentType
  ): AgentIntentType {
    if (
      candidate === 'author_profile' ||
      candidate === 'author_daily_summary' ||
      candidate === 'author_stock_status' ||
      candidate === 'opinion_validation' ||
      candidate === 'market_analysis' ||
      candidate === 'fallback'
    ) {
      return candidate;
    }

    return fallback;
  }

  private resolveAuthorName(
    query: string,
    plan: AgentQueryPlan,
    watchlist: WatchlistAuthor[]
  ): string | null {
    const authorCandidates = [
      plan.authorName,
      plan.authorAlias,
      ...watchlist.map((item) => item.authorName),
      ...watchlist.map((item) => item.alias ?? ''),
    ]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim());

    for (const candidate of authorCandidates) {
      const matched = this.matchAuthor(candidate, watchlist);
      if (matched.authorName) {
        return matched.authorName;
      }
    }

    return this.matchAuthor(query, watchlist).authorName;
  }

  private matchAuthor(query: string, watchlist: WatchlistAuthor[]): { authorName: string | null; alias: string | null } {
    for (const author of watchlist) {
      if (sameAuthor(query, author.authorName) || query.includes(author.authorName)) {
        return { authorName: author.authorName, alias: author.alias };
      }

      if (author.alias && (sameAuthor(query, author.alias) || query.includes(author.alias))) {
        return { authorName: author.authorName, alias: author.alias };
      }
    }

    return { authorName: null, alias: null };
  }

  private getWatchlistAuthors(): WatchlistAuthor[] {
    return this.database
      .prepare(
        `SELECT
          author_name AS authorName,
          alias
         FROM v0_author_watchlist
         WHERE enabled = 1
         ORDER BY id ASC`
      )
      .all() as WatchlistAuthor[];
  }

  private async buildAuthorProfile(
    plan: AgentQueryPlan,
    query: string
  ): Promise<V0AgentQueryResponse> {
    if (!plan.authorName) {
      return {
        queryType: 'author_profile',
        answer: '我先按盘面和论坛线索给你粗看一下；如果你想看某个作者画像，补上作者名会更准。',
        references: [],
      };
    }

    const context = await this.buildUnifiedContext(plan, query);
    const baseAnswer = this.buildProfileLead(context);
    const answer = await this.composeAnswer(context, baseAnswer);
    return {
      queryType: 'author_profile',
      answer,
      references: context.references,
    };
  }

  private async buildAuthorDailySummary(
    plan: AgentQueryPlan,
    query: string
  ): Promise<V0AgentQueryResponse> {
    if (!plan.authorName) {
      return {
        queryType: 'author_daily_summary',
        answer: '我先按盘面和论坛共识给你做个粗分析；如果你要看某位作者的当天发言，直接带上名字就行。',
        references: [],
      };
    }

    const context = await this.buildUnifiedContext(plan, query);
    if (context.dateMessages.length === 0) {
      return {
        queryType: 'author_daily_summary',
        answer: `今天还没有抓到 ${plan.authorName} 的发言。`,
        references: [],
      };
    }

    const baseAnswer = this.buildDailySummaryLead(context);
    const answer = await this.composeAnswer(context, baseAnswer);
    return {
      queryType: 'author_daily_summary',
      answer,
      references: context.references,
    };
  }

  private async buildAuthorStockStatus(
    plan: AgentQueryPlan,
    query: string
  ): Promise<V0AgentQueryResponse> {
    if (!plan.authorName) {
      return {
        queryType: 'author_stock_status',
        answer: '我先按盘面给你一个初步判断；如果你想看某位作者提到的个股，补上作者名会更准。',
        references: [],
      };
    }

    const context = await this.buildUnifiedContext(plan, query);
    if (!context.targetMessage) {
      if (context.profile || context.marketSnapshotsText.length > 0) {
        const targetNames = context.queryMentions
          .map((mention) => mention.entityName)
          .filter(Boolean)
          .join(' / ');
        const baseAnswer = [
          `暂时没有找到 ${plan.authorName} 直接提到 ${targetNames || '该标的'} 的发言。`,
          context.profile
            ? `改用 ${plan.authorName} 的历史画像和方法论做模拟判断：${context.profile.summaryText}`
            : '',
          context.marketSnapshotsText.length > 0
            ? `当前快照：${context.marketSnapshotsText.slice(0, 4).join('；')}`
            : '',
        ].filter(Boolean).join('\n');
        const answer = await this.composeAnswer(context, baseAnswer);
        return {
          queryType: 'author_stock_status',
          answer,
          references: context.references,
        };
      }

      return {
        queryType: 'author_stock_status',
        answer: `今天还没有找到 ${plan.authorName} 提到相关股票的发言。`,
        references: [],
      };
    }

    const baseAnswer = this.buildStockLead(context);
    const answer = await this.composeAnswer(context, baseAnswer);
    return {
      queryType: 'author_stock_status',
      answer,
      references: context.references,
    };
  }

  private async buildOpinionValidation(
    plan: AgentQueryPlan,
    query: string
  ): Promise<V0AgentQueryResponse> {
    const context = await this.buildUnifiedContext(plan, query);
    if (!context.targetMessage) {
      return {
        queryType: 'opinion_validation',
        answer: plan.authorName
          ? `我先没找到 ${plan.authorName} 的直接证据，暂时只能给粗判断。`
          : '我先没找到可直接验证的观点证据，暂时只能给粗判断。',
        references: [],
      };
    }

    const baseAnswer = this.buildValidationLead(context);
    const answer = await this.composeAnswer(context, baseAnswer);
    return {
      queryType: 'opinion_validation',
      answer,
      references: [this.toReference(context.targetMessage)],
    };
  }

  private async buildMarketAnalysis(
    plan: AgentQueryPlan,
    query: string
  ): Promise<V0AgentQueryResponse> {
    const context = await this.buildUnifiedContext(plan, query);
    const baseAnswer = this.buildMarketAnalysisLead(context);
    const answer = await this.composeAnswer(context, baseAnswer);

    return {
      queryType: 'market_analysis',
      answer,
      references: context.references,
    };
  }

  private async buildFallbackAnswer(
    plan: AgentQueryPlan,
    query: string
  ): Promise<V0AgentQueryResponse> {
    const context = await this.buildUnifiedContext(plan, query);
    const baseAnswer = this.buildFallbackLead(context);
    const answer = await this.composeAnswer(context, baseAnswer);
    return {
      queryType: 'fallback',
      answer,
      references: context.references,
    };
  }

  private async buildUnifiedContext(
    plan: AgentQueryPlan,
    query: string
  ): Promise<UnifiedAgentContext> {
    const queryMentions = this.extractQueryMentions(query);
    const dateMessages = this.getMessages({
      authorName: plan.authorName,
      date: plan.queryDate,
      limit: plan.intent === 'market_analysis' ? 30 : 20,
    });
    const dateMessageTotalCount = plan.queryDate
      ? this.countMessages({
          authorName: plan.authorName,
          date: plan.queryDate,
        })
      : dateMessages.length;
    const recentMessages = this.getMessages({
      authorName: plan.authorName,
      date: null,
      limit: 20,
    });
    const relevantMessages = this.findRelevantMessages(
      plan,
      query,
      recentMessages,
      dateMessages,
      queryMentions
    );
    const targetMessage = relevantMessages[0] ?? dateMessages[0] ?? recentMessages[0] ?? null;
    let profileResult =
      plan.authorName && this.personaService ? this.personaService.getAuthorProfile(plan.authorName) : null;
    if (!profileResult && plan.authorName && this.personaService) {
      try {
        profileResult = await this.personaService.rebuildAuthorProfile(plan.authorName, {
          recentChunkLimit: 200,
          evidencePoolSize: 200,
        });
      } catch (error) {
        console.warn(
          'V0 Agent profile rebuild failed:',
          error instanceof Error ? error.message : error
        );
      }
    }
    const profile = profileResult?.profile ?? null;
    const profileJson = profile ? this.safeParseJson(profile.profileJson) : {};
    const profileEvidence =
      profileResult?.evidence ?? (profile ? this.safeParseEvidence(profile.evidenceJson) : []);
    const marketFacts = await this.buildMarketFacts(plan, queryMentions, relevantMessages);
    const marketOverviewText = await this.buildMarketOverviewText(plan, marketFacts);
    const marketSnapshotsText = await this.buildMarketSnapshotText(
      plan,
      queryMentions,
      relevantMessages,
      marketFacts
    );
    const references = this.buildReferences({
      profileEvidence,
      recentMessages,
      dateMessages,
      relevantMessages,
      targetMessage,
    });

    return {
      query,
      plan,
      authorName: plan.authorName,
      profile,
      profileJson,
      profileEvidence,
      recentMessages,
      dateMessages,
      dateMessageTotalCount,
      relevantMessages,
      targetMessage,
      queryMentions,
      marketOverviewText,
      marketSnapshotsText,
      marketFacts,
      references,
    };
  }

  private buildProfileLead(context: UnifiedAgentContext): string {
    if (!context.profile) {
      return '当前还没有生成稳定的人物画像，我先按最近消息做判断。';
    }

    if (context.profileJson.schemaVersion === 2) {
      const coreRules = this.pickStringArray(context.profileJson.coreRules).slice(0, 5);
      const methodology = this.pickRecord(context.profileJson.marketMethodology);
      const topicMap = this.pickRecord(context.profileJson.topicMap);
      const confidence = this.pickRecord(context.profileJson.evidenceQuality).confidence;
      return [
        context.profile.summaryText || this.pickString(context.profileJson.summaryText) || '暂无摘要',
        coreRules.length > 0 ? `核心规则：${coreRules.join(' / ')}` : '',
        this.pickStringArray(methodology.coreVariables).length > 0
          ? `关键变量：${this.pickStringArray(methodology.coreVariables).slice(0, 6).join(' / ')}`
          : '',
        this.pickStringArray(methodology.reasoningSteps).length > 0
          ? `分析流程：${this.pickStringArray(methodology.reasoningSteps).slice(0, 4).join(' -> ')}`
          : '',
        this.pickStringArray(topicMap.concepts).length > 0
          ? `高频主题：${this.pickStringArray(topicMap.concepts).slice(0, 8).join(' / ')}`
          : '',
        typeof confidence === 'number' ? `证据置信度：${Math.round(confidence * 100)}%` : '',
      ].filter(Boolean).join('\n');
    }

    const summary = context.profile.summaryText || '暂无摘要';
    const axes = this.pickString(context.profileJson.axes);
    const themes = this.pickStringArray(context.profileJson.themes).slice(0, 5);
    const lines = [
      summary,
      axes ? `画像轴：${axes}` : '',
      themes.length > 0 ? `主题：${themes.join(' / ')}` : '',
      context.marketOverviewText ? `盘面：${context.marketOverviewText}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  private buildDailySummaryLead(context: UnifiedAgentContext): string {
    const dateLabel = context.plan.queryDate && context.plan.queryDate !== this.todayString()
      ? context.plan.queryDate
      : '今天';
    const lines = context.dateMessages.slice(0, 5).map((message) => {
      const time = message.postedAt || message.createdAt;
      return `- ${time} ${message.rawContent}`;
    });

    return [`${dateLabel}共抓到 ${context.authorName ?? ''} 的 ${context.dateMessageTotalCount} 条命中发言。`, ...lines]
      .filter(Boolean)
      .join('\n');
  }

  private buildStockLead(context: UnifiedAgentContext): string {
    const message = context.targetMessage;
    if (!message) {
      return '当前还没有找到可以直接对应到股票的消息。';
    }

    const stockMention = message.mentions.find((mention) => mention.entityType === 'stock');
    const stockSnapshot = this.findStockSnapshotText(context.marketSnapshotsText, stockMention?.entityName ?? '');
    const stateSummary = message.marketStates.find((state) => state.subjectType === 'stock')?.summaryText ?? '';
    const adviceText =
      message.marketStates.find((state) => state.subjectType === 'stock')?.adviceText ??
      '建议继续结合承接和盘面变化观察。';

    return [
      `${context.authorName} 提到的 ${stockMention?.entityName ?? '相关股票'} 当前 ${stockSnapshot || '暂无实时快照'}.`,
      stateSummary,
      adviceText,
      `原话：${message.rawContent}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildValidationLead(context: UnifiedAgentContext): string {
    const message = context.targetMessage;
    if (!message) {
      return '当前还没有找到足够的证据来验证这个观点。';
    }

    const state = this.selectMarketState(message, context.queryMentions);
    const lowerSummary = `${state?.summaryText ?? ''} ${state?.adviceText ?? ''}`.trim();
    const validationText = this.buildValidationText(lowerSummary);
    const prefix = context.authorName ? `${context.authorName} 的这个观点` : '这个观点';

    return [
      `${prefix}${validationText}`,
      state?.summaryText ?? '目前没有更多实时联动摘要。',
      state?.adviceText ?? '建议继续观察盘面后再下结论。',
      `原话：${message.rawContent}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private buildMarketAnalysisLead(context: UnifiedAgentContext): string {
    const parts: string[] = [];
    const authorLabel =
      context.plan.authorAlias && context.plan.authorAlias !== context.authorName
        ? `${context.plan.authorAlias}（${context.authorName}）`
        : context.authorName;

    if (authorLabel && context.profile) {
      parts.push(`基于 ${authorLabel} 的历史画像和方法论做模拟推演：${context.profile.summaryText}`);
    } else if (authorLabel) {
      parts.push(`先按 ${authorLabel} 的历史发言和近期线索做模拟推演。`);
    } else {
      parts.push('先按当前盘面、论坛线索和已有画像材料做综合推演。');
    }

    if (context.plan.queryDate) {
      parts.push(
        `${context.plan.queryDate} 的命中发言共 ${context.dateMessageTotalCount} 条，本次送入上下文 ${context.dateMessages.length} 条。`
      );
      if (context.dateMessageTotalCount === 0 && context.profile) {
        parts.push('当天没有命中发言时，仍以人物画像、长期经验和可见盘面事实做方法论模拟，不把“没有当天发言”等同于“不能分析”。');
      }
    }

    if (context.marketOverviewText) {
      parts.push(`盘面快照：${context.marketOverviewText}`);
    }

    if (context.marketSnapshotsText.length > 0) {
      parts.push(`相关联动：${context.marketSnapshotsText.slice(0, 4).join('；')}`);
    }

    if (context.profileJson.schemaVersion === 2) {
      const methodology = this.pickRecord(context.profileJson.marketMethodology);
      const agenticProtocol = this.pickRecord(context.profileJson.agenticProtocol);
      const coreRules = this.pickStringArray(context.profileJson.coreRules).slice(0, 5);
      const reasoningSteps = this.pickStringArray(methodology.reasoningSteps).slice(0, 5);
      const invalidationSignals = this.pickStringArray(methodology.invalidationSignals).slice(0, 5);
      const protocolSteps = this.pickStringArray(agenticProtocol.analysisSteps).slice(0, 5);
      if (coreRules.length > 0) {
        parts.push(`V2核心规则：${coreRules.join('；')}`);
      }
      if (reasoningSteps.length > 0) {
        parts.push(`V2方法论步骤：${reasoningSteps.join(' -> ')}`);
      }
      if (invalidationSignals.length > 0) {
        parts.push(`V2失效信号：${invalidationSignals.join(' / ')}`);
      }
      if (protocolSteps.length > 0) {
        parts.push(`Agentic Protocol：${protocolSteps.join(' -> ')}`);
      }
    }

    if (context.relevantMessages.length > 0) {
      parts.push(
        `论坛线索：${context.relevantMessages
          .slice(0, 3)
          .map((message) => `${message.authorName}：${message.rawContent}`)
          .join('；')}`
      );
    }

    if (context.profileEvidence.length > 0) {
      parts.push(
        `方法论证据：${context.profileEvidence
          .slice(0, 5)
          .map((item) => `[${item.bucket ?? item.axis}] ${item.excerpt}`)
          .join('；')}`
      );
    }

    if (parts.length === 0) {
      parts.push('当前没有足够线索做精确归因，我先给你一个粗判断。');
    }

    return parts.join('\n');
  }

  private buildFallbackLead(context: UnifiedAgentContext): string {
    const base = context.authorName
      ? `我先按 ${context.authorName} 的材料给你一个粗判断。`
      : '我先按当前盘面和论坛线索给你一个粗判断。';
    const extra = context.marketOverviewText ? `\n盘面：${context.marketOverviewText}` : '';
    return `${base}${extra}`;
  }

  private async buildMarketFacts(
    plan: AgentQueryPlan,
    queryMentions: V0MessageMention[],
    messages: AgentMessageRow[]
  ): Promise<V0MarketFactsResponse | null> {
    const stockHints = new Set<string>(plan.stockHints);
    const sectorHints = new Set<string>(plan.sectorHints);

    for (const mention of queryMentions) {
      if (mention.entityType === 'stock' && mention.normalizedCode) {
        stockHints.add(mention.normalizedCode);
      }

      if (mention.entityType === 'sector') {
        sectorHints.add(mention.entityName);
      }
    }

    for (const message of messages) {
      for (const mention of message.mentions) {
        if (mention.entityType === 'stock' && mention.normalizedCode) {
          stockHints.add(mention.normalizedCode);
        }

        if (mention.entityType === 'sector') {
          sectorHints.add(mention.entityName);
        }
      }
    }

    if (!plan.needsMarketOverview && stockHints.size === 0 && sectorHints.size === 0) {
      return null;
    }

    return this.marketFactsService.buildFacts({
      queryDate: plan.queryDate ?? undefined,
      stocks: Array.from(stockHints),
      sectors: Array.from(sectorHints),
      includeOverview: plan.needsMarketOverview || plan.intent === 'market_analysis',
    });
  }

  private async buildMarketOverviewText(
    plan: AgentQueryPlan,
    marketFacts?: V0MarketFactsResponse | null
  ): Promise<string> {
    const overviewFact = marketFacts?.facts.find((fact) => fact.kind === 'market_overview');
    if (overviewFact) {
      return overviewFact.summary.replace(/。$/, '');
    }

    if (plan.queryDate && plan.queryDate !== this.todayString()) {
      return '';
    }

    const marketOverview = await this.marketProvider.getMarketOverview();
    if (!marketOverview) {
      return '';
    }

    return `${marketOverview.indexName} 当前涨跌幅 ${marketOverview.indexPercent}%，北向净流入 ${marketOverview.northboundNet ?? '暂无'}`;
  }

  private async buildMarketSnapshotText(
    plan: AgentQueryPlan,
    queryMentions: V0MessageMention[],
    messages: AgentMessageRow[],
    marketFacts?: V0MarketFactsResponse | null
  ): Promise<string[]> {
    const factSnapshots =
      marketFacts?.facts
        .filter((fact) => fact.kind === 'stock_snapshot' || fact.kind === 'sector_snapshot')
        .map((fact) => fact.summary.replace(/。$/, '')) ?? [];

    if (factSnapshots.length > 0) {
      return factSnapshots;
    }

    if (marketFacts && !marketFacts.isRealtime) {
      return [];
    }

    const overviewFact = marketFacts?.facts.find((fact) => fact.kind === 'market_overview');
    if (plan.intent === 'market_analysis' && overviewFact) {
      return [overviewFact.summary.replace(/。$/, '')];
    }

    const stockMentions = new Set<string>();
    const sectorMentions = new Set<string>();

    for (const mention of queryMentions) {
      if (mention.entityType === 'stock' && mention.normalizedCode) {
        stockMentions.add(mention.normalizedCode);
      }

      if (mention.entityType === 'sector') {
        sectorMentions.add(mention.entityName);
      }
    }

    for (const message of messages) {
      for (const mention of message.mentions) {
        if (mention.entityType === 'stock' && mention.normalizedCode) {
          stockMentions.add(mention.normalizedCode);
        }

        if (mention.entityType === 'sector') {
          sectorMentions.add(mention.entityName);
        }
      }
    }

    const snapshots: string[] = [];
    for (const code of Array.from(stockMentions).slice(0, 3)) {
      const snapshot = await this.marketProvider.getStockSnapshot(code);
      if (snapshot) {
        snapshots.push(`${snapshot.name} 当前 ${snapshot.price} 元，涨跌幅 ${snapshot.percent}%`);
      }
    }

    for (const name of Array.from(sectorMentions).slice(0, 3)) {
      const snapshot = await this.marketProvider.getSectorSnapshot(name);
      if (snapshot) {
        snapshots.push(`${snapshot.name} 当前涨跌幅 ${snapshot.changePercent}% ，净流入 ${snapshot.netInflow}`);
      }
    }

    if (plan.intent === 'market_analysis' && snapshots.length === 0) {
      const marketOverview = await this.marketProvider.getMarketOverview();
      if (marketOverview && (!plan.queryDate || plan.queryDate === this.todayString())) {
        snapshots.push(
          `${marketOverview.indexName} 当前涨跌幅 ${marketOverview.indexPercent}%，北向净流入 ${marketOverview.northboundNet ?? '暂无'}`
        );
      }
    }

    return snapshots;
  }

  private findRelevantMessages(
    plan: AgentQueryPlan,
    query: string,
    recentMessages: AgentMessageRow[],
    dateMessages: AgentMessageRow[],
    queryMentions: V0MessageMention[]
  ): AgentMessageRow[] {
    const sourceMessages = plan.intent === 'author_daily_summary'
      ? dateMessages
      : plan.queryDate && dateMessages.length > 0
        ? dateMessages
        : recentMessages;

    const keywordHits = sourceMessages.filter((message) => {
      const text = `${message.rawContent} ${message.normalizedContent}`;
      if (
        queryMentions.some((mention) =>
          message.mentions.some(
            (messageMention) =>
              messageMention.entityType === mention.entityType &&
              (messageMention.normalizedCode === mention.normalizedCode ||
                messageMention.entityName === mention.entityName)
          )
        )
      ) {
        return true;
      }

      return this.extractKeywords(query).some((keyword) => text.includes(keyword));
    });

    return keywordHits.length > 0 ? keywordHits : sourceMessages.slice(0, 5);
  }

  private getMessages(options: {
    authorName?: string | null;
    date?: string | null;
    limit: number;
  }): AgentMessageRow[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (options.authorName) {
      conditions.push(
        "(author_name = ? OR LOWER(REPLACE(author_name, 'UID:', '')) = LOWER(REPLACE(?, 'UID:', '')))"
      );
      params.push(options.authorName, options.authorName);
    }

    if (options.date) {
      conditions.push("substr(CASE WHEN posted_at <> '' THEN posted_at ELSE created_at END, 1, 10) = ?");
      params.push(options.date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(
        `SELECT
          id,
          author_name AS authorName,
          posted_at AS postedAt,
          raw_content AS rawContent,
          normalized_content AS normalizedContent,
          created_at AS createdAt
         FROM v0_forum_messages
         ${whereClause}
         ORDER BY CASE WHEN posted_at <> '' THEN posted_at ELSE created_at END DESC, id DESC
         LIMIT ?`
      )
      .all(...params, options.limit) as Array<{
      id: number;
      authorName: string;
      postedAt: string;
      rawContent: string;
      normalizedContent: string;
      createdAt: string;
    }>;

    const insights = this.insightStore.getInsightsForMessageIds(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...row,
      mentions: insights[row.id]?.mentions ?? [],
      marketStates: insights[row.id]?.marketStates ?? [],
    }));
  }

  private countMessages(options: {
    authorName?: string | null;
    date?: string | null;
  }): number {
    const conditions: string[] = [];
    const params: string[] = [];

    if (options.authorName) {
      conditions.push(
        "(author_name = ? OR LOWER(REPLACE(author_name, 'UID:', '')) = LOWER(REPLACE(?, 'UID:', '')))"
      );
      params.push(options.authorName, options.authorName);
    }

    if (options.date) {
      conditions.push("substr(CASE WHEN posted_at <> '' THEN posted_at ELSE created_at END, 1, 10) = ?");
      params.push(options.date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM v0_forum_messages ${whereClause}`)
      .get(...params) as { count: number } | undefined;

    return row?.count ?? 0;
  }

  private extractQueryMentions(query: string): V0MessageMention[] {
    return this.messageEnricher.extractMentions({
      floorId: 'query',
      authorName: 'query',
      postedAt: '',
      rawContent: query,
      normalizedContent: query,
      sourceUrl: '',
    });
  }

  private extractStockHints(query: string): string[] {
    return this.uniqueStrings(
      this.extractQueryMentions(query)
        .filter((mention) => mention.entityType === 'stock')
        .map((mention) => mention.normalizedCode ?? mention.entityName)
    );
  }

  private extractSectorHints(query: string): string[] {
    return this.uniqueStrings(
      this.extractQueryMentions(query)
        .filter((mention) => mention.entityType === 'sector')
        .map((mention) => mention.entityName)
    );
  }

  private buildReferences(seed: {
    profileEvidence: V0PersonaEvidenceRecord[];
    recentMessages: AgentMessageRow[];
    dateMessages: AgentMessageRow[];
    relevantMessages: AgentMessageRow[];
    targetMessage: AgentMessageRow | null;
  }): V0AgentReference[] {
    const seen = new Set<number>();
    const references: V0AgentReference[] = [];

    const pushMessage = (message: AgentMessageRow): void => {
      if (seen.has(message.id)) {
        return;
      }
      seen.add(message.id);
      references.push(this.toReference(message));
    };

    if (seed.targetMessage) {
      pushMessage(seed.targetMessage);
    }

    for (const message of seed.relevantMessages.slice(0, 5)) {
      pushMessage(message);
    }

    for (const message of seed.dateMessages.slice(0, 3)) {
      pushMessage(message);
    }

    for (const message of seed.recentMessages.slice(0, 3)) {
      pushMessage(message);
    }

    for (const item of seed.profileEvidence.slice(0, 3)) {
      if (seen.has(item.messageId)) {
        continue;
      }

      seen.add(item.messageId);
      references.push({
        messageId: item.messageId,
        authorName: item.authorName,
        postedAt: item.postedAt,
        rawContent: item.rawContent,
        mentions: item.mentions,
        marketSummaries: item.marketSummaries,
      });
    }

    return references.slice(0, 5);
  }

  private toReference(message: AgentMessageRow): V0AgentReference {
    return {
      messageId: message.id,
      authorName: message.authorName,
      postedAt: message.postedAt || message.createdAt,
      rawContent: message.rawContent,
      mentions: message.mentions.map((mention) => `${mention.entityType}:${mention.entityName}`),
      marketSummaries: message.marketStates.map((state) => state.summaryText),
    };
  }

  private async composeAnswer(context: UnifiedAgentContext, baseAnswer: string): Promise<string> {
    if (!this.llmService.isEnabled()) {
      return baseAnswer;
    }

    try {
      const prompt = this.buildModelPrompt(context, baseAnswer);
      const supplement = await this.llmService.chat(
        [
          {
            role: 'system',
            content:
              '你是一个论坛人物方法论与 A 股盘面联动分析助手。只能基于给定上下文、用户问题和可见盘面事实回答，不要编造具体行情或作者原话。若存在人物画像，要把画像沉淀出的分析框架用于模拟推演，并清楚区分“历史方法论依据”“当前事实”“模拟判断”“不确定性”。输出中文，简洁但有论证力。',
          },
          { role: 'user', content: prompt },
        ],
        {
          traceLabel: 'v0.agent.composeAnswer',
          tracePayload: {
            query: context.query,
            intent: context.plan.intent,
            authorName: context.authorName,
            queryDate: context.plan.queryDate,
            hasProfile: Boolean(context.profile),
            profileEvidenceCount: context.profileEvidence.length,
            dateMessageTotalCount: context.dateMessageTotalCount,
            dateMessageContextCount: context.dateMessages.length,
            recentMessageContextCount: context.recentMessages.length,
            relevantMessageContextCount: context.relevantMessages.length,
          },
        }
      );

      const cleaned = supplement.trim();
      if (!cleaned) {
        return baseAnswer;
      }

      if (cleaned.includes(baseAnswer)) {
        return cleaned;
      }

      return `${baseAnswer}\n\n模型补充：${cleaned}`;
    } catch (error) {
      console.warn('V0 Agent DeepSeek supplement failed:', error instanceof Error ? error.message : error);
      return baseAnswer;
    }
  }

  private buildModelPrompt(context: UnifiedAgentContext, baseAnswer: string): string {
    const payload = {
      query: context.query,
      intent: context.plan.intent,
      authorName: context.authorName,
      queryDate: context.plan.queryDate,
      topic: context.plan.topic,
      baseAnswer,
      contextStats: {
        profileEvidenceCount: context.profileEvidence.length,
        dateMessageTotalCount: context.dateMessageTotalCount,
        dateMessagePromptCount: Math.min(context.dateMessages.length, 20),
        recentMessagePromptCount: Math.min(context.recentMessages.length, 20),
        relevantMessagePromptCount: Math.min(context.relevantMessages.length, 15),
      },
      profile: context.profile
        ? {
            authorName: context.profile.authorName,
            profileVersion: context.profile.profileVersion,
            summaryText: context.profile.summaryText,
            profileJson: context.profileJson,
            personaV2:
              context.profileJson.schemaVersion === 2
                ? {
                    coreRules: context.profileJson.coreRules,
                    marketMethodology: context.profileJson.marketMethodology,
                    decisionHeuristics: context.profileJson.decisionHeuristics,
                    topicMap: context.profileJson.topicMap,
                    evidenceQuality: context.profileJson.evidenceQuality,
                    honestBoundaries: context.profileJson.honestBoundaries,
                    agenticProtocol: context.profileJson.agenticProtocol,
                  }
                : null,
            sourceMessageCount: context.profile.sourceMessageCount,
            sourceChunkCount: context.profile.sourceChunkCount,
            lastMessageAt: context.profile.lastMessageAt,
        }
        : null,
      profileEvidence: context.profileEvidence.slice(0, 40).map((item) => ({
        axis: item.axis,
        bucket: item.bucket ?? item.axis,
        qualityScore: item.qualityScore ?? null,
        evidenceRole: item.evidenceRole ?? null,
        postedAt: item.postedAt,
        beijingTime: item.beijingTime ?? item.postedAt,
        messageFloor: item.messageFloor ?? item.floorId,
        excerpt: item.excerpt,
        mentions: item.mentions,
        marketSummaries: item.marketSummaries,
      })),
      recentMessages: context.recentMessages.slice(0, 20).map((message) => ({
        postedAt: message.postedAt || message.createdAt,
        rawContent: message.rawContent,
        mentions: message.mentions.map((mention) => `${mention.entityType}:${mention.entityName}`),
        marketSummaries: message.marketStates.map((state) => state.summaryText),
      })),
      dateMessages: context.dateMessages.slice(0, 20).map((message) => ({
        postedAt: message.postedAt || message.createdAt,
        rawContent: message.rawContent,
        mentions: message.mentions.map((mention) => `${mention.entityType}:${mention.entityName}`),
        marketSummaries: message.marketStates.map((state) => state.summaryText),
      })),
      relevantMessages: context.relevantMessages.slice(0, 15).map((message) => ({
        postedAt: message.postedAt || message.createdAt,
        rawContent: message.rawContent,
        mentions: message.mentions.map((mention) => `${mention.entityType}:${mention.entityName}`),
        marketSummaries: message.marketStates.map((state) => state.summaryText),
      })),
      targetMessage: context.targetMessage
        ? {
            postedAt: context.targetMessage.postedAt || context.targetMessage.createdAt,
            rawContent: context.targetMessage.rawContent,
            mentions: context.targetMessage.mentions.map((mention) => `${mention.entityType}:${mention.entityName}`),
            marketSummaries: context.targetMessage.marketStates.map((state) => state.summaryText),
          }
        : null,
      marketOverviewText: context.marketOverviewText,
      marketSnapshotsText: context.marketSnapshotsText,
      marketFacts: context.marketFacts,
      references: context.references,
    };

    return [
      '请基于以下统一上下文，对 baseAnswer 做补充分析。',
      '要求：',
      '1. 人物画像不是“只有当天说过才分析”。如果有 profile 或 profileEvidence，请先抽象这个人的稳定分析方法、关注变量和风险偏好，再把这套方法用于当前 A 股、板块或个股问题。',
      '2. 回答必须区分：画像/方法论依据、当前盘面事实、按该方法论得到的模拟推演、不确定性或还缺的数据。',
      '3. dateMessages 是当天或指定日期的直接发言线索；如果为空，不要说无法分析，而是说明本次依赖历史方法论和当前可见事实。',
      '4. 如果 profile.personaV2 存在，必须优先使用 marketMethodology、coreRules、agenticProtocol 和 evidenceQuality；profileEvidence.bucket 表示证据桶。',
      '5. 回答结构固定为：方法论依据 / 当前事实 / 模拟推演 / 不确定性与边界 / 证据引用。没有证据的部分写“暂无直接证据”。',
      '6. profileEvidence 是长期证据链，可以用于提炼方法论；不要把模拟判断伪装成作者原话。',
      '7. 不要背离 baseAnswer 的事实基础，不要编造具体行情、资金数据、作者发言或未提供的新闻。',
      '8. 输出简洁但有论证力，优先给出可执行、可复核的判断。',
      '',
      JSON.stringify(payload, null, 2),
    ].join('\n');
  }

  private buildPersonaEvidencePack(
    context: UnifiedAgentContext,
    payload: V0PersonaInferencePayload
  ): V0PersonaEvidencePack {
    const citations: V0PersonaInferenceCitation[] = [];
    const pushCitation = (citation: V0PersonaInferenceCitation): void => {
      if (citations.some((item) => item.id === citation.id)) {
        return;
      }
      citations.push(citation);
    };

    const profileJson = context.profileJson;
    const coreRules = this.pickStringArray(profileJson.coreRules);
    coreRules.slice(0, 8).forEach((rule, index) => {
      pushCitation({
        id: `rule-${index + 1}`,
        source: 'profile_rule',
        title: `核心规则 ${index + 1}`,
        excerpt: rule,
        confidence: this.pickConfidence(profileJson),
      });
    });

    const methodology = this.pickRecord(profileJson.marketMethodology);
    this.pickStringArray(methodology.reasoningSteps).slice(0, 8).forEach((step, index) => {
      pushCitation({
        id: `method-${index + 1}`,
        source: 'profile_methodology',
        title: `方法论步骤 ${index + 1}`,
        excerpt: step,
        confidence: this.pickConfidence(profileJson),
      });
    });

    if (payload.eventText?.trim()) {
      pushCitation({
        id: 'user-event',
        source: 'user_event',
        title: '用户提供事件',
        excerpt: payload.eventText.trim(),
      });
    }

    context.marketSnapshotsText.slice(0, 6).forEach((snapshot, index) => {
      pushCitation({
        id: `market-${index + 1}`,
        source: 'market_snapshot',
        title: `行情快照 ${index + 1}`,
        excerpt: snapshot,
      });
    });

    context.marketFacts?.facts.slice(0, 12).forEach((fact) => {
      pushCitation({
        id: fact.citationId,
        source: fact.citationId.startsWith('bigamap-') ? 'external_market_fact' : 'market_fact',
        title: fact.title,
        excerpt: fact.summary,
        postedAt: fact.capturedAt,
        confidence: fact.confidence,
      });
    });

    context.dateMessages.slice(0, 8).forEach((message, index) => {
      pushCitation({
        id: `date-${message.id}`,
        source: 'date_message',
        title: `指定日期发言 ${index + 1}`,
        excerpt: message.rawContent,
        postedAt: message.postedAt || message.createdAt,
        messageId: message.id,
      });
    });

    context.relevantMessages.slice(0, 8).forEach((message, index) => {
      pushCitation({
        id: `relevant-${message.id}`,
        source: 'relevant_message',
        title: `相关论坛线索 ${index + 1}`,
        excerpt: message.rawContent,
        postedAt: message.postedAt || message.createdAt,
        messageId: message.id,
      });
    });

    const bucketGroups = new Map<string, V0PersonaEvidenceRecord[]>();
    for (const item of context.profileEvidence) {
      const bucket = item.bucket ?? item.axis;
      const list = bucketGroups.get(bucket) ?? [];
      list.push(item);
      bucketGroups.set(bucket, list);
    }

    const buckets = PERSONA_INFERENCE_BUCKET_PRIORITY.map((bucket) => {
      const items = (bucketGroups.get(bucket) ?? [])
        .slice()
        .sort(
          (left, right) =>
            (right.qualityScore ?? 0) - (left.qualityScore ?? 0) ||
            right.postedAt.localeCompare(left.postedAt)
        )
        .slice(0, 4);
      const bucketCitations = items.map((item, index) => {
        const citation: V0PersonaInferenceCitation = {
          id: `evidence-${item.chunkId}-${bucket}`,
          source: 'profile_evidence',
          bucket,
          title: `${PERSONA_INFERENCE_BUCKET_LABELS[bucket] ?? bucket} ${index + 1}`,
          excerpt: item.excerpt,
          postedAt: item.postedAt,
          messageId: item.messageId,
          floorId: item.floorId,
          confidence: item.qualityScore,
        };
        pushCitation(citation);
        return citation;
      });

      return {
        bucket,
        label: PERSONA_INFERENCE_BUCKET_LABELS[bucket] ?? bucket,
        role: items[0]?.evidenceRole ?? this.describeInferenceBucket(bucket),
        evidenceCount: bucketGroups.get(bucket)?.length ?? 0,
        citations: bucketCitations,
      };
    }).filter((bucket) => bucket.evidenceCount > 0 || bucket.citations.length > 0);

    return {
      authorName: context.authorName ?? '',
      profileVersion: context.profile?.profileVersion ?? null,
      profileSummary: context.profile?.summaryText ?? '',
      directDateMessageCount: context.dateMessageTotalCount,
      marketFacts: context.marketFacts ?? undefined,
      buckets,
      citations,
    };
  }

  private buildFallbackInferenceDraft(
    context: UnifiedAgentContext,
    payload: V0PersonaInferencePayload,
    evidencePack: V0PersonaEvidencePack
  ): PersonaInferenceDraft {
    const profileJson = context.profileJson;
    const methodology = this.pickRecord(profileJson.marketMethodology);
    const agenticProtocol = this.pickRecord(profileJson.agenticProtocol);
    const coreRules = this.pickStringArray(profileJson.coreRules).slice(0, 5);
    const reasoningSteps = this.pickStringArray(methodology.reasoningSteps).slice(0, 5);
    const invalidationSignals = this.pickStringArray(methodology.invalidationSignals).slice(0, 5);
    const riskHandling = this.pickString(methodology.riskHandling);
    const protocolSteps = this.pickStringArray(agenticProtocol.analysisSteps).slice(0, 5);
    const highQualityEvidenceIds = evidencePack.citations
      .filter((citation) => citation.source === 'profile_evidence')
      .slice(0, 5)
      .map((citation) => citation.id);
    const ruleIds = evidencePack.citations
      .filter((citation) => citation.source === 'profile_rule')
      .slice(0, 3)
      .map((citation) => citation.id);
    const baseEvidenceIds = [...ruleIds, ...highQualityEvidenceIds].slice(0, 6);
    const topicText = [payload.eventText, context.plan.topic, context.query].filter(Boolean).join(' / ');
    const currentFacts = [
      payload.eventText?.trim() ? `用户事件：${payload.eventText.trim()}` : '',
      context.plan.queryDate
        ? `${context.plan.queryDate} 的作者直接发言 ${context.dateMessageTotalCount} 条。`
        : '未指定日期，优先使用近期发言和画像证据。',
      context.dateMessageTotalCount === 0 && context.plan.queryDate
        ? '指定日期暂无作者直接发言，本次属于历史方法论模拟推演。'
        : '',
      context.marketOverviewText ? `盘面快照：${context.marketOverviewText}` : '',
      context.marketSnapshotsText.length > 0 ? `相关联动：${context.marketSnapshotsText.slice(0, 4).join('；')}` : '',
      ...(context.marketFacts?.facts.slice(0, 8).map((fact) => `实时市场事实：${fact.summary}`) ?? []),
      context.relevantMessages.length > 0
        ? `相关论坛线索 ${context.relevantMessages.length} 条，最近一条：${context.relevantMessages[0].rawContent}`
        : '',
    ].filter(Boolean);
    const missingInputs = [
      context.marketOverviewText ? '' : '缺少实时大盘概览。',
      context.marketSnapshotsText.length > 0 ? '' : '缺少相关股票/板块实时快照。',
      ...(context.marketFacts?.missingInputs ?? []),
      '缺少黄白线、量能、开盘首根 15 分钟 K 线等盘中执行条件。',
      '缺少事件落地后的真实反馈强度与资金流数据。',
      context.dateMessageTotalCount === 0 && context.plan.queryDate ? '指定日期没有作者直接发言。' : '',
    ].filter(Boolean);
    const riskBoundaries = [
      ...this.pickStringArray(profileJson.honestBoundaries).slice(0, 4),
      ...this.pickStringArray(profileJson.contradictions).slice(0, 3),
      riskHandling ? `风控边界：${riskHandling}` : '',
      '这是按历史画像进行的模拟推演，不代表作者本人对当日事件的直接观点。',
    ].filter(Boolean);

    return {
      summary: `基于 ${context.authorName} 的 V2 方法论画像，对“${topicText.slice(0, 80)}”进行结构化模拟推演。`,
      methodologyBasis: [
        ...coreRules.map((rule, index) => `核心规则 ${index + 1}：${rule}`),
        ...reasoningSteps.map((step, index) => `决策步骤 ${index + 1}：${step}`),
        protocolSteps.length > 0 ? `Agentic Protocol：${protocolSteps.join(' -> ')}` : '',
      ].filter(Boolean),
      currentFacts,
      scenarioSimulations: [
        {
          title: '情景一：事件触发高关注方向拉升',
          probability: 'medium',
          triggerConditions: ['相关板块高开或快速拉升', '白线强于黄线或量能快速放大', '论坛线索显示主线方向被重新关注'],
          reasoning:
            '按画像方法论，先判断这类拉升是趋势确认还是高位诱多；若缺少黄线配合和持续量能，优先视为风险释放窗口。',
          personaAction: '不追高，优先观察承接与量能；若触及画像中的派发/失效信号，以减仓或防守处理。',
          invalidationSignals,
          confidence: this.pickConfidence(profileJson),
          evidenceIds: baseEvidenceIds,
        },
        {
          title: '情景二：事件反馈弱，市场按原节奏运行',
          probability: 'medium',
          triggerConditions: ['消息没有带来持续放量', '相关板块冲高回落或分歧扩大', '大盘仍受原有趋势和压力位约束'],
          reasoning:
            '事件不能改变市场结构时，画像方法论会回到大盘环境、主线持续性和风险控制，而不是单独交易新闻。',
          personaAction: '降低事件权重，继续按大盘结构和主线持续性做判断；没有确定性前不把新闻当作开仓理由。',
          invalidationSignals,
          confidence: Math.max(0.35, this.pickConfidence(profileJson) - 0.08),
          evidenceIds: baseEvidenceIds,
        },
        {
          title: '情景三：低开缩量后出现结构性修复',
          probability: 'low',
          triggerConditions: ['低开或回踩后缩量', '黄线改善或小票情绪修复', '目标方向出现可验证承接'],
          reasoning:
            '画像中对低开、缩量、黄线改善这类条件通常更重视，但仍需要盘中事实确认，不能把历史规则机械套用。',
          personaAction: '仅在有底仓或熟悉方向中小仓位试错/做 T，并设置明确失效条件；不把短线修复扩展成长线加仓。',
          invalidationSignals,
          confidence: Math.max(0.3, this.pickConfidence(profileJson) - 0.15),
          evidenceIds: baseEvidenceIds,
        },
      ],
      riskBoundaries,
      missingInputs,
    };
  }

  private async buildModelPersonaInferenceDraft(
    context: UnifiedAgentContext,
    payload: V0PersonaInferencePayload,
    evidencePack: V0PersonaEvidencePack,
    fallbackDraft: PersonaInferenceDraft
  ): Promise<PersonaInferenceDraft | null> {
    if (!this.llmService.isEnabled()) {
      return null;
    }

    const prompt = this.buildPersonaInferencePrompt(context, payload, evidencePack, fallbackDraft);
    const content = await this.llmService.chat(
      [
        {
          role: 'system',
          content:
            '你是 A 股论坛人物方法论推演器。只输出纯 JSON，不要 Markdown。必须区分作者直接发言、画像归纳、当前事实、模拟推演和缺失数据，不能把模拟推演伪装成作者本人观点。',
        },
        { role: 'user', content: prompt },
      ],
      {
        traceLabel: 'v0.agent.personaInference',
        tracePayload: {
          query: context.query,
          authorName: context.authorName,
          queryDate: context.plan.queryDate,
          citationCount: evidencePack.citations.length,
        },
      }
    );

    const parsed = this.parseJsonObject(content);
    if (!parsed) {
      return null;
    }

    return {
      summary: this.pickString(parsed.summary),
      methodologyBasis: this.pickStringArray(parsed.methodologyBasis),
      currentFacts: this.pickStringArray(parsed.currentFacts),
      scenarioSimulations: this.normalizeScenarioArray(parsed.scenarioSimulations),
      riskBoundaries: this.pickStringArray(parsed.riskBoundaries),
      missingInputs: this.pickStringArray(parsed.missingInputs),
    };
  }

  private buildPersonaInferencePrompt(
    context: UnifiedAgentContext,
    payload: V0PersonaInferencePayload,
    evidencePack: V0PersonaEvidencePack,
    fallbackDraft: PersonaInferenceDraft
  ): string {
    const promptPayload = {
      query: context.query,
      authorName: context.authorName,
      queryDate: context.plan.queryDate,
      eventText: payload.eventText ?? null,
      profile: context.profile
        ? {
            summaryText: context.profile.summaryText,
            profileVersion: context.profile.profileVersion,
            profileJson: context.profileJson,
          }
        : null,
      currentContext: {
        directDateMessageCount: context.dateMessageTotalCount,
        dateMessages: context.dateMessages.slice(0, 8).map((message) => ({
          id: `date-${message.id}`,
          postedAt: message.postedAt || message.createdAt,
          rawContent: message.rawContent,
        })),
        relevantMessages: context.relevantMessages.slice(0, 8).map((message) => ({
          id: `relevant-${message.id}`,
          postedAt: message.postedAt || message.createdAt,
          rawContent: message.rawContent,
        })),
        marketOverviewText: context.marketOverviewText,
        marketSnapshotsText: context.marketSnapshotsText,
        marketFacts: context.marketFacts,
      },
      evidencePack,
      fallbackDraft,
    };

    return [
      '请把以下上下文生成结构化人物方法论推演 JSON。',
      'JSON 字段必须为：summary, methodologyBasis, currentFacts, scenarioSimulations, riskBoundaries, missingInputs。',
      'scenarioSimulations 必须是 2-4 个情景，每个包含 title, probability, triggerConditions, reasoning, personaAction, invalidationSignals, confidence, evidenceIds。',
      'probability 只能是 high / medium / low / unknown；confidence 为 0-1 数字。',
      'evidenceIds 必须优先使用 evidencePack.citations 里的 id。',
      '若指定日期无直接发言，currentFacts 和 missingInputs 必须明确说明。',
      '不要编造行情数据、作者原话或未给出的新闻细节。',
      '',
      JSON.stringify(promptPayload, null, 2),
    ].join('\n');
  }

  private normalizePersonaInferenceDraft(
    draft: PersonaInferenceDraft,
    fallback: PersonaInferenceDraft,
    evidencePack: V0PersonaEvidencePack
  ): PersonaInferenceDraft {
    const citationIds = new Set(evidencePack.citations.map((citation) => citation.id));
    const scenarios = draft.scenarioSimulations.length > 0
      ? draft.scenarioSimulations
      : fallback.scenarioSimulations;

    return {
      summary: draft.summary || fallback.summary,
      methodologyBasis:
        draft.methodologyBasis.length > 0 ? draft.methodologyBasis : fallback.methodologyBasis,
      currentFacts: draft.currentFacts.length > 0 ? draft.currentFacts : fallback.currentFacts,
      scenarioSimulations: scenarios.map((scenario, index) => ({
        title: scenario.title || fallback.scenarioSimulations[index]?.title || `情景 ${index + 1}`,
        probability: this.normalizeProbability(scenario.probability),
        triggerConditions:
          scenario.triggerConditions.length > 0
            ? scenario.triggerConditions
            : fallback.scenarioSimulations[index]?.triggerConditions ?? [],
        reasoning: scenario.reasoning || fallback.scenarioSimulations[index]?.reasoning || '',
        personaAction:
          scenario.personaAction || fallback.scenarioSimulations[index]?.personaAction || '',
        invalidationSignals:
          scenario.invalidationSignals.length > 0
            ? scenario.invalidationSignals
            : fallback.scenarioSimulations[index]?.invalidationSignals ?? [],
        confidence: this.clampConfidence(scenario.confidence),
        evidenceIds: scenario.evidenceIds.filter((id) => citationIds.has(id)).length > 0
          ? scenario.evidenceIds.filter((id) => citationIds.has(id))
          : fallback.scenarioSimulations[index]?.evidenceIds ?? evidencePack.citations.slice(0, 3).map((item) => item.id),
      })),
      riskBoundaries: draft.riskBoundaries.length > 0 ? draft.riskBoundaries : fallback.riskBoundaries,
      missingInputs: draft.missingInputs.length > 0 ? draft.missingInputs : fallback.missingInputs,
    };
  }

  private renderPersonaInferenceMarkdown(
    draft: PersonaInferenceDraft,
    evidencePack: V0PersonaEvidencePack
  ): string {
    const lines = [
      `### 总结\n${draft.summary}`,
      `### 方法论依据\n${draft.methodologyBasis.map((item) => `- ${item}`).join('\n') || '- 暂无'}`,
      `### 当前事实\n${draft.currentFacts.map((item) => `- ${item}`).join('\n') || '- 暂无'}`,
      `### 模拟推演\n${draft.scenarioSimulations
        .map(
          (scenario) =>
            `- **${scenario.title}**（${scenario.probability}，置信度 ${Math.round(scenario.confidence * 100)}%）\n  - 触发条件：${scenario.triggerConditions.join(' / ') || '暂无'}\n  - 推演：${scenario.reasoning}\n  - 动作：${scenario.personaAction}\n  - 失效：${scenario.invalidationSignals.join(' / ') || '暂无'}`
        )
        .join('\n')}`,
      `### 不确定性与边界\n${draft.riskBoundaries.map((item) => `- ${item}`).join('\n') || '- 暂无'}`,
      `### 缺失输入\n${draft.missingInputs.map((item) => `- ${item}`).join('\n') || '- 暂无'}`,
      `### 证据引用\n${evidencePack.citations
        .slice(0, 12)
        .map((item) => `- [${item.id}] ${item.title}：${item.excerpt}`)
        .join('\n') || '- 暂无'}`,
    ];

    return lines.join('\n\n');
  }

  private normalizeScenarioArray(value: unknown): V0PersonaInferenceScenario[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item, index) => {
      const record = this.pickRecord(item);
      return {
        title: this.pickString(record.title) || `情景 ${index + 1}`,
        probability: this.normalizeProbability(this.pickString(record.probability)),
        triggerConditions: this.pickStringArray(record.triggerConditions),
        reasoning: this.pickString(record.reasoning),
        personaAction: this.pickString(record.personaAction),
        invalidationSignals: this.pickStringArray(record.invalidationSignals),
        confidence:
          typeof record.confidence === 'number'
            ? this.clampConfidence(record.confidence)
            : 0.5,
        evidenceIds: this.pickStringArray(record.evidenceIds),
      };
    });
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

  private describeInferenceBucket(bucket: string): string {
    switch (bucket) {
      case 'longformTheory':
        return '稳定方法论和底层规则';
      case 'marketStructure':
        return '大盘结构和风格判断变量';
      case 'riskWarning':
        return '风控、失效和仓位边界';
      case 'sectorStockReasoning':
        return '板块和个股选择逻辑';
      case 'recentSignals':
        return '近期关注与短线变化';
      default:
        return '补充推演证据';
    }
  }

  private pickConfidence(profileJson: Record<string, unknown>): number {
    const quality = this.pickRecord(profileJson.evidenceQuality);
    return typeof quality.confidence === 'number' ? this.clampConfidence(quality.confidence) : 0.55;
  }

  private normalizeProbability(value: unknown): V0PersonaInferenceScenario['probability'] {
    if (value === 'high' || value === 'medium' || value === 'low' || value === 'unknown') {
      return value;
    }
    return 'unknown';
  }

  private clampConfidence(value: number): number {
    return Number(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5)).toFixed(4));
  }

  private extractKeywords(query: string): string[] {
    const keywords = query.match(/[\u4e00-\u9fa5A-Za-z0-9_.%-]{2,}/g) ?? [];
    return this.uniqueStrings(keywords).slice(0, 6);
  }

  private extractTopic(query: string): string | null {
    const cleaned = query.replace(/\s+/g, ' ').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 40) : null;
  }

  private extractQueryDate(query: string): string | null {
    const today = this.beijingNow();

    const fullDate = query.match(/(\d{4})[年-](\d{1,2})[月-](\d{1,2})日?/);
    if (fullDate) {
      const year = Number(fullDate[1]);
      const month = Number(fullDate[2]);
      const day = Number(fullDate[3]);
      return this.formatDate(year, month, day);
    }

    const monthDay = query.match(/(\d{1,2})月(\d{1,2})日/);
    if (monthDay) {
      const year = toBeijingDateParts(today).year;
      const month = Number(monthDay[1]);
      const day = Number(monthDay[2]);
      return this.formatDate(year, month, day);
    }

    if (query.includes('昨天')) {
      return this.shiftDate(today, -1);
    }

    if (query.includes('前天')) {
      return this.shiftDate(today, -2);
    }

    if (query.includes('今天') || query.includes('今日')) {
      return this.shiftDate(today, 0);
    }

    return null;
  }

  private formatDate(year: number, month: number, day: number): string {
    const safeMonth = String(month).padStart(2, '0');
    const safeDay = String(day).padStart(2, '0');
    return `${String(year).padStart(4, '0')}-${safeMonth}-${safeDay}`;
  }

  private shiftDate(baseDate: Date, offsetDays: number): string {
    return addBeijingDays(baseDate, offsetDays);
  }

  private todayString(): string {
    return toBeijingDateString();
  }

  private beijingNow(): Date {
    return new Date();
  }

  private isProfileQuery(query: string): boolean {
    return /(画像|人物|风格|性格|体系|偏好|profile|persona)/i.test(query);
  }

  private isDailySummaryQuery(query: string): boolean {
    return /(今天|今日|昨天|昨日|前天).*(说了什么|发言|观点|总结|聊了什么)|今天.*总结/.test(query);
  }

  private isStockStatusQuery(query: string): boolean {
    return /(现在.*怎么样|现在如何|表现如何|提到的股|提到的股票|个股|标的|怎么看.*股|股票现状)/.test(query);
  }

  private isValidationQuery(query: string): boolean {
    return /(成立|是否成立|对不对|验证|回流|转弱|黄线|白线|板块)/.test(query);
  }

  private isMarketAnalysisQuery(query: string): boolean {
    return /(A股|盘面|市场|指数|情绪|资金|板块|走弱|走强|下跌|上涨|原因|怎么回事|为什么|分析一下|联动)/.test(query);
  }

  private findStockSnapshotText(snapshots: string[], stockName: string): string | null {
    const found = snapshots.find((snapshot) => snapshot.includes(stockName));
    return found ?? snapshots[0] ?? null;
  }

  private selectMarketState(
    message: AgentMessageRow,
    queryMentions: V0MessageMention[]
  ): V0MessageMarketState | undefined {
    const matchedState = message.marketStates.find((state) =>
      queryMentions.some(
        (mention) =>
          state.subjectType === mention.entityType &&
          state.subjectKey.includes(mention.normalizedCode ?? mention.entityName)
      )
    );

    return matchedState ?? message.marketStates[0];
  }

  private buildValidationText(summary: string): string {
    if (!summary) {
      return '当前仍偏待确认。';
    }

    if (/(偏强|走强|成立|占优|修复)/.test(summary)) {
      return '当前更偏向成立。';
    }

    if (/(偏弱|未成立|承压|回落|谨慎|观察)/.test(summary)) {
      return '当前更偏向未成立。';
    }

    return '当前仍偏待确认。';
  }

  private safeParseJson(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private safeParseEvidence(value: string): V0PersonaEvidenceRecord[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private pickString(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return this.pickString(record.summary ?? record.value ?? record.label ?? record.description);
    }

    return '';
  }

  private pickRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private pickStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.pickString(item))
      .filter((item) => item.trim().length > 0);
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)));
  }
}
