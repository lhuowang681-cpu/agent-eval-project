import { Flexbox, Icon, SliderWithInput } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FlowerIcon, TrainFrontTunnel } from 'lucide-react';
import { memo } from 'react';

interface TopPProps {
  disabled?: boolean;
  max?: number;
  min?: number;
  onChange?: (value: number) => void;
  step?: number;
  value?: number;
}

const TopP = memo<TopPProps>(({ value, onChange, disabled, max = 1, min = 0, step = 0.1 }) => {
  return (
    <Flexbox style={{ width: '100%' }}>
      <SliderWithInput
        changeOnWheel
        controls={false}
        disabled={disabled}
        max={max}
        min={min}
        size={'small'}
        step={step}
        style={{ height: 42 }}
        value={value}
        marks={{
          0: (
            <Icon
              icon={TrainFrontTunnel}
              size={'small'}
              style={{ color: cssVar.colorTextQuaternary }}
            />
          ),
          0.9: <div />,
          1: (
            <Icon icon={FlowerIcon} size={'small'} style={{ color: cssVar.colorTextQuaternary }} />
          ),
        }}
        styles={{
          input: {
            maxWidth: 43,
          },
        }}
        onChange={onChange}
      />
    </Flexbox>
  );
});
export default TopP;
