import OpenAI from 'openai';
import dotenv from 'dotenv';
import { SYSTEM_INTENT_PROMPT } from '../prompts/intent';

dotenv.config();

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
}

export interface UserIntent {
    type: 'screen' | 'chat';
    strategy?: 'continuous_rise' | 'continuous_fall' | 'box_oscillation' | 'limit_up' | 'low_pe';
    params?: any;
    reply?: string; // For chat type
}

export class LLMService {
  private client: OpenAI;
  private model: string;

  constructor(config?: LLMConfig) {
    const apiKey = config?.apiKey || process.env.LLM_API_KEY || 'dummy-key';
    const baseURL = config?.baseURL || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
    this.model = config?.model || process.env.LLM_MODEL || 'gpt-3.5-turbo';

    this.client = new OpenAI({ apiKey, baseURL });
  }

  async chat(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
      });
      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('LLM Chat Error:', error);
      return '抱歉，我暂时无法回答您的问题。';
    }
  }

  /**
   * Parse user natural language into structured screener intent
   */
  async parseIntent(userInput: string): Promise<UserIntent> {
    try {
        const content = await this.chat([
            { role: 'system', content: SYSTEM_INTENT_PROMPT },
            { role: 'user', content: userInput }
        ]);
        
        // Clean up markdown code blocks if present
        const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Intent parsing failed:', e);
        return { type: 'chat', reply: '抱歉，我没理解您的意思，请换个说法试试。' };
    }
  }
}
