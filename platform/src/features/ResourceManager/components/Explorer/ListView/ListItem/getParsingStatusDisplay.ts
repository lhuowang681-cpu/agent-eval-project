import { isNull } from 'es-toolkit/compat';

import { type AsyncTaskStatus } from '@/types/asyncTask';

/**
 * What to render in the resource list item's parsing-status slot.
 * - `none`: render nothing (folders, or plain note pages without vectorization)
 * - `chunkButton`: render the manual "chunk this file" trigger (file not chunked yet)
 * - `statusBadge`: render the chunking/embedding status badge
 */
export type ParsingStatusDisplay = 'none' | 'chunkButton' | 'statusBadge';

interface GetParsingStatusDisplayParams {
  chunkingStatus?: AsyncTaskStatus | null;
  isCreatingFileParseTask: boolean;
  isFolder: boolean;
  isPage: boolean;
}

/**
 * Decide what the resource list item shows in its parsing-status slot.
 *
 * Page-type documents (fileType `custom/document`) cover two very different cases:
 * - plain hand-written notes, which have no vectorization and should show nothing;
 * - imported documents (e.g. Feishu wiki) that ARE chunked + embedded and should
 *   surface their status so users can see success/failure and retry.
 *
 * We distinguish them by whether the item actually carries a chunking status.
 */
export const getParsingStatusDisplay = ({
  chunkingStatus,
  isCreatingFileParseTask,
  isFolder,
  isPage,
}: GetParsingStatusDisplayParams): ParsingStatusDisplay => {
  if (isFolder) return 'none';

  const hasParsingStatus = !isNull(chunkingStatus) && !!chunkingStatus;

  // Plain note pages (no vectorization) show nothing; imported page documents
  // that were chunked/embedded fall through to the status badge below.
  if (isPage && !hasParsingStatus) return 'none';

  if (isCreatingFileParseTask || !hasParsingStatus) return 'chunkButton';

  return 'statusBadge';
};
