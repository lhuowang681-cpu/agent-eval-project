import type { BuiltinSkill } from '@lobechat/types';

import {
  adaptSandboxOfficeSkillContent,
  parseFrontmatterDescription,
} from '../sandbox-skills/adaptSkillContent';
import { DocxIdentifier } from '../sandbox-skills/constants';
import { docxSkillAvatar } from '../sandbox-skills/icons';
import skillMarkdown from './SKILL.md';

const rawDescription =
  parseFrontmatterDescription(skillMarkdown) ??
  'Create, read, edit, or manipulate Word documents (.docx).';

export { DocxIdentifier };

export const DocxSkill: BuiltinSkill = {
  avatar: docxSkillAvatar,
  content: adaptSandboxOfficeSkillContent('docx', skillMarkdown),
  description: rawDescription,
  identifier: DocxIdentifier,
  name: 'DOCX',
  source: 'builtin',
};
