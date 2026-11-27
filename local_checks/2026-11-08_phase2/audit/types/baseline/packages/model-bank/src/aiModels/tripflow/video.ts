import {
  PRESET_VIDEO_ASPECT_RATIOS,
  type VideoModelParamsSchema,
} from '../../standard-parameters/video';
import { type AIVideoModelCard } from '../../types/aiModel';

export const veo31Params: VideoModelParamsSchema = {
  aspectRatio: {
    default: '16:9',
    enum: ['16:9', '9:16'],
  },
  // Veo accepts only 4 / 6 / 8 s; createVeoVideo.ts snaps any value to the nearest valid one
  duration: {
    default: 6,
    max: 8,
    min: 4,
    step: 2,
  },
  endImageUrl: {
    default: null,
    requiresImageUrl: true,
  },
  generateAudio: { default: true },
  imageUrl: { default: null },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: ['720p', '1080p'],
  },
  seed: { default: null },
};

export const seedance20Params: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  cameraFixed: { default: false },
  duration: { default: 5, max: 15, min: 4 },
  endImageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    requiresImageUrl: true,
    width: { max: 6000, min: 300 },
  },
  generateAudio: { default: true },
  imageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    // 暂时禁用1080p和2k
    // default: '1080p',
    // enum: [...PRESET_VIDEO_RESOLUTIONS, '2k'],
    default: '720p',
    enum: ['480p', '720p'],
  },
  seed: { default: null },
};

export const tripflowVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Veo 3.1 by Google generates high-fidelity 8-second videos at 720p or 1080p with native audio, supporting text-to-video, image-to-video (first frame, first+last frame).',
    displayName: 'Veo 3.1',
    enabled: false,
    id: 'veo-3.1-generate-001',
    organization: 'Google',
    parameters: veo31Params,
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            pricingParams: ['resolution', 'generateAudio'],
            prices: {
              '1080p_false': 0.2,
              '1080p_true': 0.4,
              '720p_false': 0.2,
              '720p_true': 0.4,
            },
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-07',
    type: 'video',
  },
  {
    description:
      'Seedance 2.0 by ByteDance supports text-to-video, image-to-video (first frame, first+last frame), richer multimodal references, and native audio synchronized with visuals, with up to ~2K output and longer clips.',
    displayName: 'Seedance 2.0',
    enabled: false,
    id: 'doubao-seedance-2-0',
    organization: 'ByteDance',
    parameters: seedance20Params,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            pricingParams: ['includesVideo'],
            prices: { false: 46, true: 28 },
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
];
