import * as cheerio from 'cheerio';
import { V0ParsedForumMessage } from '../shared/types';

const CONTAINER_SELECTORS = [
  '[data-floor]',
  '[data-floor-id]',
  '.postrow',
  '.postRow',
  '.forumbox .post',
  '.postContainer',
  '.post-container',
];

const CONTENT_SELECTORS = [
  '[data-role="content"]',
  '.postcontent',
  '.content',
  '.post-content',
  '.entry-content',
  '.postbody',
  '.post_body',
  '.cmt',
];

const TEXT_CLEANUP_REGEX = /\s+/g;

export class V0MessageParser {
  parseThreadHtml(html: string, threadUrl: string): V0ParsedForumMessage[] {
    const $ = cheerio.load(html);
    const containers = this.findContainers($);

    return containers
      .map((element) => this.parseContainer($, element, threadUrl))
      .filter((message): message is V0ParsedForumMessage => message !== null);
  }

  private findContainers($: cheerio.CheerioAPI): any[] {
    const uniqueElements = new Set<any>();
    const orderedMatches: any[] = [];

    $('body *').each((_, element) => {
      for (const selector of CONTAINER_SELECTORS) {
        if ($(element).is(selector)) {
          if (!uniqueElements.has(element)) {
            uniqueElements.add(element);
            orderedMatches.push(element);
          }
          break;
        }
      }
    });

    return orderedMatches;
  }

  private parseContainer(
    $: cheerio.CheerioAPI,
    element: any,
    threadUrl: string
  ): V0ParsedForumMessage | null {
    const container = $(element);
    const floorId = this.extractFloorId($, container);
    const authorName = this.extractAuthorName($, container);
    const rawContent = this.extractContent($, container);

    if (!floorId || !authorName || !rawContent) {
      return null;
    }

    return {
      floorId,
      authorName,
      postedAt: this.extractPostedAt($, container),
      rawContent,
      normalizedContent: this.normalizeText(rawContent),
      sourceUrl: threadUrl,
    };
  }

  private extractFloorId($: cheerio.CheerioAPI, container: cheerio.Cheerio<any>): string {
    const directAttrs = [
      container.attr('data-floor'),
      container.attr('data-floor-id'),
      container.attr('data-pid'),
    ];

    for (const value of directAttrs) {
      if (value && value.trim()) {
        return value.trim();
      }
    }

    const idValue = container.attr('id');
    if (idValue) {
      const ngaPostMatch = idValue.match(/(?:post1strow|postrow|postcontainer)(\d+)/i);
      if (ngaPostMatch) {
        return ngaPostMatch[1];
      }

      const idMatch = idValue.match(/(?:post|pid|floor)[_-]?(\d+)/i);
      if (idMatch) {
        return idMatch[1];
      }
    }

    const floorText = this.normalizeText(
      container.find('.floor, .lou, .post-index, [data-role="floor"]').first().text()
    );
    if (floorText) {
      const floorMatch = floorText.match(/(\d+)/);
      if (floorMatch) {
        return floorMatch[1];
      }
    }

    return '';
  }

  private extractAuthorName(
    $: cheerio.CheerioAPI,
    container: cheerio.Cheerio<any>
  ): string {
    const directAttrs = [container.attr('data-author'), container.attr('data-username')];
    for (const value of directAttrs) {
      if (value && value.trim()) {
        return value.trim();
      }
    }

    const selectors = [
      '.author a',
      '.poster a',
      '.author',
      '.poster',
      '[data-role="author"]',
      '.c2 a',
    ];

    for (const selector of selectors) {
      const authorNode = container.find(selector).first();
      const text = this.normalizeText(authorNode.text());
      if (text) {
        return text;
      }

      const uid = authorNode.attr('href')?.match(/[?&]uid=(\d+)/)?.[1];
      if (uid) {
        return `UID:${uid}`;
      }
    }

    return '';
  }

  private extractPostedAt(
    $: cheerio.CheerioAPI,
    container: cheerio.Cheerio<any>
  ): string {
    const timeSelectors = [
      container.find('time').first().attr('datetime'),
      container.find('[data-role="time"]').first().attr('datetime'),
      container.find('.postInfo span[id^="postdate"]').first().text(),
      container.find('.post-time').first().text(),
      container.find('.time').first().text(),
    ];

    for (const value of timeSelectors) {
      const normalized = this.normalizeText(value ?? '');
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private extractContent(
    $: cheerio.CheerioAPI,
    container: cheerio.Cheerio<any>
  ): string {
    for (const selector of CONTENT_SELECTORS) {
      const contentNode = container.find(selector).first();
      if (contentNode.length > 0) {
        const cloned = contentNode.clone();
        cloned.find('.quote, .foldBox, .signature, script, style').remove();
        const text = this.normalizeText(cloned.text());
        if (text) {
          return text;
        }
      }
    }

    const fallback = this.normalizeText(container.text());
    return fallback;
  }

  private normalizeText(value: string): string {
    return value.replace(TEXT_CLEANUP_REGEX, ' ').trim();
  }
}
