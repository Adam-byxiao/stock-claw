import { V0MarketBindingService } from '../market/marketBinding';
import {
  V0MessageMarketState,
  V0MessageMention,
  V0PollPayload,
  V0PollResponse,
} from '../shared/types';
import { V0PushService } from '../push/pushService';
import { V0MessageEnricher } from './messageEnricher';
import { V0MessageInsightStore } from './messageInsightStore';
import { V0MessageStore } from './messageStore';
import { V0ThreadConfigService } from './threadConfig';
import { NgaConnector } from './ngaConnector';
import { V0MessageParser } from './messageParser';
import { buildThreadKey, buildThreadPageUrl } from './threadKey';
import { V0PersonaService } from '../persona/personaService';
import { sameAuthor } from '../shared/authorIdentity';
import { toBeijingISOString } from '../shared/time';

interface FetchedThreadPage {
  pageUrl: string;
  html: string;
}

const MAX_PAGES_PER_POLL = 5;
const MAX_MANUAL_PAGES_PER_POLL = 10000;
const PAGE_FETCH_DELAY_MS = 300;

export class V0ForumService {
  constructor(
    private readonly configService: V0ThreadConfigService,
    private readonly connector: NgaConnector,
    private readonly parser: V0MessageParser,
    private readonly messageStore: V0MessageStore,
    private readonly messageEnricher: V0MessageEnricher,
    private readonly marketBindingService: V0MarketBindingService,
    private readonly insightStore: V0MessageInsightStore,
    private readonly pushService: V0PushService,
    private readonly personaService?: V0PersonaService
  ) {}

  async pollThread(payload: V0PollPayload = {}): Promise<V0PollResponse> {
    const config = this.configService.getConfig();

    if (!config.threadUrl) {
      throw new Error('threadUrl is required before polling');
    }

    if (!config.enabled) {
      throw new Error('thread polling is disabled');
    }

    const threadKey = buildThreadKey(config.threadUrl);
    const pages = await this.fetchThreadPagesForPoll(config.threadUrl, config.ngaCookie, payload);
    const parsedMessages = pages.flatMap((page) => {
      const pageMessages = this.parser.parseThreadHtml(page.html, page.pageUrl);
      this.messageStore.saveThreadSnapshot(
        threadKey,
        page.pageUrl,
        page.html,
        pageMessages.length
      );
      return pageMessages;
    });

    const matchedMessages =
      config.authors.length > 0
        ? parsedMessages.filter((message) =>
            config.authors.some((author) => sameAuthor(author, message.authorName))
          )
        : parsedMessages;

    const { newMessageCount, duplicateMessageCount, savedMessages } = this.messageStore.saveMessages(
      threadKey,
      parsedMessages
    );
    this.personaService?.indexStoredMessages(
      threadKey,
      savedMessages.map((savedMessage) => ({ ...savedMessage.message, id: savedMessage.id }))
    );
    let pushedMessageCount = 0;
    let pushFailureCount = 0;
    this.messageStore.updateCursor(
      threadKey,
      parsedMessages.length > 0 ? parsedMessages[parsedMessages.length - 1] : null
    );

    for (const savedMessage of savedMessages) {
      if (savedMessage.state === 'duplicate') {
        continue;
      }

      let mentions: V0MessageMention[] = [];
      let marketStates: V0MessageMarketState[] = [];

      try {
        mentions = this.messageEnricher.extractMentions(savedMessage.message);
        marketStates = await this.marketBindingService.buildMarketStates(
          savedMessage.message,
          mentions
        );
        this.insightStore.replaceMessageInsights(savedMessage.id, mentions, marketStates);
        this.messageStore.updateInsightStatus(savedMessage.id, 'success');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'unknown insight error';
        this.messageStore.updateInsightStatus(savedMessage.id, 'failed', errorMessage);
      }

      const shouldPush =
        config.pushEnabled &&
        this.messageStore.isWatchedAuthor(savedMessage.message.authorName, config.authors) &&
        ['inserted', 'updated'].includes(savedMessage.state);
      if (shouldPush) {
        const pushResult = await this.pushService.sendMessageNotification(
          config,
          savedMessage.id,
          savedMessage.message,
          mentions,
          marketStates
        );
        if (pushResult === 'success') {
          pushedMessageCount += 1;
        } else {
          pushFailureCount += 1;
        }
      }
    }

    return {
      threadUrl: config.threadUrl,
      threadTitle: config.threadTitle,
      matchedAuthorCount: new Set(matchedMessages.map((message) => message.authorName)).size,
      totalMessages: parsedMessages.length,
      matchedMessages,
      newMessageCount,
      duplicateMessageCount,
      pushedMessageCount,
      pushFailureCount,
      fetchedAt: toBeijingISOString(),
    };
  }

