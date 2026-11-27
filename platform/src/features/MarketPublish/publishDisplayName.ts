export const normalizePublishDisplayName = (value: string) => value.trim();

export const isPublishDisplayNameChanged = (displayName: string, referenceName?: string | null) => {
  if (!referenceName) return true;
  return (
    normalizePublishDisplayName(displayName).toLowerCase() !== referenceName.trim().toLowerCase()
  );
};
