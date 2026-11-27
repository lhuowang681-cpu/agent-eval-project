import { describe, expect, it } from 'vitest';

import { INTERACTIVE_WIDGET_TAG } from '@/const/plugin';

import rehypePlugin from './rehypePlugin';

const run = (tree: any) => rehypePlugin()(tree);

const codeBlock = (language: string, value: string) => ({
  type: 'root',
  children: [
    {
      type: 'element',
      tagName: 'pre',
      children: [
        {
          type: 'element',
          tagName: 'code',
          properties: { className: [`language-${language}`] },
          children: [{ type: 'text', value }],
        },
      ],
    },
  ],
});

describe('rehypePlugin (InteractiveWidget)', () => {
  it('converts a `language-interactive-widget` fenced code block into the widget element', () => {
    const json = '{"version":1,"kind":"options","id":"a","items":[{"title":"x"}]}';
    const tree = codeBlock('interactive-widget', json);

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe(INTERACTIVE_WIDGET_TAG);
    expect(node.properties).toEqual({ definition: json });
    expect(node.children).toEqual([]);
  });

  it('leaves other fenced code blocks untouched', () => {
    const tree = codeBlock('typescript', 'const a = 1;');

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe('pre');
  });

  it('leaves the legacy `interactive-form` fenced code block untouched', () => {
    const tree = codeBlock('interactive-form', '{"version":1,"id":"a","title":"t","fields":[]}');

    run(tree);

    const node = (tree as any).children[0];
    expect(node.tagName).toBe('pre');
  });
});
