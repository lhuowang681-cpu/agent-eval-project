import type { IEditor } from '@lobehub/editor';
import { INSERT_FILE_COMMAND, INSERT_IMAGE_COMMAND } from '@lobehub/editor';
import type { SerializedEditorState } from 'lexical';

import { getFileIdForUrl } from './attachmentRegistry';

/**
 * Local fallback for `@lobehub/editor`'s `extractMediaFromEditorState`, which is
 * not available in the editor version pinned by this project. Walks the
 * serialized Lexical state tree and collects image/file node URLs.
 */
const extractMediaFromEditorState = (
  state: SerializedEditorState,
): { fileList: { url: string }[]; imageList: { url: string }[] } => {
  const imageList: { url: string }[] = [];
  const fileList: { url: string }[] = [];

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    const url: string | undefined = node.url || node.src;
    if (url) {
      const type = String(node.type || '');
      if (type.includes('image')) imageList.push({ url });
      else if (type.includes('file')) fileList.push({ url });
    }
    if (Array.isArray(node.children)) for (const child of node.children) visit(child);
  };

  visit((state as any)?.root);
  return { fileList, imageList };
};

/**
 * URLs that have no registered fileId (e.g. externally pasted image URLs)
 * are silently skipped.
 */
export const getAttachmentFileIdsFromJson = (json: unknown): string[] => {
  if (!json) return [];
  const { imageList, fileList } = extractMediaFromEditorState(json as SerializedEditorState);
  const seen = new Set<string>();
  for (const { url } of imageList) {
    const fileId = getFileIdForUrl(url);
    if (fileId) seen.add(fileId);
  }
  for (const { url } of fileList) {
    const fileId = getFileIdForUrl(url);
    if (fileId) seen.add(fileId);
  }
  return [...seen];
};

export const getAttachmentFileIdsFromEditor = (editor: IEditor | undefined): string[] => {
  if (!editor?.getLexicalEditor?.()) return [];
  return getAttachmentFileIdsFromJson(editor.getDocument?.('json'));
};

/**
 * Images → `INSERT_IMAGE_COMMAND`; everything else → `INSERT_FILE_COMMAND`.
 */
export const insertFilesIntoEditor = (editor: IEditor | undefined, files: File[]): void => {
  if (!editor || files.length === 0) return;
  const lexicalEditor = editor.getLexicalEditor?.();
  if (!lexicalEditor) return;
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      lexicalEditor.dispatchCommand(INSERT_IMAGE_COMMAND, { file });
    } else {
      lexicalEditor.dispatchCommand(INSERT_FILE_COMMAND, { file });
    }
  }
  // File picker / Upload dropdown steals focus; restore it so the cursor
  // remains visible and the user can keep typing.
  editor.focus?.();
};

export const pickAndInsertAttachments = (editor: IEditor | undefined, accept?: string): void => {
  if (!editor?.getLexicalEditor?.()) return;

  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  if (accept) input.accept = accept;

  input.addEventListener('change', () => {
    insertFilesIntoEditor(editor, Array.from(input.files ?? []));
  });

  input.click();
};
