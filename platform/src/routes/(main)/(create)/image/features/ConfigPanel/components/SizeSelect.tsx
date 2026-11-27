import { ActionIcon, Button, Flexbox, InputNumber, Text } from '@lobehub/ui';
import { Check, Plus, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

import Select from './Select';
import {
  CUSTOM_SIZE_OPTION,
  getPresetSizeEnumValues,
  GPT_IMAGE_2_SIZE_LIMITS,
  parseSizeValue,
  supportsCustomSizeFromEnum,
  validateGptImage2Size,
} from './sizeValidation';

const SizeSelect = memo(() => {
  const { t } = useTranslation('image');
  const { value, setValue, enumValues } = useGenerationConfigParam<'size', string>('size');
  const supportsCustomSize = supportsCustomSizeFromEnum(enumValues);
  const [isEditing, setIsEditing] = useState(false);
  const [customWidth, setCustomWidth] = useState<number | null>(null);
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const presetValues = useMemo(() => getPresetSizeEnumValues(enumValues), [enumValues]);
  const isCustomValue =
    supportsCustomSize &&
    Boolean(value && value !== CUSTOM_SIZE_OPTION && !presetValues.includes(value));

  useEffect(() => {
    if (!supportsCustomSize) {
      setIsEditing(false);
      setErrorKey(null);
    }
  }, [supportsCustomSize]);

  const options = useMemo(() => {
    const items = presetValues.map((size) => ({
      label: size,
      value: size,
    }));

    if (isCustomValue && value) {
      items.push({
        label: value,
        value,
      });
    }

    return items;
  }, [isCustomValue, presetValues, value]);

  const startEditing = useCallback(() => {
    const parsedSize = value ? parseSizeValue(value) : null;
    setCustomWidth(parsedSize?.width ?? 1024);
    setCustomHeight(parsedSize?.height ?? 1024);
    setErrorKey(null);
    setIsEditing(true);
  }, [value]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setErrorKey(null);
  }, []);

  const confirmCustomSize = useCallback(() => {
    if (customWidth === null || customHeight === null) {
      setErrorKey('config.size.custom.error.invalid');
      return;
    }

    const result = validateGptImage2Size({ height: customHeight, width: customWidth });
    if (!result.isValid) {
      setErrorKey(result.errorKey);
      return;
    }

    setValue(result.value);
    setIsEditing(false);
    setErrorKey(null);
  }, [customHeight, customWidth, setValue]);

  const handleSelectChange = useCallback(
    (size: string) => {
      if (isCustomValue && size === value) {
        startEditing();
        return;
      }

      setValue(size);
    },
    [isCustomValue, setValue, startEditing, value],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        confirmCustomSize();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditing();
      }
    },
    [cancelEditing, confirmCustomSize],
  );

  if (!supportsCustomSize) {
    const presetOptions = presetValues.map((size) => ({
      label: size,
      value: size,
    }));

    return <Select options={presetOptions} value={value} onChange={setValue} />;
  }

  if (isEditing) {
    return (
      <Flexbox gap={6} width={'100%'}>
        <Flexbox horizontal align={'center'} gap={8} width={'100%'}>
          <InputNumber
            max={GPT_IMAGE_2_SIZE_LIMITS.maxLongSide}
            min={GPT_IMAGE_2_SIZE_LIMITS.step}
            placeholder={t('config.width.label')}
            size="small"
            step={GPT_IMAGE_2_SIZE_LIMITS.step}
            style={{ flex: 1 }}
            value={customWidth}
            onKeyDown={handleKeyDown}
            onChange={(inputValue) => {
              setCustomWidth(inputValue === null ? null : Number(inputValue));
              setErrorKey(null);
            }}
          />
          <Text type="secondary">x</Text>
          <InputNumber
            max={GPT_IMAGE_2_SIZE_LIMITS.maxLongSide}
            min={GPT_IMAGE_2_SIZE_LIMITS.step}
            placeholder={t('config.height.label')}
            size="small"
            step={GPT_IMAGE_2_SIZE_LIMITS.step}
            style={{ flex: 1 }}
            value={customHeight}
            onKeyDown={handleKeyDown}
            onChange={(inputValue) => {
              setCustomHeight(inputValue === null ? null : Number(inputValue));
              setErrorKey(null);
            }}
          />
          <ActionIcon icon={Check} size="small" variant="filled" onClick={confirmCustomSize} />
          <ActionIcon icon={X} size="small" variant="filled" onClick={cancelEditing} />
        </Flexbox>
        {errorKey && (
          <Text fontSize={12} type="danger">
            {t(errorKey, errorKey, {
              maxLongSide: GPT_IMAGE_2_SIZE_LIMITS.maxLongSide,
              maxPixels: GPT_IMAGE_2_SIZE_LIMITS.maxPixels.toLocaleString(),
              maxRatio: `${GPT_IMAGE_2_SIZE_LIMITS.maxAspectRatio}:1`,
              minPixels: GPT_IMAGE_2_SIZE_LIMITS.minPixels.toLocaleString(),
              step: GPT_IMAGE_2_SIZE_LIMITS.step,
            })}
          </Text>
        )}
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={8} width={'100%'}>
      <Select options={options} value={value} onChange={handleSelectChange} />
      <Button block icon={Plus} size="small" variant="filled" onClick={startEditing}>
        {t('config.size.custom.action')}
      </Button>
    </Flexbox>
  );
});

export default SizeSelect;
