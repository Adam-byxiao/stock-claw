import React, { useState } from 'react';
import { Layout, Menu, theme } from 'antd';
import {
  DashboardOutlined,
  NotificationOutlined,
  FundOutlined,
  RobotOutlined,
  SettingOutlined,
  MessageOutlined,
  ExperimentOutlined,
  IdcardOutlined,
  RadarChartOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

const { Header, Content, Footer, Sider } = Layout;

const getBeijingYear = (): string => {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).format(new Date());
};

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  const [collapsed, setCollapsed] = useState(false);

  const items = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '行情看板',
    },
    {
      key: '/news',
      icon: <NotificationOutlined />,
      label: '市场快讯',
    },
    {
      key: '/fund-flow',
      icon: <FundOutlined />,
      label: '资金流向',
    },
    {
      key: '/agent',
      icon: <RobotOutlined />,
      label: '智能投研',
    },
    {
      key: '/v0/oneshot',
      icon: <ExperimentOutlined />,
      label: 'V0 单次抓取',
    },
    {
      key: '/v0/monitor',
      icon: <SettingOutlined />,
      label: 'V0配置',
    },
    {
      key: '/v0/messages',
      icon: <MessageOutlined />,
      label: 'V0消息流',
    },
    {
      key: '/v0/agent',
      icon: <ExperimentOutlined />,
      label: 'V0 Agent',
    },
    {
      key: '/v0/persona-demo',
      icon: <IdcardOutlined />,
      label: '人物画像 Demo',
    },
    {
      key: '/v0/persona-v2-demo',
      icon: <RadarChartOutlined />,
      label: '方法论 V2',
    },
    {
      key: '/v0/external-data',
      icon: <DatabaseOutlined />,
      label: '外部数据源',
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={(value) => setCollapsed(value)}>
        <div style={{ height: 32, margin: 16, background: 'rgba(255, 255, 255, 0.2)', borderRadius: 6 }} />
        <Menu 
            theme="dark" 
            mode="inline" 
            selectedKeys={[location.pathname]} 
            items={items} 
            onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: 0, background: colorBgContainer }} />
        <Content style={{ margin: '16px' }}>
          <div
            style={{
              padding: 24,
              minHeight: 360,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
            }}
          >
            <Outlet />
          </div>
        </Content>
        <Footer style={{ textAlign: 'center' }}>
          Stock-Claw ©{getBeijingYear()} Created by Trae AI
        </Footer>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
