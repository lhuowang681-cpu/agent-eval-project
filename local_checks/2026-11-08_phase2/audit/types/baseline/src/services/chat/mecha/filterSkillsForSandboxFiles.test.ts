import {
  DocxIdentifier,
  FileReadingIdentifier,
  PdfIdentifier,
  PptxIdentifier,
  XlsxIdentifier,
} from '@lobechat/builtin-skills';
import { describe, expect, it } from 'vitest';

import { filterSkillsForSandboxFiles } from './filterSkillsForSandboxFiles';

describe('filterSkillsForSandboxFiles', () => {
  const skills = [
    {
      description: 'Read sandbox uploads',
      identifier: FileReadingIdentifier,
      name: 'File Reading',
    },
    {
      description: 'Word documents',
      identifier: DocxIdentifier,
      name: 'DOCX',
    },
    {
      description: 'PDF files',
      identifier: PdfIdentifier,
      name: 'PDF',
    },
    {
      description: 'Presentations',
      identifier: PptxIdentifier,
      name: 'PPTX',
    },
    {
      description: 'Spreadsheets',
      identifier: XlsxIdentifier,
      name: 'XLSX',
    },
    {
      description: 'Artifacts',
      identifier: 'lobe-artifacts',
      name: 'Artifacts',
    },
  ];

  const sandboxOnlyIds = [
    FileReadingIdentifier,
    DocxIdentifier,
    PdfIdentifier,
    PptxIdentifier,
    XlsxIdentifier,
  ];

  it('keeps sandbox skills when messages have sandbox uploads', () => {
    const result = filterSkillsForSandboxFiles(skills, [
      {
        fileList: [
          {
            fileType: 'application/pdf',
            processingMode: 'sandbox',
            sandboxPath: '/mnt/user-data/uploads/f1_x.pdf',
            size: 50_000,
          },
        ],
      },
    ]);

    expect(result).toHaveLength(skills.length);
  });

  it('keeps sandbox skills for small non-media attachments', () => {
    const result = filterSkillsForSandboxFiles(skills, [
      {
        fileList: [
          {
            fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            size: 10_240,
          },
        ],
      },
    ]);

    expect(result).toHaveLength(skills.length);
  });

  it('removes sandbox-only skills when there are no sandbox uploads', () => {
    const result = filterSkillsForSandboxFiles(skills, [
      {
        fileList: [
          {
            content: 'inline',
            fileType: 'text/plain',
            processingMode: 'inline',
            size: 100,
          },
        ],
      },
    ]);

    expect(result.map((s) => s.identifier)).toEqual(['lobe-artifacts']);
    expect(result.some((s) => sandboxOnlyIds.includes(s.identifier))).toBe(false);
  });
});
