import { FileReadingIdentifier } from '../file-reading';

export const DocxIdentifier = 'lobe-docx';
export const PdfIdentifier = 'lobe-pdf';
export const PptxIdentifier = 'lobe-pptx';
export const XlsxIdentifier = 'lobe-xlsx';

export const SANDBOX_SKILLS_PUBLIC_ROOT = '/mnt/skills/public';

/** Builtin skills that require the cloud sandbox (scripts + deps live in the sandbox image). */
export const SANDBOX_BUILTIN_SKILL_IDENTIFIERS = new Set<string>([
  FileReadingIdentifier,
  DocxIdentifier,
  PdfIdentifier,
  PptxIdentifier,
  XlsxIdentifier,
]);

export type SandboxOfficeSkillId = 'docx' | 'pdf' | 'pptx' | 'xlsx';

export const sandboxSkillPublicPath = (skillId: SandboxOfficeSkillId): string =>
  `${SANDBOX_SKILLS_PUBLIC_ROOT}/${skillId}`;
