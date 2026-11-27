export interface CreateDocumentContentInput {
  content?: string;
  description?: string;
}

/**
 * Resolve notebook document body when the agent omits `content`.
 * Falls back to `description`, then an empty string.
 */
export const resolveCreateDocumentContent = (params: CreateDocumentContentInput): string => {
  const content = params.content?.trim();
  if (content) return content;

  const description = params.description?.trim();
  if (description) return description;

  return '';
};
