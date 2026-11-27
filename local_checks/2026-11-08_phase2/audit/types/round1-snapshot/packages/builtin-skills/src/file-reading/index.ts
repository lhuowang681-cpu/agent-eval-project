import { fileReadingSkillContent } from '@lobechat/prompts';
import { type BuiltinSkill } from '@lobechat/types';

import { fileReadingSkillAvatar } from '../sandbox-skills/icons';

export const FileReadingIdentifier = 'lobe-file-reading';

export const FileReadingSkill: BuiltinSkill = {
  avatar: fileReadingSkillAvatar,
  content: fileReadingSkillContent,
  description:
    'Read user-uploaded files from the sandbox at /mnt/user-data/uploads/. Use when attachments are in sandbox mode and file content is not in context.',
  identifier: FileReadingIdentifier,
  name: 'File Reading',
  source: 'builtin',
};
