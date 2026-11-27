import { SKIP, visit } from 'unist-util-visit';

import { OPTIONS_TAG } from '@/const/plugin';

function rehypeLobeOptions() {
  return (tree: any) => {
    visit(tree, (node, index, parent) => {
      if (node.type === 'element' && node.tagName === 'p' && node.children.length > 0) {
        const firstChild = node.children[0];
        if (firstChild.type === 'raw' && firstChild.value.startsWith(`<${OPTIONS_TAG}`)) {
          // Join the inner content (the JSON array) into a single text node
          const newNode = {
            children: [
              {
                type: 'text',
                value: node.children
                  .slice(1, -1)
                  .map((child: any) => {
                    if (child.type === 'raw') {
                      return child.value;
                    } else if (child.type === 'text') {
                      return child.value;
                    } else if (child.type === 'element' && child.tagName === 'a') {
                      return child.children[0].value;
                    }
                    return '';
                  })
                  .join('')
                  .trim(),
              },
            ],
            properties: {},
            tagName: OPTIONS_TAG,
            type: 'element',
          };

          parent.children.splice(index, 1, newNode);
          return [SKIP, index];
        }
      }
      // Streaming opening tag without content yet
      else if (node.type === 'raw' && node.value.startsWith(`<${OPTIONS_TAG}`)) {
        const newNode = {
          children: [],
          properties: {},
          tagName: OPTIONS_TAG,
          type: 'element',
        };

        parent.children.splice(index, 1, newNode);
        return [SKIP, index];
      }
    });
  };
}

export default rehypeLobeOptions;
