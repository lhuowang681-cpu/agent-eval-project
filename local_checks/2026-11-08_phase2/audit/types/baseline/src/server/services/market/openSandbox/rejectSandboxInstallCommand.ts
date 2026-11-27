/**
 * Cloud sandbox uses a fixed image — runtime package installs are not supported.
 * Reject install commands early with actionable errors so the agent does not retry.
 */

const PREINSTALLED_PYTHON_PACKAGES: Record<string, string> = {
  'defusedxml': 'defusedxml',
  'docx': 'python-docx (`import docx`)',
  'lxml': 'lxml',
  'markitdown': 'markitdown',
  'odfpy': 'odfpy',
  'openpyxl': 'openpyxl',
  'pandas': 'pandas',
  'pdf2image': 'pdf2image',
  'pdfplumber': 'pdfplumber',
  'pillow': 'Pillow (`from PIL import Image`)',
  'python-docx': 'python-docx (`import docx`)',
  'python-magic': 'python-magic',
  'python-pptx': 'python-pptx (`import pptx`)',
  'pypdf': 'pypdf',
  'pytesseract': 'pytesseract',
  'xlrd': 'xlrd',
};

/** Shell install invocations, including after && || ; */
const SHELL_INSTALL_PATTERN =
  /(?:^|[;&|]{1,2})\s*(?:sudo\s+)?(?:uv\s+(?:pip\s+)?(?:install|add)(?:\s+-\S+)*\s+|pip3?\s+install(?:\s+-\S+)*\s+|python3?\s+-m\s+pip\s+install(?:\s+-\S+)*\s+|npm\s+(?:i|install)(?:\s+-\S+)*\s+|pnpm\s+(?:i|install|add)(?:\s+-\S+)*\s+|yarn\s+(?:add|install)(?:\s+-\S+)*\s+|bun\s+(?:add|install)(?:\s+-\S+)*\s+|poetry\s+(?:add|install)\s+|conda\s+install\s+|apt(?:-get)?\s+install\s+|apk\s+add\s+|yum\s+install\s+|dnf\s+install\s+)/i;

const PYTHON_CODE_INSTALL_PATTERN =
  /\b(?:pip3?|uv)\s+(?:pip\s+)?install\b|subprocess\.(?:run|call|Popen)\([^)]*['"]pip|os\.system\(['"][^'"]*pip\s+install/;

export const SANDBOX_INSTALL_BLOCKED_CODE = 'DEPENDENCY_INSTALL_BLOCKED';

/**
 * Set `SANDBOX_ALLOW_DEPENDENCY_INSTALL=true` to skip install-command blocking (testing only).
 * Unset or `false` to restore default blocking.
 */
export const isSandboxDependencyInstallAllowed = (): boolean => {
  const value = process.env.SANDBOX_ALLOW_DEPENDENCY_INSTALL?.trim().toLowerCase();
  return value === 'true' || value === '1';
};

export interface SandboxInstallRejection {
  blocked: true;
  code: typeof SANDBOX_INSTALL_BLOCKED_CODE;
  message: string;
}

const buildInstallBlockedMessage = (requestedPackage?: string): string => {
  const normalized = requestedPackage?.toLowerCase().replaceAll(/^['"]|['"]$/g, '');
  const preinstalled = normalized ? PREINSTALLED_PYTHON_PACKAGES[normalized] : undefined;

  let message =
    'Dependency installation is not allowed in the cloud sandbox (fixed image). Do not retry pip, npm, uv, apt, or other package-manager install commands.';

  if (preinstalled) {
    message += ` "${requestedPackage}" is already pre-installed — use ${preinstalled} directly via executeCode or import in Python.`;
  } else if (normalized) {
    message += ` Requested package "${requestedPackage}" is not available for runtime install. Use only pre-installed packages (pandas, openpyxl, python-docx, pypdf, etc.) or tell the user the capability is unavailable.`;
  } else {
    message +=
      ' Use only pre-installed Python packages and CLI tools, or refactor the task without installing new dependencies.';
  }

  return message;
};

const extractRequestedPackage = (command: string): string | undefined => {
  const match = command.match(
    /(?:uv\s+(?:pip\s+)?install|pip3?\s+install|python3?\s+-m\s+pip\s+install|npm\s+(?:i|install)|pnpm\s+(?:add|i|install)|poetry\s+add|conda\s+install)\s+(?:-\S+\s+)*['"]?([@\w][\w@./-]*)/i,
  );

  return match?.[1];
};

export const detectSandboxInstallShellCommand = (
  command: string,
): SandboxInstallRejection | { blocked: false } => {
  if (isSandboxDependencyInstallAllowed()) {
    return { blocked: false };
  }

  const trimmed = command.trim();
  if (!trimmed || !SHELL_INSTALL_PATTERN.test(trimmed)) {
    return { blocked: false };
  }

  return {
    blocked: true,
    code: SANDBOX_INSTALL_BLOCKED_CODE,
    message: buildInstallBlockedMessage(extractRequestedPackage(trimmed)),
  };
};

export const detectSandboxInstallPythonCode = (
  code: string,
): SandboxInstallRejection | { blocked: false } => {
  if (isSandboxDependencyInstallAllowed()) {
    return { blocked: false };
  }

  const trimmed = code.trim();
  if (!trimmed || !PYTHON_CODE_INSTALL_PATTERN.test(trimmed)) {
    return { blocked: false };
  }

  return {
    blocked: true,
    code: SANDBOX_INSTALL_BLOCKED_CODE,
    message: buildInstallBlockedMessage(extractRequestedPackage(trimmed)),
  };
};
