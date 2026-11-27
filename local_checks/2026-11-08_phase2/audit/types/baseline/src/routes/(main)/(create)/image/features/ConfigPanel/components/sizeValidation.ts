/** Capability flag in `parameters.size.enum` (qconfig / model-bank), not an API size value */
export const CUSTOM_SIZE_OPTION = 'custom';

export const supportsCustomSizeFromEnum = (sizeEnum?: readonly string[] | null) =>
  Boolean(sizeEnum?.includes(CUSTOM_SIZE_OPTION));

export const getPresetSizeEnumValues = (sizeEnum?: readonly string[] | null) =>
  sizeEnum?.filter((value) => value !== CUSTOM_SIZE_OPTION) ?? [];

export const GPT_IMAGE_2_SIZE_LIMITS = {
  maxAspectRatio: 3,
  maxLongSide: 3840,
  maxPixels: 8_294_400,
  minPixels: 655_360,
  step: 16,
} as const;

export interface ImageSize {
  height: number;
  width: number;
}

export interface SizeValidationFailure {
  errorKey: string;
  isValid: false;
}

export interface SizeValidationSuccess {
  isValid: true;
  size: ImageSize;
  value: string;
}

export type SizeValidationResult = SizeValidationFailure | SizeValidationSuccess;

export const formatSizeValue = ({ height, width }: ImageSize) => `${width}x${height}`;

export const parseSizeValue = (value: string): ImageSize | null => {
  const match = value.match(/^(\d+)x(\d+)$/);
  if (!match) return null;

  const [, widthValue, heightValue] = match;
  const width = Number(widthValue);
  const height = Number(heightValue);

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { height, width };
};

export const validateGptImage2Size = (size: ImageSize): SizeValidationResult => {
  const { height, width } = size;

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { errorKey: 'config.size.custom.error.invalid', isValid: false };
  }

  if (width % GPT_IMAGE_2_SIZE_LIMITS.step !== 0 || height % GPT_IMAGE_2_SIZE_LIMITS.step !== 0) {
    return { errorKey: 'config.size.custom.error.multipleOf16', isValid: false };
  }

  if (Math.max(width, height) > GPT_IMAGE_2_SIZE_LIMITS.maxLongSide) {
    return { errorKey: 'config.size.custom.error.longSide', isValid: false };
  }

  const aspectRatio = Math.max(width, height) / Math.min(width, height);
  if (aspectRatio > GPT_IMAGE_2_SIZE_LIMITS.maxAspectRatio) {
    return { errorKey: 'config.size.custom.error.aspectRatio', isValid: false };
  }

  const pixels = width * height;
  if (pixels < GPT_IMAGE_2_SIZE_LIMITS.minPixels || pixels > GPT_IMAGE_2_SIZE_LIMITS.maxPixels) {
    return { errorKey: 'config.size.custom.error.pixels', isValid: false };
  }

  return { isValid: true, size, value: formatSizeValue(size) };
};
