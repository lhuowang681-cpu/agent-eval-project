import { type AiFullModelCard, type LobeDefaultAiModelListItem } from '../types/aiModel';
import { default as ada } from './ada/index';
import { default as tripflow } from './tripflow/index';
import { default as ztrip } from './ztrip';

type ModelsMap = Record<string, AiFullModelCard[]>;

const buildDefaultModelList = (map: ModelsMap): LobeDefaultAiModelListItem[] => {
  let models: LobeDefaultAiModelListItem[] = [];

  Object.entries(map).forEach(([provider, providerModels]) => {
    const newModels = providerModels.map((model) => ({
      ...model,
      abilities: model.abilities ?? {},
      enabled: model.enabled || false,
      providerId: provider,
      source: 'builtin',
    }));
    models = models.concat(newModels);
  });

  return models;
};

/** TripYoYo：内置全量模型列表含 ada、tripflow、ztrip（lobehub 参数等仍从 `model-bank/lobehub` 子路径导出） */
export const LOBE_DEFAULT_MODEL_LIST = buildDefaultModelList({
  ada,
  tripflow,
  ztrip,
});

export { default as ada } from './ada';
export { default as ai21 } from './ai21';
export { default as ai302 } from './ai302';
export { default as ai360 } from './ai360';
export { default as aihubmix } from './aihubmix';
export { default as akashchat } from './akashchat';
export { default as anthropic } from './anthropic';
export { default as azure } from './azure';
export { default as azureai } from './azureai';
export { default as baichuan } from './baichuan';
export { default as bedrock } from './bedrock';
export { default as bfl } from './bfl';
export { default as cerebras } from './cerebras';
export { default as cloudflare } from './cloudflare';
export { default as cohere } from './cohere';
export { default as cometapi } from './cometapi';
export { default as comfyui } from './comfyui';
export { default as deepseek } from './deepseek';
export { default as fal, fluxSchnellParamsSchema } from './fal';
export { default as fireworksai } from './fireworksai';
export { default as giteeai } from './giteeai';
export { default as github } from './github';
export { default as githubcopilot } from './githubCopilot';
export { default as google } from './google';
export { default as groq } from './groq';
export { default as higress } from './higress';
export { default as huggingface } from './huggingface';
export { default as hunyuan } from './hunyuan';
export { default as infiniai } from './infiniai';
export { default as internlm } from './internlm';
export { default as jina } from './jina';
export { default as lmstudio } from './lmstudio';
export { default as lobehub } from './lobehub/index';
export { default as longcat } from './longcat';
export { default as minimax } from './minimax';
export { default as mistral } from './mistral';
export { default as modelscope } from './modelscope';
export { default as moonshot } from './moonshot';
export { default as nebius } from './nebius';
export { default as newapi } from './newapi';
export { default as novita } from './novita';
export { default as nvidia } from './nvidia';
export { default as ollama } from './ollama';
export { default as ollamacloud } from './ollamacloud';
export { gptImage1ParamsSchema, default as openai, openaiChatModels } from './openai';
export { default as openrouter } from './openrouter';
export { default as perplexity } from './perplexity';
export { default as ppio } from './ppio';
export { default as qiniu } from './qiniu';
export { default as qwen } from './qwen';
export { default as replicate } from './replicate';
export { default as sambanova } from './sambanova';
export { default as search1api } from './search1api';
export { default as sensenova } from './sensenova';
export { default as siliconcloud } from './siliconcloud';
export { default as spark } from './spark';
export { default as stepfun } from './stepfun';
export { default as straico } from './straico';
export { default as taichu } from './taichu';
export { default as tencentcloud } from './tencentcloud';
export { default as togetherai } from './togetherai';
export { default as tripflow } from './tripflow/index';
export { default as upstage } from './upstage';
export { default as v0 } from './v0';
export { default as vercelaigateway } from './vercelaigateway';
export { default as vertexai } from './vertexai';
export { default as vllm } from './vllm';
export { default as volcengine } from './volcengine';
export { default as wenxin } from './wenxin';
export { default as xai } from './xai';
export { default as xiaomimimo } from './xiaomimimo';
export { default as xinference } from './xinference';
export { default as zenmux } from './zenmux';
export { default as zeroone } from './zeroone';
export { default as zhipu } from './zhipu';
export { default as ztrip } from './ztrip';
