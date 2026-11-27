import { type UIChatMessage } from '@lobechat/types';
import {
  enrichMessagesWithTopicSandboxFiles,
  getSandboxStoragePath,
  type SandboxTopicFileItem,
  shouldProcessFileInSandbox,
} from '@lobechat/utils';
import debug from 'debug';

import type { MessageModel } from '@/database/models/message';
import { type FileService } from '@/server/services/file';

import { resolveSandboxFileInputs } from '../preInjectSandboxFiles';
import {
  createSandboxClientFromEnv,
  type RunCommandFileInput,
  type SandboxToolClient,
} from '../sandboxToolClient';

const log = debug('lobe-server:ensure-topic-sandbox-files');

export interface EnsureTopicSandboxFilesParams {
  fileIds?: string[];
  fileService: FileService;
  messageModel?: MessageModel;
  sandboxClient?: SandboxToolClient;
  topicId: string;
}

export interface EnsureTopicSandboxFilesResult {
  files: RunCommandFileInput[];
  injectedCount: number;
  sessionReused: boolean;
}

interface TopicMessageWithPlugin {
  fileList?: Array<{ id: string }>;
  plugin?: { apiName?: string | null };
  pluginState?: { fileId?: string; success?: boolean } | null;
  role?: string;
}

const EXPORT_FILE_API_NAME = 'exportFile';

export const extractExportedFileId = (message: TopicMessageWithPlugin): string | undefined => {
  if (message.role !== 'tool' || message.plugin?.apiName !== EXPORT_FILE_API_NAME) {
    return undefined;
  }

  const fileId = message.pluginState?.fileId;
  if (!fileId || message.pluginState?.success === false) {
    return undefined;
  }

  return fileId;
};

/**
 * 收集 topic 内应注入沙箱的 fileId（去重）：
 * - user 消息附件
 * - exportFile 工具导出的持久化文件（沙箱过期后可从 S3 重新拉取）
 */
export const collectSandboxFileIdsFromTopic = async (
  topicId: string,
  fileService: FileService,
  messageModel: MessageModel,
): Promise<string[]> => {
  const messages = await messageModel.query({ topicId });
  const seen = new Set<string>();
  const fileIds: string[] = [];

  const addFileId = async (fileId: string) => {
    if (seen.has(fileId)) return;
    seen.add(fileId);

    const record = await fileService.getFileRecord(fileId);
    if (record && shouldProcessFileInSandbox(record.fileType, record.size)) {
      fileIds.push(fileId);
    }
  };

  for (const message of messages as TopicMessageWithPlugin[]) {
    if (message.role === 'user' && message.fileList?.length) {
      for (const file of message.fileList) {
        await addFileId(file.id);
      }
      continue;
    }

    const exportedFileId = extractExportedFileId(message);
    if (exportedFileId) {
      await addFileId(exportedFileId);
    }
  }

  return fileIds;
};

export const resolveTopicSandboxChatFileItems = async (
  fileIds: string[],
  fileService: FileService,
  options?: { postProcessUrl?: (path: string | null) => Promise<string> },
): Promise<SandboxTopicFileItem[]> => {
  const items: SandboxTopicFileItem[] = [];

  for (const fileId of fileIds) {
    const file = await fileService.getFileRecord(fileId);
    if (!file || !shouldProcessFileInSandbox(file.fileType, file.size)) continue;

    const url = options?.postProcessUrl ? await options.postProcessUrl(file.url) : file.url;

    items.push({
      fileType: file.fileType,
      id: fileId,
      name: file.name,
      processingMode: 'sandbox',
      sandboxPath: getSandboxStoragePath(fileId, file.name, file.url),
      size: file.size,
      url,
    });
  }

  return items;
};

/** 仅供 LLM 上下文使用：把 topic 沙箱文件挂到最新 user 消息，不写入 DB、不返回给客户端 UI。 */
export async function enrichMessagesWithTopicSandboxContext(
  messages: UIChatMessage[],
  topicId: string,
  fileService: FileService,
  messageModel: MessageModel,
): Promise<UIChatMessage[]> {
  const fileIds = await collectSandboxFileIdsFromTopic(topicId, fileService, messageModel);
  if (!fileIds.length) return messages;

  const topicFiles = await resolveTopicSandboxChatFileItems(fileIds, fileService, {
    postProcessUrl: (path) => fileService.getFullFileUrl(path),
  });

  return enrichMessagesWithTopicSandboxFiles(messages, topicFiles);
}

const mergeFileIds = (current: string[], extra: string[]): string[] => [
  ...new Set([...current, ...extra]),
];

export async function ensureTopicSandboxFiles({
  topicId,
  fileIds,
  fileService,
  messageModel,
  sandboxClient = createSandboxClientFromEnv(),
}: EnsureTopicSandboxFilesParams): Promise<EnsureTopicSandboxFilesResult> {
  let resolvedIds = fileIds ?? [];

  if (messageModel) {
    const topicIds = await collectSandboxFileIdsFromTopic(topicId, fileService, messageModel);
    resolvedIds = mergeFileIds(resolvedIds, topicIds);
  }

  if (!resolvedIds.length) {
    return { injectedCount: 0, sessionReused: false, files: [] };
  }

  const files = await resolveSandboxFileInputs(resolvedIds, fileService);
  if (!files.length) {
    return { injectedCount: 0, sessionReused: false, files: [] };
  }

  log(
    'Ensuring %d sandbox file(s) for topicId=%s: %O',
    files.length,
    topicId,
    files.map((f) => f.destination),
  );

  try {
    const result = await sandboxClient.ensureFilesInjected(topicId, files);
    log(
      'Ensure complete: injected=%d, sessionReused=%s',
      result.injectedCount,
      result.sessionReused,
    );

    return {
      files,
      injectedCount: result.injectedCount,
      sessionReused: result.sessionReused,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('S3 未配置')) {
      log('SANDBOX_S3_NOT_CONFIGURED for topicId=%s: %s', topicId, message);
    }
    throw error;
  }
}
