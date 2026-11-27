const DEFAULT_ACTION_PANEL_MAX_HEIGHT = 500;
const AVAILABLE_ACTION_PANEL_HEIGHT = 'var(--available-height, 60dvh)';

export const getActionPanelMaxHeight = (
  maxHeight: number | string = DEFAULT_ACTION_PANEL_MAX_HEIGHT,
) => {
  const preferredMaxHeight = typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight;

  return `min(${preferredMaxHeight}, ${AVAILABLE_ACTION_PANEL_HEIGHT})`;
};
