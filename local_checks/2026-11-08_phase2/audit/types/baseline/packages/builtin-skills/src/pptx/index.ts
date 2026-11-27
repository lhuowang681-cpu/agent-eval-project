import type { BuiltinSkill } from '@lobechat/types';

import {
  adaptSandboxOfficeSkillContent,
  parseFrontmatterDescription,
} from '../sandbox-skills/adaptSkillContent';
import { PptxIdentifier } from '../sandbox-skills/constants';
import { pptxSkillAvatar } from '../sandbox-skills/icons';
import { toResourceMeta } from '../tripyoyo/helpers';
import editing from './editing.md';
import pptxgenjs from './pptxgenjs.md';
import skillMarkdown from './SKILL.md';

const rawDescription =
  parseFrontmatterDescription(skillMarkdown) ??
  'Create, read, edit, or analyze PowerPoint presentations (.pptx).';

export { PptxIdentifier };

export const PptxSkill: BuiltinSkill = {
  avatar: pptxSkillAvatar,
  content: adaptSandboxOfficeSkillContent('pptx', skillMarkdown),
  description: rawDescription,
  identifier: PptxIdentifier,
  name: 'PPTX',
  resources: toResourceMeta({
    'editing.md': adaptSandboxOfficeSkillContent('pptx', editing),
    'pptxgenjs.md': pptxgenjs,
  }),
  source: 'builtin',
};
