import type { BuiltinSkill } from '@lobechat/types';

import {
  adaptSandboxOfficeSkillContent,
  parseFrontmatterDescription,
} from '../sandbox-skills/adaptSkillContent';
import { XlsxIdentifier } from '../sandbox-skills/constants';
import { xlsxSkillAvatar } from '../sandbox-skills/icons';
import skillMarkdown from './SKILL.md';

const rawDescription =
  parseFrontmatterDescription(skillMarkdown) ??
  'Create, read, edit, and analyze spreadsheets (.xlsx, .xlsm, .csv).';

export { XlsxIdentifier };

export const XlsxSkill: BuiltinSkill = {
  avatar: xlsxSkillAvatar,
  content: adaptSandboxOfficeSkillContent('xlsx', skillMarkdown),
  description: rawDescription,
  identifier: XlsxIdentifier,
  name: 'XLSX',
  source: 'builtin',
};
