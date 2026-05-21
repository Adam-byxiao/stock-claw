import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from './components/Layout';
import StockDashboard from './pages/Dashboard';
import NewsFeed from './pages/News';
import FundFlow from './pages/FundFlow';
import StockDetail from './pages/StockDetail';
import AgentChat from './pages/AgentChat';
import V0MonitorPage from './features/v0/pages/V0MonitorPage';
import V0AgentPage from './features/v0/pages/V0AgentPage';
import V0MessagesPage from './features/v0/pages/V0MessagesPage';
import V0OneShotCrawlPage from './features/v0/pages/V0OneShotCrawlPage';
import V0ExternalDataPage from './features/v0/pages/V0ExternalDataPage';
import V0PersonaDemoPage from './features/v0/pages/V0PersonaDemoPage';
import V0PersonaV2DemoPage from './features/v0/pages/V0PersonaV2DemoPage';

const queryClient = new QueryClient();

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<StockDashboard />} />
            <Route path="news" element={<NewsFeed />} />
            <Route path="fund-flow" element={<FundFlow />} />
            <Route path="agent" element={<AgentChat />} />
            <Route path="v0/oneshot" element={<V0OneShotCrawlPage />} />
            <Route path="v0/monitor" element={<V0MonitorPage />} />
            <Route path="v0/messages" element={<V0MessagesPage />} />
            <Route path="v0/agent" element={<V0AgentPage />} />
            <Route path="v0/persona-demo" element={<V0PersonaDemoPage />} />
            <Route path="v0/persona-v2-demo" element={<V0PersonaV2DemoPage />} />
            <Route path="v0/external-data" element={<V0ExternalDataPage />} />
            <Route path="stock/:code" element={<StockDetail />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
