import { describe, expect, it } from 'vitest';

import { getQualityLabelKey } from './qualityOptions';
import {
  CUSTOM_SIZE_OPTION,
  formatSizeValue,
  getPresetSizeEnumValues,
  parseSizeValue,
  supportsCustomSizeFromEnum,
  validateGptImage2Size,
} from './sizeValidation';

describe('image config panel helpers', () => {
  describe('supportsCustomSizeFromEnum', () => {
    it('should enable custom size when enum includes custom', () => {
      expect(supportsCustomSizeFromEnum(['auto', '1024x1024', 'custom'])).toBe(true);
      expect(supportsCustomSizeFromEnum(['auto', '1024x1024'])).toBe(false);
      expect(supportsCustomSizeFromEnum(undefined)).toBe(false);
    });
  });

  describe('getPresetSizeEnumValues', () => {
    it('should filter out the custom capability flag', () => {
      expect(getPresetSizeEnumValues(['auto', '1024x1024', 'custom'])).toEqual([
        'auto',
        '1024x1024',
      ]);
      expect(getPresetSizeEnumValues(['auto'])).toEqual(['auto']);
    });

    it('should treat custom as a reserved enum token', () => {
      expect(CUSTOM_SIZE_OPTION).toBe('custom');
    });
  });

  describe('getQualityLabelKey', () => {
    it('should map quality values to their i18n keys', () => {
      expect(getQualityLabelKey('auto')).toBe('config.quality.options.auto');
      expect(getQualityLabelKey('low')).toBe('config.quality.options.low');
      expect(getQualityLabelKey('medium')).toBe('config.quality.options.medium');
      expect(getQualityLabelKey('high')).toBe('config.quality.options.high');
      expect(getQualityLabelKey('hd')).toBe('config.quality.options.hd');
      expect(getQualityLabelKey('standard')).toBe('config.quality.options.standard');
    });
  });

  describe('parseSizeValue', () => {
    it('should parse valid size strings', () => {
      expect(parseSizeValue('1792x1024')).toEqual({ height: 1024, width: 1792 });
    });

    it('should reject invalid size strings', () => {
      expect(parseSizeValue('1792:1024')).toBeNull();
      expect(parseSizeValue('0x1024')).toBeNull();
      expect(parseSizeValue('1024x-1')).toBeNull();
    });
  });

  describe('formatSizeValue', () => {
    it('should format image dimensions as size values', () => {
      expect(formatSizeValue({ height: 1024, width: 1792 })).toBe('1792x1024');
    });
  });

  describe('validateGptImage2Size', () => {
    it('should accept dimensions at the minimum and maximum pixel boundaries', () => {
      expect(validateGptImage2Size({ height: 640, width: 1024 })).toMatchObject({
        isValid: true,
        value: '1024x640',
      });
      expect(validateGptImage2Size({ height: 2160, width: 3840 })).toMatchObject({
        isValid: true,
        value: '3840x2160',
      });
    });

    it('should require positive integer dimensions', () => {
      expect(validateGptImage2Size({ height: 1024, width: 0 })).toEqual({
        errorKey: 'config.size.custom.error.invalid',
        isValid: false,
      });
      expect(validateGptImage2Size({ height: 1024, width: 1024.5 })).toEqual({
        errorKey: 'config.size.custom.error.invalid',
        isValid: false,
      });
    });

    it('should require width and height to be multiples of 16', () => {
      expect(validateGptImage2Size({ height: 1024, width: 1025 })).toEqual({
        errorKey: 'config.size.custom.error.multipleOf16',
        isValid: false,
      });
    });

    it('should reject dimensions whose long side is greater than 3840', () => {
      expect(validateGptImage2Size({ height: 2160, width: 3856 })).toEqual({
        errorKey: 'config.size.custom.error.longSide',
        isValid: false,
      });
    });

    it('should reject aspect ratios greater than 3:1', () => {
      expect(validateGptImage2Size({ height: 1024, width: 3088 })).toEqual({
        errorKey: 'config.size.custom.error.aspectRatio',
        isValid: false,
      });
    });

    it('should reject dimensions outside the total pixel range', () => {
      expect(validateGptImage2Size({ height: 800, width: 800 })).toEqual({
        errorKey: 'config.size.custom.error.pixels',
        isValid: false,
      });
      expect(validateGptImage2Size({ height: 2176, width: 3840 })).toEqual({
        errorKey: 'config.size.custom.error.pixels',
        isValid: false,
      });
    });
  });
});
