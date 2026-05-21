export interface V0Config {
  threadUrl: string;
  threadTitle: string;
  ngaCookie: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  pushEnabled: boolean;
  pushChannel: 'console' | 'feishu_bot';
  pushWebhookUrl: string;
  pushSecret: string;
  digestEnabled: boolean;
  digestCron: string;
  authors: string[];
}

export interface V0StoredForumMessage {
  id: number;
  threadKey: string;
  floorId: string;
  authorName: string;
  postedAt: string;
  rawContent: string;
  normalizedContent: string;
  contentHash: string;
  sourceUrl: string;
  isNew: boolean;
  insightStatus: 'pending' | 'success' | 'failed';
  insightError: string;
  enrichedAt: string | null;
  createdAt: string;
  mentions: V0MessageMention[];
  marketStates: V0MessageMarketState[];
}

export interface V0MessageMention {
  id?: number;
  messageId?: number;
  entityType: 'stock' | 'sector' | 'yellow_line' | 'white_line';
  entityName: string;
  normalizedCode: string | null;
  confidence: number;
}

export interface V0MessageMarketState {
  id?: number;
  messageId?: number;
  subjectType: 'stock' | 'sector' | 'yellow_line' | 'white_line';
  subjectKey: string;
  snapshotJson: string;
  summaryText: string;
  adviceText: string;
  createdAt?: string;
}

export interface V0PollMessage {
  floorId: string;
  authorName: string;
  postedAt: string;
  rawContent: string;
  normalizedContent: string;
  sourceUrl: string;
}

export interface V0PollResult {
  threadUrl: string;
  threadTitle: string;
  matchedAuthorCount: number;
  totalMessages: number;
  matchedMessages: V0PollMessage[];
  newMessageCount: number;
  duplicateMessageCount: number;
  pushedMessageCount: number;
  pushFailureCount: number;
  fetchedAt: string;
}

export interface V0PollPayload {
  crawlMode?: 'latest' | 'from_start' | 'range' | 'full';
  maxPages?: number;
  pageStart?: number;
  pageEnd?: number;
}

export interface V0NotificationRecord {
  id: number;
  messageId: number;
  channel: string;
  status: 'success' | 'failed';
  sentAt: string | null;
  payloadJson: string;
  errorMessage: string;
  createdAt: string;
}

