import axios, { AxiosError, AxiosInstance } from 'axios';
import crypto from 'crypto';

export interface FeishuBotMessagePayload {
  authorName: string;
  postedAt: string;
  sourceUrl: string;
  rawContent: string;
  mentions: string[];
  marketSummaries: string[];
}

export interface FeishuBotChannelOptions {
  webhookUrl: string;
  secret?: string;
  httpClient?: Pick<AxiosInstance, 'post'>;
}

interface FeishuBotApiResponse {
  code?: number;
  msg?: string;
  data?: unknown;
  Extra?: unknown;
  StatusCode?: number;
  StatusMessage?: string;
}

type FeishuBotErrorReason =
  | 'invalid_webhook'
  | 'keyword_not_found'
  | 'ip_not_allowed'
  | 'rate_limited'
  | 'bad_request'
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'response_error';

interface FeishuBotErrorDetails {
  reason: FeishuBotErrorReason;
  retryable: boolean;
  feishuCode?: number;
  feishuMessage?: string;
  httpStatus?: number;
}

const MAX_FEISHU_TEXT_BYTES = 18 * 1024;

const KNOWN_FEISHU_ERROR_CODES: Record<
  number,
  Pick<FeishuBotErrorDetails, 'reason' | 'retryable'> & { message: string }
> = {
  9499: {
    reason: 'bad_request',
    retryable: false,
    message: 'feishu webhook rejected the request body',
  },
  11232: {
    reason: 'rate_limited',
    retryable: true,
    message: 'feishu webhook rate limit exceeded',
  },
  19022: {
    reason: 'ip_not_allowed',
    retryable: false,
    message: 'feishu webhook ip is not allowed',
  },
  19024: {
    reason: 'keyword_not_found',
    retryable: false,
    message: 'feishu webhook keyword check failed',
  },
};

export const createFeishuBotSignature = (timestamp: string, secret: string): string => {
  return crypto
    .createHmac('sha256', `${timestamp}\n${secret}`)
    .update('')
    .digest('base64');
};

const isValidFeishuWebhookUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    const allowedHosts = new Set(['open.feishu.cn', 'open.larksuite.com']);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
      return false;
    }

    return (
      parsed.pathname.startsWith('/open-apis/bot/v2/hook/') ||
      parsed.pathname.startsWith('/open-apis/bot/hook/')
    );
  } catch {
    return false;
  }
};

