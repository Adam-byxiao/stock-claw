import { apiClient } from '../../api';
import type {
  V0Config,
  V0AgentQueryResult,
  V0DailyDigestRecord,
  V0JobStatus,
  V0JobRunRecord,
  V0NotificationRecord,
  V0ExternalMarketFactsResponse,
  V0MarketFactsResponse,
  V0PersonaInferencePayload,
  V0PersonaInferenceResponse,
  V0PersonaRecentWeightPayload,
  V0PersonaRecentWeightResponse,
  V0PersonaDistillPayload,
  V0PersonaDistillResult,
  V0PersonaProfileRebuildPayload,
  V0PersonaProfileResult,
  V0PollPayload,
  V0PollResult,
  V0StoredForumMessage,
} from './types';

export const getV0Config = async (): Promise<V0Config> => {
  const { data } = await apiClient.get('/v0/config');
  return data;
};

export const saveV0Config = async (payload: V0Config): Promise<V0Config> => {
  const { data } = await apiClient.post('/v0/config', payload);
  return data.data;
};

export const pollV0Thread = async (payload?: V0PollPayload): Promise<V0PollResult> => {
  const { data } = await apiClient.post('/v0/poll', payload ?? {});
  return data.data;
};

export const getV0Messages = async (limit?: number): Promise<V0StoredForumMessage[]> => {
  const { data } = await apiClient.get('/v0/messages', {
    params: limit ? { limit } : undefined,
  });
  return data.data;
};

export const getV0MessageDetail = async (messageId: number): Promise<V0StoredForumMessage> => {
  const { data } = await apiClient.get(`/v0/messages/${messageId}`);
  return data.data;
};

export const getV0JobStatus = async (): Promise<V0JobStatus> => {
  const { data } = await apiClient.get('/v0/jobs/status');
  return data.data;
};

export const startV0Scheduler = async (): Promise<V0JobStatus> => {
  const { data } = await apiClient.post('/v0/jobs/scheduler/start');
  return data.data;
};

export const stopV0Scheduler = async (): Promise<V0JobStatus> => {
  const { data } = await apiClient.post('/v0/jobs/scheduler/stop');
  return data.data;
};

export const getV0JobRuns = async (): Promise<V0JobRunRecord[]> => {
  const { data } = await apiClient.get('/v0/jobs/runs');
  return data.data;
};

export const getV0Notifications = async (): Promise<V0NotificationRecord[]> => {
  const { data } = await apiClient.get('/v0/notifications');
  return data.data;
};

export const buildV0Digest = async (digestDate?: string): Promise<V0DailyDigestRecord> => {
  const { data } = await apiClient.post('/v0/digest/build', digestDate ? { digestDate } : {});
  return data.data;
};

export const getV0Digests = async (): Promise<V0DailyDigestRecord[]> => {
  const { data } = await apiClient.get('/v0/digests');
  return data.data;
};

export const distillV0Personas = async (
  payload?: V0PersonaDistillPayload
): Promise<V0PersonaDistillResult> => {
  const { data } = await apiClient.post('/v0/persona/distill', payload ?? {});
  return data.data;
};

export const rebuildV0PersonaProfile = async (
  payload: V0PersonaProfileRebuildPayload
): Promise<V0PersonaProfileResult> => {
  const { data } = await apiClient.post('/v0/persona/profile/rebuild', payload);
  return data.data;
};

export const getV0PersonaProfile = async (authorName: string): Promise<V0PersonaProfileResult> => {
  const { data } = await apiClient.get(`/v0/persona/profiles/${encodeURIComponent(authorName)}`);
  return data.data;
};

export const queryV0Agent = async (query: string, debug?: boolean): Promise<V0AgentQueryResult> => {
  const { data } = await apiClient.post('/v0/agent/query', { query, debug });
  return data.data;
};

export const inferV0Persona = async (
  payload: V0PersonaInferencePayload
): Promise<V0PersonaInferenceResponse> => {
  const { data } = await apiClient.post('/v0/agent/persona-inference', payload);
  return data.data;
};

export const analyzeV0PersonaRecentWeights = async (
  payload: V0PersonaRecentWeightPayload
): Promise<V0PersonaRecentWeightResponse> => {
  const { data } = await apiClient.post('/v0/persona/recent-weights', payload);
  return data.data;
};

export const getV0MarketFacts = async (params?: {
  queryDate?: string;
  stocks?: string[];
  sectors?: string[];
  includeOverview?: boolean;
  includeExternal?: boolean;
}): Promise<V0MarketFactsResponse> => {
  const { data } = await apiClient.get('/v0/market/facts', {
    params: {
      queryDate: params?.queryDate,
      stocks: params?.stocks?.join(','),
      sectors: params?.sectors?.join(','),
      includeOverview: params?.includeOverview,
      includeExternal: params?.includeExternal,
    },
  });
  return data.data;
};

export const getV0ExternalMarketFacts = async (params?: {
  queryDate?: string;
  includePoints?: boolean;
  includeRankings?: boolean;
  includeLimitReview?: boolean;
  topN?: number;
}): Promise<V0ExternalMarketFactsResponse> => {
  const { data } = await apiClient.get('/v0/market/external-facts', {
    params,
  });
  return data.data;
};
