import axios from 'axios';

const resolvedApiBaseUrl = (
  import.meta as ImportMeta & {
    env?: {
      VITE_API_BASE_URL?: string;
    };
  }
).env?.VITE_API_BASE_URL?.trim();

export const apiClient = axios.create({
  baseURL: resolvedApiBaseUrl || '/api',
  timeout: 120000, // Increased timeout to 120s (2 mins) for LLM deep analysis
});

export const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (axios.isAxiosError(error)) {
    const responseMessage = (error.response?.data as { error?: string } | undefined)?.error;
    if (responseMessage) {
      return responseMessage;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

export const getStockData = async (codes: string[]) => {
  const { data } = await apiClient.get('/stock', {
    params: { codes: codes.join(',') },
  });
  return data.data;
};

export const getStockInfo = async (code: string) => {
  const { data } = await apiClient.get('/stock/info', {
    params: { code },
  });
  return data.data;
};

export const searchStock = async (q: string) => {
  const { data } = await apiClient.get('/stock/search', {
    params: { q },
  });
  return data.data;
};

export const getKlineData = async (code: string, type: string) => {
  const { data } = await apiClient.get('/stock/kline', {
    params: { code, type },
  });
  return data.data;
};

export const getTimelineData = async (code: string) => {
  const { data } = await apiClient.get('/stock/timeline', {
    params: { code },
  });
  return data.data;
};

export const getFlashNews = async (limit: number = 20) => {
  const { data } = await apiClient.get('/news', {
    params: { limit },
  });
  return data.data;
};

export const getSectorFundFlow = async (type: string = 'concept') => {
  const { data } = await apiClient.get('/fund/sector', {
    params: { type },
  });
  return data.data;
};

export const getHSGTFlow = async () => {
  const { data } = await apiClient.get('/fund/hsgt');
  return data.data;
};

export const chatWithAgent = async (message: string) => {
  const { data } = await apiClient.post('/agent/chat', {
    message
  });
  return data;
};
