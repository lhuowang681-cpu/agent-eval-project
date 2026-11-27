export const SKILL_IMPORT_MESSAGE_PREFIX = 'SKILL_IMPORT::';

type SkillImportTFunction = (
  key: string,
  options?: Record<string, string | number | undefined>,
) => string;

export const encodeSkillImportMessage = (
  code: string,
  params?: Record<string, string | number>,
): string => {
  if (!params || Object.keys(params).length === 0) {
    return `${SKILL_IMPORT_MESSAGE_PREFIX}${code}`;
  }

  return `${SKILL_IMPORT_MESSAGE_PREFIX}${code}::${JSON.stringify(params)}`;
};

export const decodeSkillImportMessage = (
  message: string,
): { code: string; params: Record<string, string> } | null => {
  if (!message.startsWith(SKILL_IMPORT_MESSAGE_PREFIX)) return null;

  const rest = message.slice(SKILL_IMPORT_MESSAGE_PREFIX.length);
  const sep = rest.indexOf('::');

  if (sep === -1) {
    return { code: rest, params: {} };
  }

  try {
    const params = JSON.parse(rest.slice(sep + 2)) as Record<string, string>;
    return { code: rest.slice(0, sep), params: params ?? {} };
  } catch {
    return { code: rest.slice(0, sep), params: {} };
  }
};

const LEGACY_PARSE_MESSAGE_CODES: Record<string, string> = {
  'Failed to parse SKILL.md': 'FAILED_PARSE_SKILL_MD',
  'Failed to parse ZIP package': 'INVALID_ZIP_PACKAGE',
  'SKILL.md not found in zip package': 'SKILL_MD_NOT_FOUND',
};

export const inferLegacySkillImportCode = (
  message: string,
): { code: string; params: Record<string, string> } | null => {
  const parseCode = LEGACY_PARSE_MESSAGE_CODES[message];
  if (parseCode) return { code: parseCode, params: {} };

  const invalidManifestPrefix = 'Invalid skill manifest: ';
  if (message.startsWith(invalidManifestPrefix)) {
    return {
      code: 'INVALID_MANIFEST',
      params: { detail: message.slice(invalidManifestPrefix.length) },
    };
  }

  const failedReadZipPrefix = 'Failed to read ZIP file: ';
  if (message.startsWith(failedReadZipPrefix)) {
    return {
      code: 'FAILED_READ_ZIP',
      params: { path: message.slice(failedReadZipPrefix.length) },
    };
  }

  const nameMatch = message.match(/^Skill with name "([^"]+)" already exists$/);
  if (nameMatch) return { code: 'CONFLICT_NAME', params: { name: nameMatch[1]! } };

  const identifierMatch = message.match(/^Skill with identifier "([^"]+)" already exists$/);
  if (identifierMatch) {
    return { code: 'CONFLICT_IDENTIFIER', params: { identifier: identifierMatch[1]! } };
  }

  if (message === 'Invalid URL format') return { code: 'INVALID_URL', params: {} };

  if (message.startsWith('Resource not found')) {
    return { code: 'NOT_FOUND', params: { detail: message } };
  }

  if (message.startsWith('Failed to fetch URL') || message.startsWith('Failed to process URL')) {
    return { code: 'DOWNLOAD_FAILED', params: { detail: message } };
  }

  if (message.startsWith('Failed to download GitHub')) {
    return { code: 'DOWNLOAD_FAILED', params: { detail: message } };
  }

  return null;
};

export const mapSkillImportErrorCode = (error: { code: string; message: string }): string => {
  if (error.code === 'CONFLICT') {
    return error.message.includes('identifier') ? 'CONFLICT_IDENTIFIER' : 'CONFLICT_NAME';
  }

  return error.code;
};

export const skillImportErrorToPayload = (error: {
  code: string;
  message: string;
}): Record<string, string> => {
  switch (error.code) {
    case 'CONFLICT': {
      const nameMatch = error.message.match(/name "([^"]+)"/);
      if (nameMatch) return { name: nameMatch[1]! };

      const identifierMatch = error.message.match(/identifier "([^"]+)"/);
      if (identifierMatch) return { identifier: identifierMatch[1]! };

      return {};
    }
    case 'FILE_NOT_FOUND': {
      return {};
    }
    case 'INVALID_URL': {
      return {};
    }
    case 'NOT_FOUND':
    case 'DOWNLOAD_FAILED':
    case 'SECURITY_SCAN_FAILED':
    case 'SECURITY_SCAN_REJECTED': {
      return { detail: error.message };
    }
    default: {
      return { detail: error.message };
    }
  }
};

export const formatSkillMdParseDetail = (cause: unknown): string | undefined => {
  if (!cause) return undefined;

  if (typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    const reason = typeof record.reason === 'string' ? record.reason : undefined;
    const mark = record.mark as { column?: number; line?: number } | undefined;

    if (mark && typeof mark.line === 'number') {
      const line = mark.line + 1;
      const column = typeof mark.column === 'number' ? mark.column + 1 : undefined;
      const location = column ? `line ${line}, column ${column}` : `line ${line}`;

      return reason ? `${location}: ${reason}` : location;
    }

    if (reason) return reason;
  }

  if (cause instanceof Error && cause.message) {
    return cause.message;
  }

  return undefined;
};

const FAILED_READ_ZIP_PREFIX = 'Failed to read ZIP file: ';
const FAILED_PARSE_SKILL_MD_PREFIX = 'Failed to parse SKILL.md: ';

export const parseErrorToPayload = (error: {
  cause?: unknown;
  code: string;
  message: string;
}): Record<string, string> => {
  if (error.code === 'FAILED_READ_ZIP') {
    return {
      path: error.message.startsWith(FAILED_READ_ZIP_PREFIX)
        ? error.message.slice(FAILED_READ_ZIP_PREFIX.length)
        : '',
    };
  }

  if (error.code === 'FAILED_PARSE_SKILL_MD') {
    const detail = error.message.startsWith(FAILED_PARSE_SKILL_MD_PREFIX)
      ? error.message.slice(FAILED_PARSE_SKILL_MD_PREFIX.length)
      : formatSkillMdParseDetail(error.cause);

    return detail ? { detail } : {};
  }

  return {};
};

const i18nKey = (code: string) => `agentSkillModal.import.errors.${code}`;

export const translateSkillImportMessage = (t: unknown, message: string): string => {
  const translate = t as SkillImportTFunction;
  const decoded = decodeSkillImportMessage(message) ?? inferLegacySkillImportCode(message);

  if (decoded) {
    if (decoded.code === 'FAILED_PARSE_SKILL_MD' && decoded.params.detail) {
      return translate(i18nKey('FAILED_PARSE_SKILL_MD_DETAIL'), {
        ...decoded.params,
        defaultValue: message,
      });
    }

    return translate(i18nKey(decoded.code), {
      ...decoded.params,
      defaultValue: message,
    });
  }

  return message;
};
