import { type FC } from 'react';

import type { MarkdownElement, MarkdownElementProps } from '../type';
import rehypePlugin, { INTERACTIVE_FORM_TAG } from './rehypePlugin';
import Render from './Render';

const InteractiveForm: MarkdownElement = {
  Component: Render as unknown as FC<MarkdownElementProps>,
  rehypePlugin,
  scope: 'assistant',
  tag: INTERACTIVE_FORM_TAG,
};

export default InteractiveForm;
