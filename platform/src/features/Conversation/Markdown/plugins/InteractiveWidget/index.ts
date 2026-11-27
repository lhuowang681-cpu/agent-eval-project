import { type FC } from 'react';

import { INTERACTIVE_WIDGET_TAG } from '@/const/plugin';

import { type MarkdownElement, type MarkdownElementProps } from '../type';
import rehypePlugin from './rehypePlugin';
import Component from './Render';

const InteractiveWidgetElement: MarkdownElement = {
  Component: Component as unknown as FC<MarkdownElementProps>,
  rehypePlugin,
  scope: 'assistant',
  tag: INTERACTIVE_WIDGET_TAG,
};

export default InteractiveWidgetElement;
