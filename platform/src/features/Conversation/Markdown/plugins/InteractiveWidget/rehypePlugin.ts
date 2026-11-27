import { visit } from 'unist-util-visit';

import { INTERACTIVE_WIDGET_TAG } from '@/const/plugin';

const rehypePlugin = () => {
  return (tree: any) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'pre') return;

      const code = node.children?.[0];
      const className = code?.properties?.className;
      const language = Array.isArray(className)
        ? className.find((item) => String(item).startsWith('language-'))
        : undefined;

      if (code?.tagName !== 'code' || language !== `language-${INTERACTIVE_WIDGET_TAG}`) return;

      const content = code.children
        ?.map((child: any) => ('value' in child ? child.value : ''))
        .join('');

      node.tagName = INTERACTIVE_WIDGET_TAG;
      node.properties = {
        definition: content,
      };
      node.children = [];
    });
  };
};

export default rehypePlugin;
