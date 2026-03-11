import React, { useState, useRef, useEffect } from 'react';
import { Input, Button, List, Tag, Spin, Avatar, Space } from 'antd';
import { SendOutlined, UserOutlined, RobotOutlined, LoadingOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatWithAgent } from '../api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'screener_result';
  data?: any[];
  isError?: boolean;
}

const AgentChat: React.FC = () => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '你好！我是智能投研助手。你可以问我：\n1. "最近一个月箱体震荡的股票"\n2. "连续下跌但换手率高的股票"\n3. "帮我找一些低市盈率的白酒股"' }
  ]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;
    
    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    
    try {
        const res = await chatWithAgent(userMsg.content);
        const aiMsg: Message = { 
            role: 'assistant', 
            content: res.reply,
            type: res.type,
            data: res.data
        };
        setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
        console.error("Chat error:", err);
        let errorMsg = '抱歉，服务暂时不可用，请稍后再试。';
        if (err.code === 'ECONNABORTED') {
            errorMsg = '请求超时，正在扫描大量股票，请稍后重试或缩小范围。';
        }
        setMessages(prev => [...prev, { role: 'assistant', content: errorMsg, isError: true }]);
    } finally {
        setLoading(false);
    }
  };

  return (
    <div style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', marginBottom: 16 }}>
            <List
                itemLayout="horizontal"
                dataSource={messages}
                renderItem={(item) => (
                    <List.Item style={{ border: 'none', padding: '8px 0' }}>
                        <List.Item.Meta
                            avatar={<Avatar icon={item.role === 'user' ? <UserOutlined /> : <RobotOutlined />} style={{ backgroundColor: item.role === 'user' ? '#1890ff' : '#52c41a' }} />}
                            title={item.role === 'user' ? '我' : 'StockClaw Agent'}
                            description={
                                <div style={{ 
                                    backgroundColor: item.role === 'user' ? '#e6f7ff' : (item.isError ? '#fff1f0' : '#f6ffed'), 
                                    padding: '8px 12px', 
                                    borderRadius: 8, 
                                    display: 'inline-block',
                                    maxWidth: item.role === 'user' ? '80%' : '100%',
                                    border: item.isError ? '1px solid #ffa39e' : 'none',
                                    width: item.role === 'assistant' ? '100%' : 'auto'
                                }}>
                                    <div className="markdown-body">
                                        {item.type === 'screener_result' ? (
                                            <ReactMarkdown 
                                                remarkPlugins={[remarkGfm]}
                                                components={{
                                                    table: ({node, ...props}) => <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 16 }} {...props} />,
                                                    th: ({node, ...props}) => <th style={{ border: '1px solid #ddd', padding: 8, background: '#f5f5f5' }} {...props} />,
                                                    td: ({node, ...props}) => <td style={{ border: '1px solid #ddd', padding: 8 }} {...props} />
                                                }}
                                            >
                                                {item.content}
                                            </ReactMarkdown>
                                        ) : (
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{item.content}</div>
                                        )}
                                    </div>
                                    
                                    {item.type === 'screener_result' && item.data && (
                                        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed #d9d9d9' }}>
                                            <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>原始筛选结果 ({item.data.length}):</div>
                                            {item.data.length > 0 ? (
                                                <Space wrap>
                                                    {item.data.map((stock: any) => (
                                                        <Tag color="blue" key={stock.code} style={{ cursor: 'pointer' }} onClick={() => window.open(`/stock/${stock.code}`, '_blank')}>
                                                            {stock.name} ({stock.code})
                                                            {stock.reason && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>{stock.reason}</span>}
                                                        </Tag>
                                                    ))}
                                                </Space>
                                            ) : (
                                                <Tag>未找到相关股票</Tag>
                                            )}
                                        </div>
                                    )}
                                </div>
                            }
                        />
                    </List.Item>
                )}
            />
            {loading && (
                <div style={{ padding: '8px 0', textAlign: 'center', color: '#999' }}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <div style={{ marginTop: 8 }}>AI 正在深度分析市场数据...</div>
                </div>
            )}
            <div ref={messagesEndRef} />
        </div>
        
        <div style={{ padding: '16px', backgroundColor: '#fff', borderTop: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex' }}>
                <Input.TextArea 
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onPressEnter={(e) => {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder="输入选股条件..."
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    style={{ marginRight: 8 }}
                    disabled={loading}
                />
                <Button type="primary" icon={<SendOutlined />} onClick={handleSend} loading={loading}>
                    发送
                </Button>
            </div>
        </div>
    </div>
  );
};

export default AgentChat;
