import { createStaticStyles } from 'antd-style';

export const useStyles = createStaticStyles(({ css, cssVar }) => ({
  closeIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  wrapper: css`
    flex: 1;
    min-width: 0;
  `,
  dragHandle: css`
    flex: 1;
    align-self: stretch;
    min-width: 0;
  `,
  container: css`
    flex: 0 1 auto;

    min-width: 0;
    max-width: 100%;
    border-radius: 0;

    background: transparent;
  `,
  newTabButton: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 22px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    transition:
      background-color 0.15s ${cssVar.motionEaseInOut},
      color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  tab: css`
    cursor: default;
    user-select: none;

    position: relative;

    overflow: hidden;
    flex-shrink: 0;

    width: 180px;
    padding-block: 2px;
    padding-inline: 10px 2px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;

    background-color: transparent;

    transition: background-color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillTertiary};
    }

    & + &::before {
      content: '';

      position: absolute;
      inset-block-start: 50%;
      inset-inline-start: 0;
      transform: translateY(-50%);

      width: 1px;
      height: 16px;

      background-color: ${cssVar.colorBorderSecondary};

      transition: opacity 0.15s ${cssVar.motionEaseInOut};
    }

    &:hover::before,
    &[data-active='true']::before,
    &:hover + &::before,
    &[data-active='true'] + &::before {
      opacity: 0;
    }
  `,
  tabActive: css`
    background-color: ${cssVar.colorBgElevated};

    &:hover {
      background-color: ${cssVar.colorBgElevated};
    }

    html.desktop[data-theme='dark'] & {
      background-color: ${cssVar.colorFillSecondary};
      box-shadow: inset 0 0 0 1px ${cssVar.colorBorderSecondary};

      &:hover {
        background-color: ${cssVar.colorFillSecondary};
      }
    }
  `,
  tabDragging: css`
    cursor: grabbing;
    z-index: 1;
    background-color: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};

    &::before,
    & + &::before {
      opacity: 0;
    }
  `,
  tabIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  tabTitle: css`
    overflow: hidden;
    flex: 1;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
