import crypto from 'crypto';

export const canonicalizeThreadUrl = (threadUrl: string): string => {
  try {
    const url = new URL(threadUrl.trim());
    const tid = url.searchParams.get('tid');
    if (!tid) {
      return threadUrl.trim();
    }

    const canonicalUrl = new URL(`${url.origin}${url.pathname}`);
    canonicalUrl.searchParams.set('tid', tid);

    const authorId = url.searchParams.get('authorid');
    if (authorId) {
      canonicalUrl.searchParams.set('authorid', authorId);
    }

    return canonicalUrl.toString();
  } catch (_error) {
    return threadUrl.trim();
  }
};

export const buildThreadKey = (threadUrl: string): string => {
  return crypto.createHash('sha256').update(canonicalizeThreadUrl(threadUrl)).digest('hex');
};

export const buildThreadPageUrl = (threadUrl: string, pageNumber: number): string => {
  const url = new URL(canonicalizeThreadUrl(threadUrl));
  if (pageNumber > 1) {
    url.searchParams.set('page', String(pageNumber));
  }

  return url.toString();
};
