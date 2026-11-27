import { isChunkingUnsupported } from './isChunkingUnsupported';

/**
 * Plain-text read strategy hint for File Reading skill only (cat vs head/tail/grep).
 * NOT used to decide sandbox injection — all non-media attachments go to sandbox.
 */
export const SANDBOX_FILE_SIZE_THRESHOLD = 20 * 1024;

export const SANDBOX_UPLOADS_DIR = '/mnt/user-data/uploads';
export const SANDBOX_OUTPUTS_DIR = '/mnt/user-data/outputs';
export const AGENT_SANDBOX_EXPORT_URL_PREFIX = 'code-interpreter-exports/';

export const isMediaFileType = (fileType: string): boolean => isChunkingUnsupported(fileType);

/** Non-media attachments are sandbox-processed regardless of size. */
export const shouldProcessFileInSandbox = (fileType: string, _size?: number): boolean =>
  !isMediaFileType(fileType);

export const getSandboxUploadFilename = (fileId: string, filename: string): string => {
  const sanitized = filename.replaceAll(/[^\w.\-()+\u4E00-\u9FFF]/g, '_');
  return `${fileId}_${sanitized}`;
};

export const getSandboxUploadPath = (fileId: string, filename: string): string =>
  `${SANDBOX_UPLOADS_DIR}/${getSandboxUploadFilename(fileId, filename)}`;

export const getSandboxOutputPath = (fileId: string, filename: string): string =>
  `${SANDBOX_OUTPUTS_DIR}/${getSandboxUploadFilename(fileId, filename)}`;

/** Agent exports uploaded to S3 under code-interpreter-exports/ */
export const isAgentGeneratedSandboxFile = (url: string): boolean =>
  url.startsWith(AGENT_SANDBOX_EXPORT_URL_PREFIX);

/** Resolve sandbox path by file origin: user uploads vs agent-generated exports. */
export const getSandboxStoragePath = (fileId: string, filename: string, url: string): string =>
  isAgentGeneratedSandboxFile(url)
    ? getSandboxOutputPath(fileId, filename)
    : getSandboxUploadPath(fileId, filename);

export const isSandboxChatFile = (file: {
  content?: string;
  fileType: string;
  processingMode?: 'inline' | 'sandbox';
  sandboxPath?: string;
  size: number;
}): boolean => file.processingMode === 'sandbox' || (!file.content && !!file.sandboxPath);

export interface SandboxTopicFileItem {
  content?: string;
  fileType: string;
  id: string;
  name: string;
  processingMode?: 'inline' | 'sandbox';
  sandboxPath?: string;
  size: number;
  url: string;
}

export const messagesHaveSandboxFiles = (
  messages: Array<{
    fileList?: Array<{
      content?: string;
      fileType: string;
      processingMode?: 'inline' | 'sandbox';
      sandboxPath?: string;
      size: number;
    }>;
  }>,
): boolean =>
  messages.some((message) =>
    message.fileList?.some(
      (file) => isSandboxChatFile(file) || shouldProcessFileInSandbox(file.fileType, file.size),
    ),
  );

/**
 * Attach topic-level sandbox files to the latest user message so follow-up turns
 * expose sandbox_path in <uploaded_files> even when the user did not re-upload.
 */
export const enrichMessagesWithTopicSandboxFiles = <
  T extends { fileList?: SandboxTopicFileItem[]; role?: string },
>(
  messages: T[],
  topicFiles: SandboxTopicFileItem[],
): T[] => {
  if (!topicFiles.length) return messages;

  let latestUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      latestUserIndex = i;
      break;
    }
  }

  if (latestUserIndex < 0) return messages;

  const latest = messages[latestUserIndex];
  const existingIds = new Set(latest.fileList?.map((file) => file.id) ?? []);
  const mergedFiles = [
    ...(latest.fileList ?? []),
    ...topicFiles.filter((file) => !existingIds.has(file.id)),
  ];

  if (mergedFiles.length === (latest.fileList?.length ?? 0)) return messages;

  return messages.map((message, index) =>
    index === latestUserIndex ? { ...message, fileList: mergedFiles } : message,
  );
};
