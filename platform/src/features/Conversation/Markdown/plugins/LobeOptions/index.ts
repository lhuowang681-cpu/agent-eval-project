import { type FC } from 'react';

import { OPTIONS_TAG } from '@/const/plugin';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import rehypePlugin from './rehypePlugin';
import Component from './Render';

const LobeOptionsElement: MarkdownElement = {
  Component: Component as unknown as FC<MarkdownElementProps>,
  rehypePlugin,
  scope: 'assistant',
  tag: OPTIONS_TAG,
};

export default LobeOptionsElement;