  private async fetchThreadPagesForPoll(
    threadUrl: string,
    ngaCookie: string,
    payload: V0PollPayload
  ): Promise<FetchedThreadPage[]> {
    const firstPageUrl = buildThreadPageUrl(threadUrl, 1);
    const fetchOptions = ngaCookie ? { cookie: ngaCookie } : undefined;
    const firstHtml = await this.connector.fetchThreadHtml(firstPageUrl, fetchOptions);
    const totalPages = this.extractTotalPages(firstHtml);
    const pageNumbers = this.buildPollPageNumbers(totalPages, payload);
    const pages: FetchedThreadPage[] = pageNumbers.includes(1)
      ? [{ pageUrl: firstPageUrl, html: firstHtml }]
      : [];

    for (const pageNumber of pageNumbers) {
      if (pageNumber === 1) {
        continue;
      }

      const pageUrl = buildThreadPageUrl(threadUrl, pageNumber);
      if (pages.length > 0) {
        await this.delay(PAGE_FETCH_DELAY_MS);
      }

      let html: string;
      try {
        html = await this.connector.fetchThreadHtml(pageUrl, fetchOptions);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'unknown fetch error';
        throw new Error(`Failed to fetch page ${pageNumber}: ${errorMessage}`);
      }
      pages.push({ pageUrl, html });
    }

    return pages;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private buildPollPageNumbers(totalPages: number, payload: V0PollPayload): number[] {
    const crawlMode = payload.crawlMode ?? 'latest';
    const maxPages =
      typeof payload.maxPages === 'number' &&
      Number.isInteger(payload.maxPages) &&
      payload.maxPages > 0
        ? Math.min(payload.maxPages, MAX_MANUAL_PAGES_PER_POLL)
        : MAX_PAGES_PER_POLL;

    if (crawlMode === 'full') {
      return Array.from({ length: totalPages }, (_value, index) => index + 1);
    }

    if (crawlMode === 'range') {
      const requestedStart =
        typeof payload.pageStart === 'number' &&
        Number.isInteger(payload.pageStart) &&
        payload.pageStart > 0
          ? payload.pageStart
          : 1;
      const requestedEnd =
        typeof payload.pageEnd === 'number' &&
        Number.isInteger(payload.pageEnd) &&
        payload.pageEnd > 0
          ? payload.pageEnd
          : requestedStart;
      const startPage = Math.max(1, Math.min(requestedStart, totalPages));
      const endPage = Math.max(startPage, Math.min(requestedEnd, totalPages));
      return Array.from({ length: endPage - startPage + 1 }, (_value, index) => startPage + index);
    }

    if (crawlMode === 'from_start') {
      const pageCount = Math.min(totalPages, maxPages);
      return Array.from({ length: pageCount }, (_value, index) => index + 1);
    }

    if (totalPages <= maxPages) {
      return Array.from({ length: totalPages }, (_value, index) => index + 1);
    }

    const tailStart = Math.max(1, totalPages - maxPages + 1);
    const pageNumbers: number[] = [];
    for (let pageNumber = tailStart; pageNumber <= totalPages; pageNumber += 1) {
      pageNumbers.push(pageNumber);
    }

    return pageNumbers;
  }

  private extractTotalPages(html: string): number {
    const pageMetaMatch = html.match(/__PAGE\s*=\s*\{0:[^,]+,1:(\d+),2:(\d+),3:(\d+)\}/);
    if (pageMetaMatch) {
      const totalPages = Number(pageMetaMatch[1]);
      if (Number.isInteger(totalPages) && totalPages > 0) {
        return totalPages;
      }
    }

    const pageNumbers = Array.from(html.matchAll(/[?&]page=(\d+)/g))
      .map((match) => Number(match[1]))
      .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0);

    return pageNumbers.length > 0 ? Math.max(...pageNumbers) : 1;
  }
}
