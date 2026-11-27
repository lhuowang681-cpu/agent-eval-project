import type { BuiltinSkill } from '@lobechat/types';

import {
  adaptSandboxOfficeSkillContent,
  parseFrontmatterDescription,
} from '../sandbox-skills/adaptSkillContent';
import { PdfIdentifier } from '../sandbox-skills/constants';
import { pdfSkillAvatar } from '../sandbox-skills/icons';
import { toResourceMeta } from '../tripyoyo/helpers';
import forms from './forms.md';
import reference from './reference.md';
import skillMarkdown from './SKILL.md';

const rawDescription =
  parseFrontmatterDescription(skillMarkdown) ??
  'Read, create, merge, split, fill, and process PDF files.';

export { PdfIdentifier };

export const PdfSkill: BuiltinSkill = {
  avatar: pdfSkillAvatar,
  content: adaptSandboxOfficeSkillContent('pdf', skillMarkdown),
  description: rawDescription,
  identifier: PdfIdentifier,
  name: 'PDF',
  resources: toResourceMeta({
    'FORMS.md': adaptSandboxOfficeSkillContent('pdf', forms),
    'REFERENCE.md': adaptSandboxOfficeSkillContent('pdf', reference),
  }),
  source: 'builtin',
};
