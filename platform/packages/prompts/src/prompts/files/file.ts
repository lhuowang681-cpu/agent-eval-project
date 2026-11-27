import type { ChatFileItem } from '@lobechat/types';

const isSandboxFile = (item: ChatFileItem): boolean =>
  item.processingMode === 'sandbox' || (!item.content && !!item.sandboxPath);

const isLocalFile = (item: ChatFileItem): boolean =>
  item.processingMode === 'local' && !!item.localPath;

const sandboxFilePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const attrs = [
    `id="${item.id}"`,
    `name="${item.name}"`,
    `type="${item.fileType}"`,
    `size="${item.size}"`,
    `sandbox_path="${item.sandboxPath}"`,
    ...(addUrl ? [`url="${item.url}"`] : []),
  ].join(' ');

  return `<file ${attrs} mode="sandbox" />`;
};

const localFilePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const attrs = [
    `id="${item.id}"`,
    `name="${item.name}"`,
    `type="${item.fileType}"`,
    `size="${item.size}"`,
    `local_path="${item.localPath}"`,
    ...(addUrl ? [`url="${item.url}"`] : []),
  ].join(' ');

  return `<file ${attrs} mode="local" />`;
};

const inlineFilePrompt = (item: ChatFileItem, addUrl: boolean) => {
  const content = item.content || '';
  return addUrl
    ? `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}" url="${item.url}">${content}</file>`
    : `<file id="${item.id}" name="${item.name}" type="${item.fileType}" size="${item.size}">${content}</file>`;
};

const filePrompt = (item: ChatFileItem, addUrl: boolean) => {
  if (isLocalFile(item)) return localFilePrompt(item, addUrl);
  if (isSandboxFile(item)) return sandboxFilePrompt(item, addUrl);
  return inlineFilePrompt(item, addUrl);
};

const localUploadedFilesDocstring = (): string =>
  '<uploaded_files_docstring>Files available in the local execution environment. File content is NOT in your context — use local file tools or shell commands to read files at the listed local_path values.</uploaded_files_docstring>';

export const filePrompts = (fileList: ChatFileItem[], addUrl: boolean) => {
  if (fileList.length === 0) return '';

  const hasSandboxFiles = fileList.some(isSandboxFile);
  const hasLocalFiles = fileList.some(isLocalFile);

  if (hasLocalFiles) {
    const prompt = `<uploaded_files>
${localUploadedFilesDocstring()}
${fileList.map((item) => filePrompt(item, addUrl)).join('\n')}
</uploaded_files>`;

    return prompt.trim();
  }

  if (hasSandboxFiles) {
    const prompt = `<uploaded_files>
<uploaded_files_docstring>Files available in the sandbox. File content is NOT in your context — activate the "File Reading" skill (activateSkill), then use lobe-cloud-sandbox runCommand or executeCode to read files at the listed sandbox_path values. User uploads live under /mnt/user-data/uploads/; agent-generated files (including re-injected exports) live under /mnt/user-data/outputs/.</uploaded_files_docstring>
${fileList.map((item) => filePrompt(item, addUrl)).join('\n')}
</uploaded_files>`;

    return prompt.trim();
  }

  const prompt = `<files>
<files_docstring>here are user upload files you can refer to</files_docstring>
${fileList.map((item) => filePrompt(item, addUrl)).join('\n')}
</files>`;

  return prompt.trim();
};
