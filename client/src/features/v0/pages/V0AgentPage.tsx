import React, { useState } from 'react';
import { Alert, Button, Card, Input, List, Space, Tag, Typography } from 'antd';
import { getApiErrorMessage } from '../../../api';
import { queryV0Agent } from '../api';
import type { V0AgentQueryResult } from '../types';

const DEFAULT_PROMPTS = [
  '今天 Alpha 说了什么',
  'Alpha 提到的拓维信息现在怎么样',
  'Alpha 说的黄线偏弱现在成立吗',
];

const V0AgentPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<V0AgentQueryResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>();

  const handleSubmit = async (nextQuery?: string) => {
    const finalQuery = (nextQuery ?? query).trim();
    if (!finalQuery) {
      setErrorMessage('请输入一个具体问题');
      return;
    }

    setLoading(true);
    setErrorMessage(undefined);

    try {
      const data = await queryV0Agent(finalQuery);
      setResult(data);
      setQuery(finalQuery);
    } catch (error) {
      console.error(error);
      setErrorMessage(getApiErrorMessage(error, 'V0 Agent 查询失败'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card
      title="V0 Agent"
      extra={<Typography.Text type="secondary">单轮查询，规则优先</Typography.Text>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Input.TextArea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：今天 Alpha 说了什么"
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={loading}
        />
        <Space wrap>
          <Button type="primary" onClick={() => handleSubmit()} loading={loading}>
            查询
          </Button>
          {DEFAULT_PROMPTS.map((prompt) => (
            <Tag key={prompt} color="blue" style={{ cursor: 'pointer' }} onClick={() => handleSubmit(prompt)}>
              {prompt}
            </Tag>
          ))}
        </Space>

        {errorMessage ? <Alert type="error" showIcon message={errorMessage} /> : null}

        {result ? (
          <Card size="small" title="查询结果">
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="purple">{result.queryType}</Tag>
              <Tag>{`${result.references.length} 条引用`}</Tag>
            </Space>
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
              {result.answer}
            </Typography.Paragraph>
            <List
              header="关联消息"
              dataSource={result.references}
              locale={{ emptyText: '没有关联消息' }}
              renderItem={(reference) => (
                <List.Item>
                  <List.Item.Meta
                    title={`${reference.authorName} · ${reference.postedAt}`}
                    description={
                      <>
                        <Typography.Paragraph style={{ marginBottom: 6 }}>
                          {reference.rawContent}
                        </Typography.Paragraph>
                        <Space wrap>
                          {reference.mentions.map((mention) => (
                            <Tag key={`${reference.messageId}-${mention}`}>{mention}</Tag>
                          ))}
                        </Space>
                        <div style={{ marginTop: 8 }}>
                          {reference.marketSummaries.map((summary) => (
                            <Typography.Paragraph key={`${reference.messageId}-${summary}`} type="secondary">
                              {summary}
                            </Typography.Paragraph>
                          ))}
                        </div>
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        ) : (
          <Alert type="info" showIcon message="输入问题后，V0 Agent 会基于本地消息和行情快照返回单轮答案。" />
        )}
      </Space>
    </Card>
  );
};

export default V0AgentPage;
