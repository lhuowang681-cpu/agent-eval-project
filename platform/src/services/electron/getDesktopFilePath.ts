export const getDesktopFilePath = (file: File): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  const path = window.electronAPI?.getPathForFile?.(file) || (file as { path?: string }).path;
  return path || undefined;
};
