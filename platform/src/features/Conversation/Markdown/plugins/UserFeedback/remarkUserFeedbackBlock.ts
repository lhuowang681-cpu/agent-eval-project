import { SKIP, visit } from 'unist-util-visit';

import { USER_FEEDBACK_TAG } from '@/const/plugin';

const OPEN_TAG = `<${USER_FEEDBACK_TAG}>`;
const CLOSE_TAG = `</${USER_FEEDBACK_TAG}>`;

export const remarkUserFeedbackBlock = () => (tree: any) => {
  visit(tree, 'paragraph', (paragraph: any, index, parent) => {
    if (!parent || index == null) return;
    if (!Array.isArray(paragraph.children)) return;

    const buffer = paragraph.children
      .map((child: any) => (typeof child.value === 'string' ? child.value : ''))
      .join('');

    const openIdx = buffer.indexOf(OPEN_TAG);
    if (openIdx === -1) return;
    const closeIdx = buffer.indexOf(CLOSE_TAG, openIdx + OPEN_TAG.length);
    if (closeIdx === -1) return;

    const inner = buffer.slice(openIdx + OPEN_TAG.length, closeIdx).trim();
    const before = buffer.slice(0, openIdx).trim();
    const after = buffer.slice(closeIdx + CLOSE_TAG.length).trim();

    const replacement: any[] = [];
    if (before) {
      replacement.push({
        children: [{ type: 'text', value: before }],
        type: 'paragraph',
      });
    }
    replacement.push({
      data: {
        hChildren: [{ type: 'text', value: inner }],
        hName: USER_FEEDBACK_TAG,
      },
      position: paragraph.position,
      type: `${USER_FEEDBACK_TAG}Block`,
    });
    if (after) {
      replacement.push({
        children: [{ type: 'text', value: after }],
        type: 'paragraph',
      });
    }

    parent.children.splice(index, 1, ...replacement);
    return [SKIP, index + replacement.length];
  });
};
