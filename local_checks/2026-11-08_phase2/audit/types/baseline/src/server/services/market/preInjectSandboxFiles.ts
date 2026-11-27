import { getSandboxStoragePath, shouldProcessFileInSandbox } from '@lobechat/utils';
import debug from 'debug';

import { type MessageModel } from '@/database/models/message';
import { type FileService } from '@/server/services/file';

import {
  collectSandboxFileIdsFromTopic,
  ensureTopicSandboxFiles,
} from './openSandbox/ensureTopicSandboxFiles';
import { type RunCommandFileInput, type SandboxToolClient } from './sandboxToolClient';

const log = debug('lobe-server:pre-inject-sandbox-files');

export interface PreInjectSandboxFilesParams {
  fileIds?: string[];
  fileService: FileService;
  messageModel?: MessageModel;
  sandboxClient?: SandboxToolClient;
  topicId: string;
}

export const resolveSandboxFileInputs = async (
  fileIds: string[],
  fileService: FileService,
): Promise<RunCommandFileInput[]> => {
  const files: RunCommandFileInput[] = [];

  for (const fileId of fileIds) {
    const file = await fileService.getFileRecord(fileId);
    if (!file || !shouldProcessFileInSandbox(file.fileType, file.size)) continue;

    files.push({
      destination: getSandboxStoragePath(fileId, file.name, file.url),
      source: file.url,
    });
  }

  return files;
};

/**
 * Resolve sandbox-eligible files from all user messages in a topic.
 */
export const resolveTopicSandboxFileInputs = async (
  topicId: string,
  fileService: FileService,
  messageModel: MessageModel,
): Promise<RunCommandFileInput[]> => {
  const fileIds = await collectSandboxFileIdsFromTopic(topicId, fileService, messageModel);
  return resolveSandboxFileInputs(fileIds, fileService);
};

export const hasSandboxEligibleFiles = async (
  fileIds: string[] | undefined,
  fileService: FileService,
): Promise<boolean> => {
  if (!fileIds?.length) return false;

  for (const fileId of fileIds) {
    const file = await fileService.getFileRecord(fileId);
    if (file && shouldProcessFileInSandbox(file.fileType, file.size)) {
      return true;
    }
  }

  return false;
};

/**
 * Pre-inject non-media uploaded files into the topic sandbox session before LLM execution.
 */
export async function preInjectSandboxFiles({
  fileIds,
  fileService,
  messageModel,
  topicId,
  sandboxClient,
}: PreInjectSandboxFilesParams): Promise<void> {
  if (!fileIds?.length && !messageModel) return;

  try {
    await ensureTopicSandboxFiles({
      fileIds,
      fileService,
      messageModel,
      sandboxClient,
      topicId,
    });
  } catch (error) {
    log('preInjectSandboxFiles failed for topicId=%s: %O', topicId, error);
  }
}
