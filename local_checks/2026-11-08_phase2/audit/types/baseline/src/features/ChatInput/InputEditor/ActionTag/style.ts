import { createStaticStyles } from 'antd-style';

import { TAG_MARGIN_INLINE_END } from '../constants';

const tagBase = (outlineColor: string, borderRadius: string) => `
  cursor: default;
  user-select: none;
  display: inline-flex;
  margin-inline-end: ${TAG_MARGIN_INLINE_END}px;

  &.selected {
    border-radius: ${borderRadius};
    outline: 2px solid ${outlineColor};
  }
`;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  commandTag: css`
    ${tagBase('#722ED1', cssVar.borderRadius)}
  `,
  skillTag: css`
    ${tagBase(cssVar.colorPrimary, cssVar.borderRadius)}
  `,
  toolTag: css`
    ${tagBase(cssVar.colorWarning, cssVar.borderRadius)}
  `,
  actionTag: css`
    ${tagBase(cssVar.colorPrimary, cssVar.borderRadius)}
    gap: 4px;
    align-items: center;

    padding-block: 1px;
    padding-inline: 5px;
    border-radius: ${cssVar.borderRadius}px;

    font-size: 12px;
    line-height: 18px;
  `,
  actionTagLabel: css`
    overflow: hidden;
    max-width: 160px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
