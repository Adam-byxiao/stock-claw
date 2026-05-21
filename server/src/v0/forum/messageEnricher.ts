import { V0MessageMention, V0ParsedForumMessage } from '../shared/types';

const STOCK_CODE_REGEX = /\b(?:sh|sz)?\d{6}\b/gi;

const STOCK_ALIAS_MAP: Record<string, string> = {
  拓维信息: 'sz002261',
  常山北明: 'sz000158',
  中科曙光: 'sh603019',
  浪潮信息: 'sz000977',
  工业富联: 'sh601138',
};

const SECTOR_KEYWORDS = [
  '机器人',
  '算力',
  '证券',
  '银行',
  '半导体',
  'AI',
  '人工智能',
  '软件',
  '军工',
  '芯片',
];

const normalizeStockCode = (code: string): string => {
  const normalized = code.trim().toLowerCase();
  if (normalized.startsWith('sh') || normalized.startsWith('sz')) {
    return normalized;
  }

  if (normalized.startsWith('6')) {
    return `sh${normalized}`;
  }

  return `sz${normalized}`;
};

export class V0MessageEnricher {
  extractMentions(message: V0ParsedForumMessage): V0MessageMention[] {
    const mentions: V0MessageMention[] = [];
    const seen = new Set<string>();
    const content = message.normalizedContent;

    const addMention = (mention: V0MessageMention) => {
      const key = `${mention.entityType}:${mention.normalizedCode ?? mention.entityName}`;
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      mentions.push(mention);
    };

    const stockCodeMatches = content.match(STOCK_CODE_REGEX) ?? [];
    for (const stockCode of stockCodeMatches) {
      addMention({
        entityType: 'stock',
        entityName: stockCode,
        normalizedCode: normalizeStockCode(stockCode),
        confidence: 0.98,
      });
    }

    for (const [alias, code] of Object.entries(STOCK_ALIAS_MAP)) {
      if (content.includes(alias)) {
        addMention({
          entityType: 'stock',
          entityName: alias,
          normalizedCode: code,
          confidence: 0.78,
        });
      }
    }

    for (const keyword of SECTOR_KEYWORDS) {
      if (content.includes(keyword)) {
        addMention({
          entityType: 'sector',
          entityName: keyword,
          normalizedCode: null,
          confidence: 0.75,
        });
      }
    }

    if (content.includes('黄线')) {
      addMention({
        entityType: 'yellow_line',
        entityName: '黄线',
        normalizedCode: null,
        confidence: 0.95,
      });
    }

    if (content.includes('白线')) {
      addMention({
        entityType: 'white_line',
        entityName: '白线',
        normalizedCode: null,
        confidence: 0.9,
      });
    }

    return mentions;
  }
}
