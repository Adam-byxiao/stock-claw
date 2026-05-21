import axios from 'axios';
import * as iconv from 'iconv-lite';

export interface NgaFetchOptions {
  cookie?: string;
}

export interface NgaConnector {
  fetchThreadHtml(threadUrl: string, options?: NgaFetchOptions): Promise<string>;
}

export class HttpNgaConnector implements NgaConnector {
  async fetchThreadHtml(threadUrl: string, options: NgaFetchOptions = {}): Promise<string> {
    const response = await this.getThreadResponse(threadUrl, options.cookie);

    let buffer = Buffer.from(response.data);
    let encoding = this.detectEncoding(response.headers['content-type'], buffer.toString('latin1'));
    let html = this.decodeBuffer(buffer, encoding);

    if (response.status === 403) {
      const guestJs = html.match(/document\.cookie = 'guestJs=([^;']+)/)?.[1];
      if (!guestJs) {
        throw new Error(`NGA request failed with status ${response.status}`);
      }

      const retryUrl = this.withFreshRand(threadUrl);
      const retryResponse = await this.getThreadResponse(retryUrl, options.cookie, {
        Referer: threadUrl,
        Cookie: this.mergeCookie(options.cookie, `guestJs=${guestJs}`),
      });

      buffer = Buffer.from(retryResponse.data);
      encoding = this.detectEncoding(
        retryResponse.headers['content-type'],
        buffer.toString('latin1')
      );
      html = this.decodeBuffer(buffer, encoding);
    } else if (response.status >= 400) {
      throw new Error(`NGA request failed with status ${response.status}`);
    }

    return html;
  }

  private async getThreadResponse(
    threadUrl: string,
    cookie?: string,
    extraHeaders: Record<string, string> = {}
  ) {
    try {
      return await axios.get(threadUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        proxy: false,
        validateStatus: () => true,
        headers: {
          ...this.buildHeaders(cookie),
          ...extraHeaders,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'unknown request error';
      throw new Error(`NGA request failed for ${threadUrl}: ${errorMessage}`);
    }
  }

  private buildHeaders(cookie?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };

    if (cookie?.trim()) {
      headers.Cookie = cookie.trim();
    }

    return headers;
  }

  private mergeCookie(primaryCookie: string | undefined, fallbackCookie: string): string {
    if (!primaryCookie?.trim()) {
      return fallbackCookie;
    }

    return `${primaryCookie.trim()}; ${fallbackCookie}`;
  }

  private decodeBuffer(buffer: Buffer, encoding: string): string {
    if (!iconv.encodingExists(encoding)) {
      throw new Error(`Unsupported response encoding: ${encoding}`);
    }

    return iconv.decode(buffer, encoding);
  }

  private withFreshRand(threadUrl: string): string {
    const url = new URL(threadUrl);
    url.searchParams.set('rand', String(Math.floor(Math.random() * 1000)));
    return url.toString();
  }

  private detectEncoding(contentTypeHeader: string | undefined, htmlPreview: string): string {
    const headerEncoding = contentTypeHeader
      ?.match(/charset=([^;]+)/i)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase();
    if (headerEncoding) {
      return this.normalizeEncoding(headerEncoding);
    }

    const metaEncoding = htmlPreview
      .match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
      ?.trim()
      .toLowerCase();

    if (metaEncoding) {
      return this.normalizeEncoding(metaEncoding);
    }

    return 'utf-8';
  }

  private normalizeEncoding(encoding: string): string {
    if (encoding === 'gbk') {
      return 'gb18030';
    }

    return encoding;
  }
}