const truncateUtf8Text = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return value;
  }

  const suffix = '\n...(message truncated)';
  let truncated = value;
  while (truncated.length > 0 && Buffer.byteLength(`${truncated}${suffix}`, 'utf8') > maxBytes) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}${suffix}`;
};

const getFeishuResponseCode = (response: FeishuBotApiResponse | null): number | undefined => {
  if (!response) {
    return undefined;
  }

  if (typeof response.code === 'number') {
    return response.code;
  }

  if (typeof response.StatusCode === 'number') {
    return response.StatusCode;
  }

  return undefined;
};

const getFeishuResponseMessage = (response: FeishuBotApiResponse | null): string => {
  if (!response) {
    return '';
  }

  if (typeof response.msg === 'string' && response.msg.trim().length > 0) {
    return response.msg.trim();
  }

  if (typeof response.StatusMessage === 'string' && response.StatusMessage.trim().length > 0) {
    return response.StatusMessage.trim();
  }

  return '';
};

export class FeishuBotPushError extends Error {
  readonly details: FeishuBotErrorDetails;

  constructor(message: string, details: FeishuBotErrorDetails) {
    super(message);
    this.name = 'FeishuBotPushError';
    this.details = details;
  }
}

const createFeishuResponseError = (
  response: FeishuBotApiResponse | null,
  httpStatus?: number
): FeishuBotPushError => {
  const feishuCode = getFeishuResponseCode(response);
  const feishuMessage = getFeishuResponseMessage(response);

  if (typeof feishuCode === 'number' && KNOWN_FEISHU_ERROR_CODES[feishuCode]) {
    const matched = KNOWN_FEISHU_ERROR_CODES[feishuCode];
    return new FeishuBotPushError(
      `${matched.message}${feishuMessage ? `: ${feishuMessage}` : ''}`,
      {
        reason: matched.reason,
        retryable: matched.retryable,
        feishuCode,
        feishuMessage,
        httpStatus,
      }
    );
  }

  return new FeishuBotPushError(
    `feishu webhook responded with an error${
      typeof feishuCode === 'number' ? ` (code ${feishuCode})` : ''
    }${feishuMessage ? `: ${feishuMessage}` : ''}`,
    {
      reason: 'response_error',
      retryable: false,
      feishuCode,
      feishuMessage,
      httpStatus,
    }
  );
};

const createAxiosMappedError = (error: AxiosError): FeishuBotPushError => {
  const responseData =
    error.response && typeof error.response.data === 'object'
      ? (error.response.data as FeishuBotApiResponse)
      : null;

  if (responseData && getFeishuResponseCode(responseData) !== undefined) {
    return createFeishuResponseError(responseData, error.response?.status);
  }

  const httpStatus = error.response?.status;
  if (typeof httpStatus === 'number') {
    const message =
      httpStatus === 400
        ? 'feishu webhook rejected the request'
        : httpStatus === 401 || httpStatus === 403
          ? 'feishu webhook authorization failed'
          : httpStatus === 404
            ? 'feishu webhook address not found'
            : httpStatus === 429
              ? 'feishu webhook rate limit exceeded'
              : httpStatus >= 500
                ? 'feishu webhook server error'
                : `feishu webhook http error (${httpStatus})`;

    return new FeishuBotPushError(message, {
      reason: httpStatus === 429 ? 'rate_limited' : 'http_error',
      retryable: httpStatus === 429 || httpStatus >= 500,
      httpStatus,
    });
  }

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return new FeishuBotPushError('feishu webhook request timed out', {
      reason: 'timeout',
      retryable: true,
    });
  }

  return new FeishuBotPushError(
    `feishu webhook network error${error.message ? `: ${error.message}` : ''}`,
    {
      reason: 'network',
      retryable: true,
    }
  );
};

export class FeishuBotPushChannel {
  readonly channelName = 'feishu_bot';
  private readonly httpClient: Pick<AxiosInstance, 'post'>;

  constructor(private readonly options: FeishuBotChannelOptions) {
    if (!isValidFeishuWebhookUrl(options.webhookUrl)) {
      throw new FeishuBotPushError('feishu webhook url is invalid', {
        reason: 'invalid_webhook',
        retryable: false,
      });
    }

    this.httpClient = options.httpClient ?? axios;
  }

  async send(payload: FeishuBotMessagePayload): Promise<void> {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body: Record<string, unknown> = {
      msg_type: 'text',
      content: {
        text: this.buildMessageText(payload),
      },
    };

    if (this.options.secret) {
      body.timestamp = timestamp;
      body.sign = createFeishuBotSignature(timestamp, this.options.secret);
    }

    try {
      const response = (await this.httpClient.post(this.options.webhookUrl, body, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      })) as { data?: FeishuBotApiResponse };

      const responseBody = response?.data ?? null;
      const responseCode = getFeishuResponseCode(responseBody);
      if (responseCode !== undefined && responseCode !== 0) {
        throw createFeishuResponseError(responseBody);
      }
    } catch (error) {
      if (error instanceof FeishuBotPushError) {
        throw error;
      }

      if (axios.isAxiosError(error)) {
        throw createAxiosMappedError(error);
      }

      throw error;
    }
  }

  private buildMessageText(payload: FeishuBotMessagePayload): string {
    const sections = [
      'Stock-Claw V0 飞书提醒',
      `作者: ${payload.authorName}`,
      `时间: ${payload.postedAt || '未知时间'}`,
      `内容: ${payload.rawContent}`,
    ];

    if (payload.mentions.length > 0) {
      sections.push(`提及: ${payload.mentions.join(', ')}`);
    }

    if (payload.marketSummaries.length > 0) {
      sections.push(`联动: ${payload.marketSummaries.join(' | ')}`);
    }

    if (payload.sourceUrl) {
      sections.push(`来源: ${payload.sourceUrl}`);
    }

    return truncateUtf8Text(sections.join('\n'), MAX_FEISHU_TEXT_BYTES);
  }
}
