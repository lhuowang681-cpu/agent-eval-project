import type { BuiltinSkill } from '@lobechat/types';

import { ArtifactsSkill } from './artifacts';
// import { DocxSkill } from './docx';
import { FeishuCliSkill } from './feishu-cli';
// import { FileReadingSkill } from './file-reading';
import { InteractiveWidgetsSkill } from './interactive-widgets';
import { OpenCliSkill } from './opencli';
import { TripYoYoSkill } from './tripyoyo';
// import { PdfSkill } from './pdf';
// import { PptxSkill } from './pptx';
// import { XlsxSkill } from './xlsx';

export { ArtifactsIdentifier } from './artifacts';
export { DocxIdentifier } from './docx';
export { FeishuCliIdentifier } from './feishu-cli';
export { FileReadingIdentifier } from './file-reading';
export { InteractiveWidgetsIdentifier } from './interactive-widgets';
export { OpenCliIdentifier } from './opencli';
export { PdfIdentifier } from './pdf';
export { PptxIdentifier } from './pptx';
export { SANDBOX_BUILTIN_SKILL_IDENTIFIERS, SANDBOX_SKILLS_PUBLIC_ROOT } from './sandbox-skills';
export { TripYoYoIdentifier } from './tripyoyo';
export { XlsxIdentifier } from './xlsx';

export const builtinSkills: BuiltinSkill[] = [
  ArtifactsSkill,
  // FileReadingSkill,
  // DocxSkill,
  // PdfSkill,
  // PptxSkill,
  // XlsxSkill,
  FeishuCliSkill,
  OpenCliSkill,
  InteractiveWidgetsSkill,
  TripYoYoSkill,
  // FindSkillsSkill
];
