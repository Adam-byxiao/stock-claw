import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from './components/Layout';
import StockDashboard from './pages/Dashboard';
import NewsFeed from './pages/News';
import FundFlow from './pages/FundFlow';
import StockDetail from './pages/StockDetail';
import AgentChat from './pages/AgentChat';

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
            <Route path="stock/:code" element={<StockDetail />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
