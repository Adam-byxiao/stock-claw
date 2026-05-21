import OpenAI from 'openai';
import dotenv from 'dotenv';
import { SYSTEM_AGENT_INTENT_PROMPT } from '../prompts/agent';
import { SYSTEM_INTENT_PROMPT } from '../prompts/intent';
import { toBeijingDateString } from '../v0/shared/time';

dotenv.config();

export interface LLMConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  embeddingApiKey?: string;
  embeddingBaseURL?: string;
  embeddingModel?: string;
}

export interface UserIntent {
  type: 'screen' | 'chat';
  strategy?: 'continuous_rise' | 'continuous_fall' | 'box_oscillation' | 'limit_up' | 'low_pe';
  params?: any;
  reply?: string;
}

export interface AgentQueryIntent {
  intent:
    | 'author_profile'
    | 'author_daily_summary'
    | 'author_stock_status'
    | 'opinion_validation'
    | 'market_analysis'
    | 'fallback';
  authorName?: string | null;
  authorAlias?: string | null;
  queryDate?: string | null;
  topic?: string | null;
  stockHints?: string[];
  sectorHints?: string[];
  usePersona?: boolean;
  needsMarketOverview?: boolean;
  confidence?: number;
  clarify?: string | null;
}

export interface AgentQueryIntentContext {
  query: string;
  referenceDate?: string;
  knownAuthors?: Array<{ authorName: string; alias: string | null }>;
}

export class LLMService {
  private client: OpenAI | null;
  private embeddingClient: OpenAI | null;
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private embeddingApiKey: string;
  private embeddingBaseURL: string;
  private embeddingModel: string;
  private debugTraceEnabled: boolean;

  constructor(config?: LLMConfig) {
    this.apiKey = config?.apiKey || process.env.LLM_API_KEY || '';
    this.baseURL = config?.baseURL || process.env.LLM_BASE_URL || '';
    this.model = config?.model || process.env.LLM_MODEL || '';
    this.embeddingApiKey =
      config?.embeddingApiKey || process.env.LLM_EMBEDDING_API_KEY || this.apiKey || 'dummy-key';
    this.embeddingBaseURL =
      config?.embeddingBaseURL || process.env.LLM_EMBEDDING_BASE_URL || this.baseURL;
    this.embeddingModel = config?.embeddingModel || process.env.LLM_EMBEDDING_MODEL || '';
    this.debugTraceEnabled = (process.env.LLM_DEBUG_TRACE || '').trim().toLowerCase() === 'true';

    this.client = this.createClient(this.apiKey, this.baseURL);
    this.embeddingClient = this.createClient(this.embeddingApiKey, this.embeddingBaseURL);
  }

  isEnabled(): boolean {
    return Boolean(this.client && this.model);
  }

  isEmbeddingEnabled(): boolean {
    return Boolean(this.embeddingClient && this.embeddingModel);
  }

  getModelName(): string {
    return this.model;
  }

  getEmbeddingModelName(): string {
    return this.embeddingModel;
  }

  async chat(
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    options: { traceLabel?: string; tracePayload?: unknown } = {}
  ): Promise<string> {
    if (!this.isEnabled() || !this.client) {
      throw new Error('LLM chat is not configured. Set LLM_API_KEY, LLM_BASE_URL, and LLM_MODEL.');
    }

    try {
      this.trace('chat.request', {
        label: options.traceLabel ?? null,
        model: this.model,
        payload: options.tracePayload ?? null,
        messages,
      });

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });

