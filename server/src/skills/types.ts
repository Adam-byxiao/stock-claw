export interface Skill {
  name: string;
  description: string;
  execute(params: any): Promise<any>;
}

export interface SkillResult {
  success: boolean;
  data?: any;
  error?: string;
}
