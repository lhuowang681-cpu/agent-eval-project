import { type DraggablePanelProps } from '@lobehub/ui';
import { DraggablePanel } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, Suspense, useState } from 'react';

import Loading from '@/components/Loading/BrandTextLoading';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export interface Size {
  height?: string | number;
  width?: string | number;
}

interface RightPanelProps extends Omit<
  DraggablePanelProps,
  'placement' | 'size' | 'onSizeChange' | 'onExpandChange'
> {
  defaultWidth?: number | string;
  /** Controlled expand state. When provided, overrides the global right-panel state. */
  expand?: boolean;
  /** Controlled expand handler. Used together with `expand` for non-global panels (e.g. tasks). */
  onExpandChange?: (expand: boolean) => void;
  onSizeChange?: (size?: Size) => void;
}

const RightPanel = memo<RightPanelProps>(
  ({
    maxWidth = 600,
    minWidth = 300,
    children,
    defaultWidth = 360,
    onSizeChange,
    expand: expandProp,
    onExpandChange,
    ...rest
  }) => {
    const [showRightPanel, toggleRightPanel] = useGlobalStore((s) => [
      systemStatusSelectors.showRightPanel(s),
      s.toggleRightPanel,
    ]);

    const expand = expandProp ?? showRightPanel;
    const handleExpandChange = onExpandChange ?? ((next: boolean) => toggleRightPanel(next));

    const [width, setWidth] = useState<string | number>(defaultWidth);

    return (
      <DraggablePanel
        backgroundColor={cssVar.colorBgContainer}
        expand={expand}
        expandable={false}
        maxWidth={maxWidth}
        minWidth={minWidth}
        placement="right"
        size={{
          height: '100%',
          width,
        }}
        onExpandChange={(next) => handleExpandChange(next)}
        onSizeChange={(_, size) => {
          if (size?.width) {
            setWidth(size.width);
          }
          if (size) onSizeChange?.(size);
        }}
        {...rest}
      >
        <Suspense fallback={<Loading debugId={'RightPanel'} />}>{children}</Suspense>
      </DraggablePanel>
    );
  },
);

export default RightPanel;
