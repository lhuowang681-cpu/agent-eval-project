import type { AIImageModelCard } from '../../types/aiModel';
import { nanoBananaProParameters } from './utils';

const gptImage2Parameters: AIImageModelCard['parameters'] = {
  imageUrls: {
    default: [],
  },
  prompt: { default: '' },
  quality: {
    default: 'auto',
    enum: ['auto', 'low', 'medium', 'high'],
  },
  size: {
    default: 'auto',
    enum: ['auto', '1024x1024', '1536x1024', '1024x1536', 'custom'],
  },
};

export const tripflowImageModels: AIImageModelCard[] = [
  {
    description:
      "Gemini 3 Pro Image (Nano Banana Pro) is Google's image generation model and also supports multimodal chat.",
    displayName: 'Nano Banana Pro',
    enabled: false,
    id: 'gemini-3-pro-image-preview',
    parameters: nanoBananaProParameters,
    pricing: {
      approximatePricePerImage: 0.134,
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-18',
    type: 'image',
  },
  {
    description:
      'GPT Image 2 is OpenAI’s latest image generation model with high-resolution generation and improved image editing.',
    displayName: 'GPT Image 2',
    enabled: false,
    id: 'gpt-image-2',
    parameters: gptImage2Parameters,
    pricing: {
      approximatePricePerImage: 0.1,
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-29',
    type: 'image',
  },
];
