export interface ModelTaskConfig {
  promptName: string;
  model?: string;
  temperature?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
}

interface ModelTasksConfigData {
  modelsTasks: ModelTaskConfig[];
}

let configCache: ModelTasksConfigData | null = null;

const loadConfig = async (): Promise<ModelTasksConfigData> => {
  if (!configCache) {
    try {
      configCache = (await import('../config/modelsTasks.yaml')).default as ModelTasksConfigData;
    } catch (error) {
      console.warn('[ModelTasksConfigService] Failed to load modelsTasks.yaml, using defaults:', error);
      configCache = { modelsTasks: [] };
    }
  }
  return configCache;
};

export const getTaskConfig = async (promptName: string): Promise<ModelTaskConfig | null> => {
  const config = await loadConfig();
  const taskConfig = config.modelsTasks?.find((task: ModelTaskConfig) => task.promptName === promptName);
  return taskConfig || null;
};

export const getModelOverride = async (promptName: string): Promise<string | undefined> => {
  const config = await getTaskConfig(promptName);
  return config?.model;
};

export const getLLMOptions = async (promptName: string): Promise<{
  temperature?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
}> => {
  const config = await getTaskConfig(promptName);
  if (!config) return {};
  
  const options: any = {};
  if (config.temperature !== undefined) options.temperature = config.temperature;
  if (config.frequency_penalty !== undefined) options.frequency_penalty = config.frequency_penalty;
  if (config.max_tokens !== undefined) options.max_tokens = config.max_tokens;
  if (config.top_p !== undefined) options.top_p = config.top_p;
  if (config.presence_penalty !== undefined) options.presence_penalty = config.presence_penalty;
  
  return options;
};

export const invalidateConfigCache = (): void => {
  configCache = null;
}; 