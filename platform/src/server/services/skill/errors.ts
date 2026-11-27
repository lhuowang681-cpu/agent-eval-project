import type { z } from 'zod';

export type SkillParseErrorCode =
  | 'SKILL_MD_NOT_FOUND'
  | 'FAILED_PARSE_SKILL_MD'
  | 'FAILED_READ_ZIP'
  | 'INVALID_ZIP_PACKAGE';

export class SkillParseError extends Error {
  readonly code: SkillParseErrorCode;
  cause?: Error;

  constructor(message: string, code: SkillParseErrorCode, cause?: Error) {
    super(message);
    this.name = 'SkillParseError';
    this.code = code;
    this.cause = cause;
  }
}

export class SkillManifestError extends Error {
  zodError?: z.ZodError;

  constructor(message: string, zodError?: z.ZodError) {
    super(message);
    this.name = 'SkillManifestError';
    this.zodError = zodError;
  }
}

export class SkillResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillResourceError';
  }
}

export class SkillImportError extends Error {
  code:
    | 'CONFLICT'
    | 'INVALID_URL'
    | 'NOT_FOUND'
    | 'DOWNLOAD_FAILED'
    | 'FILE_NOT_FOUND'
    | 'SECURITY_SCAN_FAILED'
    | 'SECURITY_SCAN_REJECTED';

  constructor(
    message: string,
    code:
      | 'CONFLICT'
      | 'INVALID_URL'
      | 'NOT_FOUND'
      | 'DOWNLOAD_FAILED'
      | 'FILE_NOT_FOUND'
      | 'SECURITY_SCAN_FAILED'
      | 'SECURITY_SCAN_REJECTED',
  ) {
    super(message);
    this.name = 'SkillImportError';
    this.code = code;
  }
}
