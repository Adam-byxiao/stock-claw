import Database from 'better-sqlite3';
import { V0AgentService } from './agent/agentService';
import { FastifyInstance } from 'fastify';
import { V0DigestService } from './digest/digestService';
import { V0ForumService } from './forum/forumService';
import { V0MessageEnricher } from './forum/messageEnricher';
import { V0MessageInsightStore } from './forum/messageInsightStore';
import { V0MessageStore } from './forum/messageStore';
import { HttpNgaConnector, NgaConnector } from './forum/ngaConnector';
import { V0MessageParser } from './forum/messageParser';
import { LLMService } from '../core/llm';
import { BigAMapPublicMapProvider, HttpBigAMapPublicMapProvider } from './market/bigamapProvider';
import { V0ExternalMarketFactsService } from './market/externalMarketFacts';
import { V0PersonaService } from './persona/personaService';
import { V0PersonaStore } from './persona/personaStore';
import { V0ThreadConfigService } from './forum/threadConfig';
import {
  DefaultV0MarketDataProvider,
  V0MarketBindingService,
  V0MarketDataProvider,
} from './market/marketBinding';
import { V0MarketFactsService } from './market/marketFacts';
import { V0PushService } from './push/pushService';
import { V0JobStatusService } from './shared/jobStatus';
import { initV0Tables } from './shared/init';
import { V0JobRunStore } from './shared/jobRunStore';
import { V0Scheduler } from './shared/jobs';
import {
  V0AgentQueryPayload,
  V0ConfigPayload,
  V0DigestBuildPayload,
  V0ExternalMarketFactsPayload,
  V0MarketFactsPayload,
  V0PersonaInferencePayload,
  V0PersonaRecentWeightPayload,
  V0PersonaDistillPayload,
  V0PersonaProfileRebuildPayload,
  V0PollPayload,
} from './shared/types';

const isValidCronExpression = (value: string): boolean => {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  return parts.every((part) => /^(\*|\d+|\*\/\d+|\d+(,\d+)*|\d+-\d+)$/.test(part));
};