export interface V0DailyDigestRecord {
  id: number;
  digestDate: string;
  contentMarkdown: string;
  status: 'success' | 'failed';
  messageCount: number;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface V0PersonaProfileRebuildPayload {
  authorName: string;
  force?: boolean;
  version?: 1 | 2;
  fullHistory?: boolean;
  maxChunks?: number;
  axisTopK?: number;
  evidencePoolSize?: number;
  recentChunkLimit?: number;
}

export interface V0PersonaDistillPayload {
  authorNames?: string[];
  bootstrap?: boolean;
  force?: boolean;
  version?: 1 | 2;
  fullHistory?: boolean;
  maxMessages?: number;
  maxChunks?: number;
  axisTopK?: number;
  evidencePoolSize?: number;
  recentChunkLimit?: number;
}

export type V0PersonaEvidenceBucket =
  | 'longformTheory'
  | 'intradayDecision'
  | 'riskWarning'
  | 'sectorStockReasoning'
  | 'marketStructure'
  | 'expressionStyle'
  | 'recentSignals'
  | 'contradictionCandidates';

export interface V0PersonaEvidenceRecord {
  chunkId: number;
  messageId: number;
  threadKey: string;
  floorId: string;
  authorName: string;
  postedAt: string;
  sourceUrl: string;
  chunkIndex: number;
  similarity: number;
  axis: string;
  excerpt: string;
  rawContent: string;
  mentions: string[];
  marketSummaries: string[];
  bucket?: V0PersonaEvidenceBucket;
  qualityScore?: number;
  evidenceRole?: string;
  beijingTime?: string;
  messageFloor?: string;
}

export interface V0PersonaProfileJsonV2 {
  schemaVersion: 2;
  authorName: string;
  summaryText: string;
  coreRules: string[];
  marketMethodology: {
    coreVariables: string[];
    reasoningSteps: string[];
    confirmationSignals: string[];
    invalidationSignals: string[];
    riskHandling: string;
    applicableScenarios: string[];
  };
  decisionHeuristics: string[];
  expressionDNA: {
    phrases: string[];
    sentenceStyle: string;
    certaintyStyle: string;
    rhetoric: string[];
  };
  topicMap: {
    stocks: string[];
    sectors: string[];
    concepts: string[];
    macroVariables: string[];
  };
  evidenceQuality: {
    totalEvidence: number;
    totalChunks: number;
    longformRatio: number;
    recentRatio: number;
    bucketCounts: Record<string, number>;
    weakAreas: string[];
    confidence: number;
  };
  contradictions: string[];
  honestBoundaries: string[];
  agenticProtocol: {
    questionTypes: string[];
    requiredContext: string[];
    analysisSteps: string[];
    confidenceCalibration: string;
  };
  correctionLog: Array<Record<string, unknown>>;
  evidenceStats?: Record<string, unknown>;
}

export interface V0AuthorProfileRecord {
  id: number;
  authorName: string;
  profileVersion: number;
  status: 'pending' | 'ready' | 'failed';
  summaryText: string;
  profileJson: string;
  evidenceJson: string;
  sourceMessageCount: number;
  sourceChunkCount: number;
  lastMessageAt: string;
  lastBuiltAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface V0ProfileRunRecord {
  id: number;
  authorName: string;
  triggerSource: 'manual' | 'scheduler' | 'agent';
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  summaryText: string;
  errorMessage: string;
  metadataJson: string;
}

export interface V0PersonaProfileResult {
  authorName: string;
  profile: V0AuthorProfileRecord;
  evidence: V0PersonaEvidenceRecord[];
  run: V0ProfileRunRecord;
  rebuilt: boolean;
}

export interface V0PersonaDistillResult {
  bootstrapped: boolean;
  indexedMessageCount: number;
  indexedChunkCount: number;
  processedAuthors: number;
  profiles: V0PersonaProfileResult[];
  targetAuthors: string[];
}

export interface V0AgentReference {
  messageId: number;
  authorName: string;
  postedAt: string;
  rawContent: string;
  mentions: string[];
  marketSummaries: string[];
}

export interface V0AgentQueryResult {
  queryType:
    | 'author_daily_summary'
    | 'author_stock_status'
    | 'author_profile'
    | 'opinion_validation'
    | 'market_analysis'
    | 'fallback';
  answer: string;
  references: V0AgentReference[];
  debugTrace?: Record<string, unknown>;
}

export interface V0PersonaInferencePayload {
  query: string;
  authorName?: string;
  queryDate?: string;
  eventText?: string;
  stockHints?: string[];
  sectorHints?: string[];
  debug?: boolean;
}

export interface V0PersonaRecentWeightPayload {
  query: string;
  authorName?: string;
  queryDate?: string;
  sampleSize?: number;
  debug?: boolean;
}

export type V0MarketFactKind =
  | 'market_overview'
  | 'stock_snapshot'
  | 'sector_snapshot'
  | 'external_market_overview'
  | 'external_sector_strength'
  | 'external_stock_strength'
  | 'external_limit_board'
  | 'external_data_scope'
  | 'missing'
  | 'not_realtime';

export interface V0MarketFactCitation {
  id: string;
  source: 'market_realtime' | 'bigamap';
  title: string;
  excerpt: string;
  subjectType: 'market' | 'stock' | 'sector' | 'system';
  subjectKey: string;
  capturedAt: string;
  confidence: number;
}

export interface V0MarketFactItem {
  id: string;
  kind: V0MarketFactKind;
  subjectType: 'market' | 'stock' | 'sector' | 'system';
  subjectKey: string;
  title: string;
  summary: string;
  capturedAt: string;
  data: Record<string, unknown>;
  citationId: string;
  confidence: number;
}

export interface V0MarketFactsResponse {
  queryDate: string | null;
  realtimeDate: string;
  isRealtime: boolean;
  requestedStocks: string[];
  requestedSectors: string[];
  externalSources?: V0ExternalMarketDataSourceSnapshot[];
  facts: V0MarketFactItem[];
  citations: V0MarketFactCitation[];
  missingInputs: string[];
  generatedAt: string;
}

export type V0ExternalMarketDataSource =
  | 'bigamap_points'
  | 'bigamap_maximized_rankings'
  | 'bigamap_limit_up_review';

export interface V0ExternalMarketDataSourceSnapshot {
  source: V0ExternalMarketDataSource;
  status: 'success' | 'missing' | 'failed';
  capturedAt: string;
  tradeDate?: string;
  generatedAt?: string;
  itemCount?: number;
  notice?: string;
  error?: string;
}

export interface V0ExternalMarketFactsResponse {
  queryDate: string | null;
  realtimeDate: string;
  isRealtime: boolean;
  provider: 'bigamap';
  sources: V0ExternalMarketDataSourceSnapshot[];
  facts: V0MarketFactItem[];
  citations: V0MarketFactCitation[];
  missingInputs: string[];
  generatedAt: string;
}

export interface V0PersonaRecentWeightSignal {
  key: string;
  label: string;
  weight: number;
  deltaFromProfile: number;
  direction: 'up' | 'down' | 'flat';
  evidenceCount: number;
  examples: string[];
}

export interface V0PersonaRecentWeightResponse {
  query: string;
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
  evidenceCitations: V0PersonaInferenceCitation[];
  markdown: string;
  debugTrace?: Record<string, unknown>;
}

export interface V0PersonaInferenceCitation {
  id: string;
  source:
    | 'profile_rule'
    | 'profile_methodology'
    | 'profile_evidence'
    | 'date_message'
    | 'recent_message'
    | 'relevant_message'
    | 'market_snapshot'
    | 'market_fact'
    | 'external_market_fact'
    | 'user_event';
  bucket?: string;
  title: string;
  excerpt: string;
  postedAt?: string;
  messageId?: number;
  floorId?: string;
  confidence?: number;
}

export interface V0PersonaEvidencePack {
  authorName: string;
  profileVersion: number | null;
  profileSummary: string;
  directDateMessageCount: number;
  marketFacts?: V0MarketFactsResponse;
  buckets: Array<{
    bucket: string;
    label: string;
    role: string;
    evidenceCount: number;
    citations: V0PersonaInferenceCitation[];
  }>;
  citations: V0PersonaInferenceCitation[];
}

export interface V0PersonaInferenceScenario {
  title: string;
  probability: 'high' | 'medium' | 'low' | 'unknown';
  triggerConditions: string[];
  reasoning: string;
  personaAction: string;
  invalidationSignals: string[];
  confidence: number;
  evidenceIds: string[];
}

export interface V0PersonaInferenceResponse {
  query: string;
  authorName: string;
  queryDate: string | null;
  summary: string;
  methodologyBasis: string[];
  currentFacts: string[];
  evidencePack: V0PersonaEvidencePack;
  scenarioSimulations: V0PersonaInferenceScenario[];
  riskBoundaries: string[];
  missingInputs: string[];
  evidenceCitations: V0PersonaInferenceCitation[];
  marketFacts?: V0MarketFactsResponse;
  recentWeight?: V0PersonaRecentWeightResponse;
  markdown: string;
  debugTrace?: Record<string, unknown>;
}

export interface V0JobStatus {
  threadUrl: string;
  threadTitle: string;
  enabled: boolean;
  pushEnabled: boolean;
  pushChannel: 'console' | 'feishu_bot';
  digestEnabled: boolean;
  digestCron: string;
  pollIntervalSeconds: number;
  totalStoredMessages: number;
  unreadMessageCount: number;
  pendingInsightCount: number;
  failedInsightCount: number;
  lastMessageAt: string | null;
  lastNotificationStatus: 'success' | 'failed' | 'idle';
  lastNotificationAt: string | null;
  lastDigestDate: string | null;
  lastDigestAt: string | null;
  schedulerEnabled: boolean;
  schedulerRunning: boolean;
  pollJobActive: boolean;
  digestJobActive: boolean;
  nextPollAt: string | null;
  nextDigestAt: string | null;
  lastSchedulerError: string | null;
  lastPollRun: V0JobRunRecord | null;
  lastDigestRun: V0JobRunRecord | null;
}

export interface V0JobRunRecord {
  id: number;
  jobType: 'poll_thread' | 'build_digest';
  triggerSource: 'manual' | 'scheduler';
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  summaryText: string;
  errorMessage: string;
  metadataJson: string;
}
