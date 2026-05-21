import React from 'react';
import { Button, Card, Form, Input, InputNumber, Select, Space, Switch } from 'antd';

interface ThreadConfigCardProps {
  threadUrl: string;
  threadTitle: string;
  ngaCookie: string;
  pollIntervalSeconds: number;
  enabled: boolean;
  pushEnabled: boolean;
  pushChannel: 'console' | 'feishu_bot';
  pushWebhookUrl: string;
  pushSecret: string;
  digestEnabled: boolean;
  digestCron: string;
  authorsText: string;
  saving: boolean;
  polling: boolean;
  disabled: boolean;
  pollDisabled: boolean;
  onThreadUrlChange: (value: string) => void;
  onThreadTitleChange: (value: string) => void;
  onNgaCookieChange: (value: string) => void;
  onPollIntervalChange: (value: number) => void;
  onEnabledChange: (value: boolean) => void;
  onPushEnabledChange: (value: boolean) => void;
  onPushChannelChange: (value: 'console' | 'feishu_bot') => void;
  onPushWebhookUrlChange: (value: string) => void;
  onPushSecretChange: (value: string) => void;
  onDigestEnabledChange: (value: boolean) => void;
  onDigestCronChange: (value: string) => void;
  onAuthorsTextChange: (value: string) => void;
  onSave: () => void;
  onPoll: () => void;
}

const ThreadConfigCard: React.FC<ThreadConfigCardProps> = ({
  threadUrl,
  threadTitle,
  ngaCookie,
  pollIntervalSeconds,
  enabled,
  pushEnabled,
  pushChannel,
  pushWebhookUrl,
  pushSecret,
  digestEnabled,
  digestCron,
  authorsText,
  saving,
  polling,
  disabled,
  pollDisabled,
  onThreadUrlChange,
  onThreadTitleChange,
  onNgaCookieChange,
  onPollIntervalChange,
  onEnabledChange,
  onPushEnabledChange,
  onPushChannelChange,
  onPushWebhookUrlChange,
  onPushSecretChange,
  onDigestEnabledChange,
  onDigestCronChange,
  onAuthorsTextChange,
  onSave,
  onPoll,
}) => {
  return (
    <Card title="V0 监听配置">
      <Form layout="vertical">
        <Form.Item label="帖子 URL">
          <Input
            disabled={disabled}
            value={threadUrl}
            onChange={(event) => onThreadUrlChange(event.target.value)}
            placeholder="输入 NGA 帖子地址"
          />
        </Form.Item>
        <Form.Item label="帖子标题">
          <Input
            disabled={disabled}
            value={threadTitle}
            onChange={(event) => onThreadTitleChange(event.target.value)}
            placeholder="可选，便于识别"
          />
        </Form.Item>
        <Form.Item label="NGA Cookie">
          <Input.Password
            disabled={disabled}
            value={ngaCookie}
            onChange={(event) => onNgaCookieChange(event.target.value)}
            placeholder="可选，粘贴已登录 NGA 的 Cookie"
          />
        </Form.Item>
        <Form.Item label="作者白名单">
          <Input.TextArea
            disabled={disabled}
            value={authorsText}
            onChange={(event) => onAuthorsTextChange(event.target.value)}
            placeholder="每行一个作者名，或用逗号分隔"
            autoSize={{ minRows: 4, maxRows: 8 }}
          />
        </Form.Item>
        <Form.Item label="抓取间隔（秒）">
          <InputNumber
            disabled={disabled}
            min={1}
            precision={0}
            value={pollIntervalSeconds}
            onChange={(value) => onPollIntervalChange(typeof value === 'number' ? value : 60)}
          />
        </Form.Item>
        <Form.Item label="启用轮询" valuePropName="checked">
          <Switch disabled={disabled} checked={enabled} onChange={onEnabledChange} />
        </Form.Item>
        <Form.Item label="启用推送" valuePropName="checked">
          <Switch disabled={disabled} checked={pushEnabled} onChange={onPushEnabledChange} />
        </Form.Item>
        <Form.Item label="推送渠道">
          <Select
            disabled={disabled}
            value={pushChannel}
            onChange={onPushChannelChange}
            options={[
              { label: 'Console', value: 'console' },
              { label: '飞书机器人', value: 'feishu_bot' },
            ]}
          />
        </Form.Item>
        <Form.Item label="飞书 Webhook URL">
          <Input
            disabled={disabled || pushChannel !== 'feishu_bot'}
            value={pushWebhookUrl}
            onChange={(event) => onPushWebhookUrlChange(event.target.value)}
            placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
          />
        </Form.Item>
        <Form.Item label="飞书 Secret">
          <Input.Password
            disabled={disabled || pushChannel !== 'feishu_bot'}
            value={pushSecret}
            onChange={(event) => onPushSecretChange(event.target.value)}
            placeholder="可选，机器人签名密钥"
          />
        </Form.Item>
        <Form.Item label="启用日报任务" valuePropName="checked">
          <Switch disabled={disabled} checked={digestEnabled} onChange={onDigestEnabledChange} />
        </Form.Item>
        <Form.Item label="日报 Cron">
          <Input
            disabled={disabled || !digestEnabled}
            value={digestCron}
            onChange={(event) => onDigestCronChange(event.target.value)}
            placeholder="例如 0 18 * * *"
          />
        </Form.Item>
        <Space>
          <Button type="primary" onClick={onSave} loading={saving} disabled={disabled}>
            保存配置
          </Button>
          <Button onClick={onPoll} loading={polling} disabled={pollDisabled}>
            手动抓取
          </Button>
        </Space>
      </Form>
    </Card>
  );
};

export default ThreadConfigCard;