const parseCsvQuery = (value: unknown): string[] => {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

interface RegisterV0RoutesOptions {
  database: Database.Database;
  connector?: NgaConnector;
  marketDataProvider?: V0MarketDataProvider;
  bigAMapProvider?: BigAMapPublicMapProvider;
  schedulerEnabled?: boolean;
  schedulerNow?: () => Date;
  schedulerPollIntervalMsOverride?: number;
  schedulerDigestCheckIntervalMs?: number;
}

export const registerV0Routes = (
  server: FastifyInstance,
  options: RegisterV0RoutesOptions
): void => {
  initV0Tables(options.database);

  const configService = new V0ThreadConfigService(options.database);
  const insightStore = new V0MessageInsightStore(options.database);
  const messageStore = new V0MessageStore(options.database, insightStore);
  const connector = options.connector ?? new HttpNgaConnector();
  const parser = new V0MessageParser();
  const messageEnricher = new V0MessageEnricher();
  const marketDataProvider = options.marketDataProvider ?? new DefaultV0MarketDataProvider();
  const bigAMapProvider = options.bigAMapProvider ?? new HttpBigAMapPublicMapProvider();
  const externalMarketFactsService = new V0ExternalMarketFactsService(bigAMapProvider);
  const marketBindingService = new V0MarketBindingService(marketDataProvider);
  const marketFactsService = new V0MarketFactsService(marketDataProvider, externalMarketFactsService);
  const pushService = new V0PushService(options.database);
  const digestService = new V0DigestService(options.database);
  const jobRunStore = new V0JobRunStore(options.database);
  const llmService = new LLMService();
  const personaStore = new V0PersonaStore(options.database);
  const personaService = new V0PersonaService(
    options.database,
    personaStore,
    insightStore,
    messageStore,
    llmService,
    marketDataProvider
  );
  const agentService = new V0AgentService(
    options.database,
    insightStore,
    marketDataProvider,
    llmService,
    undefined,
    personaService,
    marketFactsService
  );
  const forumService = new V0ForumService(
    configService,
    connector,
    parser,
    messageStore,
    messageEnricher,
    marketBindingService,
    insightStore,
    pushService,
    personaService
  );
  const scheduler = new V0Scheduler(configService, forumService, digestService, {
    enabled: options.schedulerEnabled ?? process.env.V0_SCHEDULER_ENABLED === 'true',
    now: options.schedulerNow,
    pollIntervalMsOverride: options.schedulerPollIntervalMsOverride,
    digestCheckIntervalMs: options.schedulerDigestCheckIntervalMs,
    jobRunStore,
  });
  const jobStatusService = new V0JobStatusService(
    options.database,
    configService,
    jobRunStore,
    scheduler
  );

  if (options.schedulerEnabled ?? process.env.V0_SCHEDULER_ENABLED === 'true') {
    scheduler.start();
  }

  server.addHook('onClose', async () => {
    scheduler.stop();
  });

  server.get('/api/v0/config', async () => {
    return configService.getConfig();
  });

  server.post<{ Body: V0ConfigPayload }>('/api/v0/config', async (request, reply) => {
    const body = request.body ?? {};

    if (body.threadUrl !== undefined && typeof body.threadUrl !== 'string') {
      return reply.code(400).send({ error: 'threadUrl must be a string' });
    }

    if (body.threadTitle !== undefined && typeof body.threadTitle !== 'string') {
      return reply.code(400).send({ error: 'threadTitle must be a string' });
    }

    if (body.ngaCookie !== undefined && typeof body.ngaCookie !== 'string') {
      return reply.code(400).send({ error: 'ngaCookie must be a string' });
    }

    if (body.pollIntervalSeconds !== undefined) {
      const isValidInterval =
        typeof body.pollIntervalSeconds === 'number' &&
        Number.isFinite(body.pollIntervalSeconds) &&
        Number.isInteger(body.pollIntervalSeconds) &&
        body.pollIntervalSeconds > 0;

      if (!isValidInterval) {
        return reply
          .code(400)
          .send({ error: 'pollIntervalSeconds must be a positive integer' });
      }
    }

    if (body.authors !== undefined && !Array.isArray(body.authors)) {
      return reply.code(400).send({ error: 'authors must be an array of strings' });
    }

    if (
      body.authors !== undefined &&
      body.authors.some((author) => typeof author !== 'string')
    ) {
      return reply.code(400).send({ error: 'authors must be an array of strings' });
    }

    if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
      return reply.code(400).send({ error: 'enabled must be a boolean' });
    }

    if (body.pushEnabled !== undefined && typeof body.pushEnabled !== 'boolean') {
      return reply.code(400).send({ error: 'pushEnabled must be a boolean' });
    }

    if (
      body.pushChannel !== undefined &&
      body.pushChannel !== 'console' &&
      body.pushChannel !== 'feishu_bot'
    ) {
      return reply.code(400).send({ error: 'pushChannel must be console or feishu_bot' });
    }

    if (body.pushWebhookUrl !== undefined && typeof body.pushWebhookUrl !== 'string') {
      return reply.code(400).send({ error: 'pushWebhookUrl must be a string' });
    }

    if (body.pushSecret !== undefined && typeof body.pushSecret !== 'string') {
      return reply.code(400).send({ error: 'pushSecret must be a string' });
    }

    if (body.digestEnabled !== undefined && typeof body.digestEnabled !== 'boolean') {
      return reply.code(400).send({ error: 'digestEnabled must be a boolean' });
    }

    if (body.digestCron !== undefined && typeof body.digestCron !== 'string') {
      return reply.code(400).send({ error: 'digestCron must be a string' });
    }

    if (body.digestCron !== undefined && !isValidCronExpression(body.digestCron)) {
      return reply
        .code(400)
        .send({ error: 'digestCron must be a valid 5-field cron expression' });
    }

    const data = configService.saveConfig(body);
    scheduler.refreshConfig();
    return { data };
  });

  server.post<{ Body: V0PollPayload }>('/api/v0/poll', async (request, reply) => {
    const body = request.body ?? {};

    if (
      body.crawlMode !== undefined &&
      body.crawlMode !== 'latest' &&
      body.crawlMode !== 'from_start' &&
      body.crawlMode !== 'range' &&
      body.crawlMode !== 'full'
    ) {
      return reply
        .code(400)
        .send({ error: 'crawlMode must be latest, from_start, range or full' });
    }

    if (body.maxPages !== undefined) {
      const isValidMaxPages =
        typeof body.maxPages === 'number' &&
        Number.isFinite(body.maxPages) &&
        Number.isInteger(body.maxPages) &&
        body.maxPages > 0 &&
        body.maxPages <= 10000;

      if (!isValidMaxPages) {
        return reply.code(400).send({ error: 'maxPages must be an integer from 1 to 10000' });
      }
    }

    for (const [fieldName, fieldValue] of [
      ['pageStart', body.pageStart],
      ['pageEnd', body.pageEnd],
    ] as const) {
      if (fieldValue === undefined) {
        continue;
      }

      const isValidPageNumber =
        typeof fieldValue === 'number' &&
        Number.isFinite(fieldValue) &&
        Number.isInteger(fieldValue) &&
        fieldValue > 0 &&
        fieldValue <= 10000;
      if (!isValidPageNumber) {
        return reply.code(400).send({ error: `${fieldName} must be an integer from 1 to 10000` });
      }
    }

    if (
      body.crawlMode === 'range' &&
      body.pageStart !== undefined &&
      body.pageEnd !== undefined &&
      body.pageEnd < body.pageStart
    ) {
      return reply.code(400).send({ error: 'pageEnd must be greater than or equal to pageStart' });
    }

    try {
      const data = await scheduler.runPollJob('manual', body);
      return { data };
    } catch (error) {
      if (error instanceof Error && error.message === 'threadUrl is required before polling') {
        return reply.code(400).send({ error: error.message });
      }

      if (error instanceof Error && error.message === 'thread polling is disabled') {
        return reply.code(409).send({ error: error.message });
      }

      const detail = error instanceof Error ? error.message : 'unknown poll error';
      request.log.error({ err: error }, 'V0 poll failed');
      return reply.code(502).send({
        error: 'Failed to fetch or parse thread content',
        detail,
      });
    }
  });

  server.get<{ Querystring: { limit?: string } }>('/api/v0/messages', async (request, reply) => {
    const rawLimit = request.query.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);

    if (!Number.isInteger(limit) || limit <= 0 || limit > 10000) {
      return reply.code(400).send({ error: 'limit must be an integer from 1 to 10000' });
    }

    return {
      data: messageStore.getRecentMessages(limit),
    };
  });

  server.get<{ Params: { id: string } }>('/api/v0/messages/:id', async (request, reply) => {
    const messageId = Number(request.params.id);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return reply.code(400).send({ error: 'message id must be a positive integer' });
    }

    const data = messageStore.getMessageById(messageId);
    if (!data) {
      return reply.code(404).send({ error: 'message not found' });
    }

    return { data };
  });

  server.get('/api/v0/jobs/status', async () => {
    return {
      data: jobStatusService.getStatus(),
    };
  });

  server.post('/api/v0/jobs/scheduler/start', async () => {
    scheduler.start();
    return {
      data: jobStatusService.getStatus(),
    };
  });

  server.post('/api/v0/jobs/scheduler/stop', async () => {
    scheduler.stop();
    return {
      data: jobStatusService.getStatus(),
    };
  });

  server.get('/api/v0/jobs/runs', async () => {
    return {
      data: jobRunStore.getRecentRuns(),
    };
  });

  server.get('/api/v0/notifications', async () => {
    return {
      data: pushService.getRecentNotifications(),
    };
  });

  server.post<{ Body: V0DigestBuildPayload }>('/api/v0/digest/build', async (request, reply) => {
    const body = request.body ?? {};

    if (body.digestDate !== undefined && typeof body.digestDate !== 'string') {
      return reply.code(400).send({ error: 'digestDate must be a string' });
    }

    if (body.digestDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.digestDate)) {
      return reply.code(400).send({ error: 'digestDate must match YYYY-MM-DD' });
    }

    return {
      data: await scheduler.runDigestJob('manual', body.digestDate),
    };
  });

  server.get('/api/v0/digests', async () => {
    return {
      data: digestService.getRecentDigests(),
    };
  });

  server.post<{ Body: V0PersonaDistillPayload }>('/api/v0/persona/distill', async (request, reply) => {
    const body = request.body ?? {};

    if (body.authorNames !== undefined) {
      if (!Array.isArray(body.authorNames)) {
        return reply.code(400).send({ error: 'authorNames must be an array of strings' });
      }

      if (body.authorNames.some((authorName) => typeof authorName !== 'string')) {
        return reply.code(400).send({ error: 'authorNames must be an array of strings' });
      }
    }

    for (const [fieldName, fieldValue] of [
      ['maxMessages', body.maxMessages],
      ['maxChunks', body.maxChunks],
      ['axisTopK', body.axisTopK],
      ['evidencePoolSize', body.evidencePoolSize],
      ['recentChunkLimit', body.recentChunkLimit],
    ] as const) {
      if (fieldValue === undefined) {
        continue;
      }

      if (
        typeof fieldValue !== 'number' ||
        !Number.isInteger(fieldValue) ||
        fieldValue <= 0 ||
        fieldValue > 100000
      ) {
        return reply.code(400).send({ error: `${fieldName} must be an integer from 1 to 100000` });
      }
    }

    if (body.bootstrap !== undefined && typeof body.bootstrap !== 'boolean') {
      return reply.code(400).send({ error: 'bootstrap must be a boolean' });
    }

    if (body.force !== undefined && typeof body.force !== 'boolean') {
      return reply.code(400).send({ error: 'force must be a boolean' });
    }

    if (body.fullHistory !== undefined && typeof body.fullHistory !== 'boolean') {
      return reply.code(400).send({ error: 'fullHistory must be a boolean' });
    }

    if (body.version !== undefined && body.version !== 1 && body.version !== 2) {
      return reply.code(400).send({ error: 'version must be 1 or 2' });
    }

    return {
      data: await personaService.runDistillation({
        authorNames: body.authorNames,
        bootstrap: body.bootstrap,
        force: body.force,
        version: body.version,
        fullHistory: body.fullHistory,
        maxMessages: body.maxMessages,
        maxChunks: body.maxChunks,
        axisTopK: body.axisTopK,
        evidencePoolSize: body.evidencePoolSize,
        recentChunkLimit: body.recentChunkLimit,
      }),
    };
  });

  server.post<{ Body: V0PersonaProfileRebuildPayload }>(
    '/api/v0/persona/profile/rebuild',
    async (request, reply) => {
      const body = request.body ?? ({} as V0PersonaProfileRebuildPayload);

      if (typeof body.authorName !== 'string' || body.authorName.trim().length === 0) {
        return reply.code(400).send({ error: 'authorName is required' });
      }

      for (const [fieldName, fieldValue] of [
        ['maxChunks', body.maxChunks],
        ['axisTopK', body.axisTopK],
        ['evidencePoolSize', body.evidencePoolSize],
        ['recentChunkLimit', body.recentChunkLimit],
      ] as const) {
        if (fieldValue === undefined) {
          continue;
        }

        if (
          typeof fieldValue !== 'number' ||
          !Number.isInteger(fieldValue) ||
          fieldValue <= 0 ||
          fieldValue > 5000
        ) {
          return reply.code(400).send({ error: `${fieldName} must be an integer from 1 to 5000` });
        }
      }

      if (body.force !== undefined && typeof body.force !== 'boolean') {
        return reply.code(400).send({ error: 'force must be a boolean' });
      }

      if (body.fullHistory !== undefined && typeof body.fullHistory !== 'boolean') {
        return reply.code(400).send({ error: 'fullHistory must be a boolean' });
      }

      if (body.version !== undefined && body.version !== 1 && body.version !== 2) {
        return reply.code(400).send({ error: 'version must be 1 or 2' });
      }

      return {
        data: await personaService.rebuildAuthorProfile(body.authorName.trim(), {
          force: body.force,
          version: body.version,
          fullHistory: body.fullHistory,
          maxChunks: body.maxChunks,
          axisTopK: body.axisTopK,
          evidencePoolSize: body.evidencePoolSize,
          recentChunkLimit: body.recentChunkLimit,
        }),
      };
    }
  );

  server.get<{ Params: { authorName: string } }>(
    '/api/v0/persona/profiles/:authorName',
    async (request, reply) => {
      const authorName = decodeURIComponent(request.params.authorName).trim();
      if (!authorName) {
        return reply.code(400).send({ error: 'authorName is required' });
      }

      const data = personaService.getAuthorProfile(authorName);
      if (!data) {
        return reply.code(404).send({ error: 'profile not found' });
      }

      return { data };
    }
  );

  server.post<{ Body: V0AgentQueryPayload }>('/api/v0/agent/query', async (request, reply) => {
    const body = request.body ?? {};

    if (typeof body.query !== 'string') {
      return reply.code(400).send({ error: 'query must be a string' });
    }

    if (body.query.trim().length === 0) {
      return reply.code(400).send({ error: 'query is required' });
    }

    if (body.debug !== undefined && typeof body.debug !== 'boolean') {
      return reply.code(400).send({ error: 'debug must be a boolean' });
    }

    return {
      data: await agentService.query(body.query, body.debug),
    };
  });

  server.get<{
    Querystring: {
      queryDate?: string;
      date?: string;
      stocks?: string;
      sectors?: string;
      includeOverview?: string;
      includeExternal?: string;
    };
  }>('/api/v0/market/facts', async (request, reply) => {
    const queryDate = request.query.queryDate ?? request.query.date;

    if (queryDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      return reply.code(400).send({ error: 'queryDate must match YYYY-MM-DD' });
    }

    const includeOverview =
      request.query.includeOverview === undefined
        ? true
        : request.query.includeOverview !== 'false';
    const includeExternal =
      request.query.includeExternal === undefined
        ? true
        : request.query.includeExternal !== 'false';

    const payload: V0MarketFactsPayload = {
      queryDate,
      stocks: parseCsvQuery(request.query.stocks),
      sectors: parseCsvQuery(request.query.sectors),
      includeOverview,
      includeExternal,
    };

    return {
      data: await marketFactsService.buildFacts(payload),
    };
  });

  server.get<{
    Querystring: {
      queryDate?: string;
      date?: string;
      includePoints?: string;
      includeRankings?: string;
      includeLimitReview?: string;
      topN?: string;
    };
  }>('/api/v0/market/external-facts', async (request, reply) => {
    const queryDate = request.query.queryDate ?? request.query.date;

    if (queryDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      return reply.code(400).send({ error: 'queryDate must match YYYY-MM-DD' });
    }

    const topN = request.query.topN === undefined ? undefined : Number(request.query.topN);
    if (
      topN !== undefined &&
      (!Number.isInteger(topN) || topN <= 0 || topN > 20)
    ) {
      return reply.code(400).send({ error: 'topN must be an integer from 1 to 20' });
    }

    const payload: V0ExternalMarketFactsPayload = {
      queryDate,
      includePoints:
        request.query.includePoints === undefined
          ? true
          : request.query.includePoints !== 'false',
      includeRankings:
        request.query.includeRankings === undefined
          ? true
          : request.query.includeRankings !== 'false',
      includeLimitReview:
        request.query.includeLimitReview === undefined
          ? true
          : request.query.includeLimitReview !== 'false',
      topN,
    };

    return {
      data: await externalMarketFactsService.buildFacts(payload),
    };
  });

  server.post<{ Body: V0PersonaRecentWeightPayload }>(
    '/api/v0/persona/recent-weights',
    async (request, reply) => {
      const body = request.body ?? ({} as V0PersonaRecentWeightPayload);

      if (typeof body.query !== 'string') {
        return reply.code(400).send({ error: 'query must be a string' });
      }

      if (body.query.trim().length === 0) {
        return reply.code(400).send({ error: 'query is required' });
      }

      if (body.authorName !== undefined && typeof body.authorName !== 'string') {
        return reply.code(400).send({ error: 'authorName must be a string' });
      }

      if (body.queryDate !== undefined && typeof body.queryDate !== 'string') {
        return reply.code(400).send({ error: 'queryDate must be a string' });
      }

      if (body.queryDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.queryDate)) {
        return reply.code(400).send({ error: 'queryDate must match YYYY-MM-DD' });
      }

      if (body.sampleSize !== undefined) {
        if (
          typeof body.sampleSize !== 'number' ||
          !Number.isInteger(body.sampleSize) ||
          body.sampleSize <= 0 ||
          body.sampleSize > 80
        ) {
          return reply.code(400).send({ error: 'sampleSize must be an integer from 1 to 80' });
        }
      }

      if (body.debug !== undefined && typeof body.debug !== 'boolean') {
        return reply.code(400).send({ error: 'debug must be a boolean' });
      }

      try {
        return {
          data: await agentService.analyzeRecentWeights({
            query: body.query,
            authorName: body.authorName,
            queryDate: body.queryDate,
            sampleSize: body.sampleSize,
            debug: body.debug,
          }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'recent weight analysis failed';
        if (
          message === 'authorName is required or must match a watched author' ||
          message.startsWith('profile not found for')
        ) {
          return reply.code(400).send({ error: message });
        }

        request.log.error({ err: error }, 'V0 recent weight analysis failed');
        return reply.code(500).send({ error: message });
      }
    }
  );

  server.post<{ Body: V0PersonaInferencePayload }>(
    '/api/v0/agent/persona-inference',
    async (request, reply) => {
      const body = request.body ?? ({} as V0PersonaInferencePayload);

      if (typeof body.query !== 'string') {
        return reply.code(400).send({ error: 'query must be a string' });
      }

      if (body.query.trim().length === 0) {
        return reply.code(400).send({ error: 'query is required' });
      }

      if (body.authorName !== undefined && typeof body.authorName !== 'string') {
        return reply.code(400).send({ error: 'authorName must be a string' });
      }

      if (body.queryDate !== undefined && typeof body.queryDate !== 'string') {
        return reply.code(400).send({ error: 'queryDate must be a string' });
      }

      if (body.queryDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(body.queryDate)) {
        return reply.code(400).send({ error: 'queryDate must match YYYY-MM-DD' });
      }

      if (body.eventText !== undefined && typeof body.eventText !== 'string') {
        return reply.code(400).send({ error: 'eventText must be a string' });
      }

      for (const [fieldName, fieldValue] of [
        ['stockHints', body.stockHints],
        ['sectorHints', body.sectorHints],
      ] as const) {
        if (fieldValue === undefined) {
          continue;
        }

        if (!Array.isArray(fieldValue) || fieldValue.some((item) => typeof item !== 'string')) {
          return reply.code(400).send({ error: `${fieldName} must be an array of strings` });
        }
      }

      if (body.debug !== undefined && typeof body.debug !== 'boolean') {
        return reply.code(400).send({ error: 'debug must be a boolean' });
      }

      try {
        return {
          data: await agentService.inferWithPersona({
            query: body.query,
            authorName: body.authorName,
            queryDate: body.queryDate,
            eventText: body.eventText,
            stockHints: body.stockHints,
            sectorHints: body.sectorHints,
            debug: body.debug,
          }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'persona inference failed';
        if (
          message === 'authorName is required or must match a watched author' ||
          message.startsWith('profile not found for')
        ) {
          return reply.code(400).send({ error: message });
        }

        request.log.error({ err: error }, 'V0 persona inference failed');
        return reply.code(500).send({ error: message });
      }
    }
  );
};
