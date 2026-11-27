import { visit } from 'unist-util-visit';

export const INTERACTIVE_FORM_TAG = 'interactive-form';

const rehypePlugin = () => {
  return (tree: any) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'pre') return;

      const code = node.children?.[0];
      const className = code?.properties?.className;
      const language = Array.isArray(className)
        ? className.find((item) => String(item).startsWith('language-'))
        : undefined;

      if (code?.tagName !== 'code' || language !== 'language-interactive-form') return;

      const content = code.children
        ?.map((child: any) => ('value' in child ? child.value : ''))
        .join('');

      node.tagName = INTERACTIVE_FORM_TAG;
      node.properties = {
        definition: content,
      };
      node.children = [];
    });
  };
};

export default rehypePlugin;