      const content = response.choices[0]?.message?.content || '';
      this.trace('chat.response', {
        label: options.traceLabel ?? null,
        model: this.model,
        id: response.id,
        created: response.created,
        usage: response.usage ?? null,
        choices: response.choices.map((choice) => ({
          index: choice.index,
          finishReason: choice.finish_reason,
          message: choice.message as unknown,
        })),
        content,
      });
      return content;
    } catch (error) {
      console.error('LLM Chat Error:', error);
      return '模型调用失败，当前无法生成回复。';
    }
  }

  async embedTexts(
    texts: string[],
    inputType: 'query' | 'document' | null = null
  ): Promise<number[][]> {
    if (!this.isEmbeddingEnabled()) {
      throw new Error(
        'LLM embeddings are not configured. Set LLM_EMBEDDING_API_KEY, LLM_EMBEDDING_BASE_URL, and LLM_EMBEDDING_MODEL.'
      );
    }

    if (texts.length === 0) {
      return [];
    }

    if (!this.embeddingClient) {
      throw new Error('OpenAI-compatible embedding client is not configured');
    }

    try {
      this.trace('embedding.request', {
        model: this.embeddingModel,
        inputType,
        texts,
      });

      const response = await this.embeddingClient.embeddings.create({
        model: this.embeddingModel,
        input: texts,
      });

      const embeddings = response.data.map((item) => item.embedding);
      this.trace('embedding.response', {
        model: this.embeddingModel,
        inputType,
        count: embeddings.length,
        dimensions: embeddings[0]?.length ?? 0,
      });

      return embeddings;
    } catch (error) {
      console.error('LLM Embeddings Error:', error);
      throw new Error(error instanceof Error ? error.message : 'failed to create embeddings');
    }
  }

  async parseIntent(userInput: string): Promise<UserIntent> {
    try {
      const content = await this.chat(
        [
          { role: 'system', content: SYSTEM_INTENT_PROMPT },
          { role: 'user', content: userInput },
        ],
        { traceLabel: 'parseIntent', tracePayload: { userInput } }
      );

      const jsonStr = this.extractJsonString(content);
      if (!jsonStr) {
        return { type: 'chat', reply: '请补充更具体的条件。' };
      }

      const parsed = JSON.parse(jsonStr);
      this.trace('parseIntent.parsed', parsed);
      return parsed;
    } catch (error) {
      console.error('Intent parsing failed:', error);
      return { type: 'chat', reply: '请补充更具体的条件。' };
    }
  }

  async parseAgentIntent(context: AgentQueryIntentContext): Promise<AgentQueryIntent | null> {
    if (!this.isEnabled() || !this.client) {
      return null;
    }

    try {
      const payload = {
        query: context.query,
        referenceDate: context.referenceDate ?? toBeijingDateString(),
        knownAuthors: context.knownAuthors ?? [],
      };

      const content = await this.chat(
        [
          { role: 'system', content: SYSTEM_AGENT_INTENT_PROMPT },
          { role: 'user', content: JSON.stringify(payload, null, 2) },
        ],
        { traceLabel: 'parseAgentIntent', tracePayload: payload }
      );

      const jsonStr = this.extractJsonString(content);
      if (!jsonStr) {
        return null;
      }

      const parsed = JSON.parse(jsonStr) as AgentQueryIntent;
      const normalized = this.normalizeAgentQueryIntent(parsed);
      this.trace('parseAgentIntent.parsed', normalized);
      return normalized;
    } catch (error) {
      console.error('Agent intent parsing failed:', error);
      return null;
    }
  }

  private extractJsonString(content: string): string | null {
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return null;
    }

    return cleaned.slice(start, end + 1);
  }

  private normalizeAgentQueryIntent(intent: AgentQueryIntent): AgentQueryIntent {
    return {
      intent: this.normalizeAgentIntentType(intent.intent),
      authorName: this.normalizeStringOrNull(intent.authorName),
      authorAlias: this.normalizeStringOrNull(intent.authorAlias),
      queryDate: this.normalizeDateOrNull(intent.queryDate),
      topic: this.normalizeStringOrNull(intent.topic),
      stockHints: this.normalizeStringArray(intent.stockHints),
      sectorHints: this.normalizeStringArray(intent.sectorHints),
      usePersona: typeof intent.usePersona === 'boolean' ? intent.usePersona : undefined,
      needsMarketOverview:
        typeof intent.needsMarketOverview === 'boolean' ? intent.needsMarketOverview : undefined,
      confidence:
        typeof intent.confidence === 'number' && Number.isFinite(intent.confidence)
          ? Math.max(0, Math.min(1, intent.confidence))
          : undefined,
      clarify: this.normalizeStringOrNull(intent.clarify),
    };
  }

  private normalizeAgentIntentType(
    intent: AgentQueryIntent['intent'] | undefined
  ): AgentQueryIntent['intent'] {
    if (
      intent === 'author_profile' ||
      intent === 'author_daily_summary' ||
      intent === 'author_stock_status' ||
      intent === 'opinion_validation' ||
      intent === 'market_analysis' ||
      intent === 'fallback'
    ) {
      return intent;
    }

    return 'fallback';
  }

  private normalizeStringOrNull(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.normalizeStringOrNull(item))
      .filter((item): item is string => Boolean(item));
  }

  private normalizeDateOrNull(value: unknown): string | null {
    const normalized = this.normalizeStringOrNull(value);
    if (!normalized) {
      return null;
    }

    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
  }

  private createClient(apiKey: string, baseURL: string): OpenAI | null {
    if (!baseURL) {
      return null;
    }

    return new OpenAI({ apiKey: apiKey || 'dummy-key', baseURL });
  }

  private trace(label: string, payload: unknown): void {
    if (!this.debugTraceEnabled) {
      return;
    }

    try {
      console.info(`[LLM TRACE] ${label}`, JSON.stringify(payload, null, 2));
    } catch {
      console.info(`[LLM TRACE] ${label}`, String(payload));
    }
  }
}
