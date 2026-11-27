'use client';

import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import { ActionMention } from '@/features/ChatInput/InputEditor/ActionTag/ActionMention';

import { type MarkdownElementProps } from '../type';

interface SkillNodeProps {
  label?: string;
  name?: string;
}

const Render = memo<MarkdownElementProps<SkillNodeProps>>(({ node, children }) => {
  const { label, name } = node?.properties || {};
  const displayLabel = label || name || (typeof children === 'string' ? children : undefined);
  if (!displayLabel) return null;
  return <ActionMention category="skill" label={displayLabel} />;
}, isEqual);

Render.displayName = 'SkillRender';

export default Render;
