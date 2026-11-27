import { SANDBOX_BUILTIN_SKILL_IDENTIFIERS } from '@lobechat/builtin-skills';
import type { SkillMeta } from '@lobechat/context-engine';
import { messagesHaveSandboxFiles } from '@lobechat/utils';

interface MessageWithFileList {
  fileList?: Array<{
    content?: string;
    fileType: string;
    processingMode?: 'inline' | 'sandbox';
    sandboxPath?: string;
    size: number;
  }>;
}

/**
 * Include sandbox-only builtin skills in <available_skills> only when the
 * conversation has sandbox uploads (File Reading, DOCX, PDF, PPTX, XLSX).
 */
export const filterSkillsForSandboxFiles = <T extends SkillMeta>(
  skills: T[],
  messages: MessageWithFileList[],
): T[] => {
  if (messagesHaveSandboxFiles(messages)) return skills;

  return skills.filter((skill) => !SANDBOX_BUILTIN_SKILL_IDENTIFIERS.has(skill.identifier));
};
