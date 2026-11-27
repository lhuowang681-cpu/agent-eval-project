import { afterEach, describe, expect, it } from 'vitest';

import {
  detectSandboxInstallPythonCode,
  detectSandboxInstallShellCommand,
  SANDBOX_INSTALL_BLOCKED_CODE,
} from './rejectSandboxInstallCommand';

describe('detectSandboxInstallShellCommand', () => {
  afterEach(() => {
    delete process.env.SANDBOX_ALLOW_DEPENDENCY_INSTALL;
  });

  it('allows install commands when SANDBOX_ALLOW_DEPENDENCY_INSTALL=true', () => {
    process.env.SANDBOX_ALLOW_DEPENDENCY_INSTALL = 'true';

    expect(
      detectSandboxInstallShellCommand(
        'npm install lodash --registry=https://registry.npmmirror.com',
      ).blocked,
    ).toBe(false);
  });
  it('blocks uv pip install', () => {
    const result = detectSandboxInstallShellCommand('uv pip install python-docx');

    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.code).toBe(SANDBOX_INSTALL_BLOCKED_CODE);
      expect(result.message).toContain('python-docx');
      expect(result.message).toContain('pre-installed');
      expect(result.message).toContain('Do not retry');
    }
  });

  it('blocks pip install in compound commands', () => {
    const result = detectSandboxInstallShellCommand('cd /tmp && pip install pandas');

    expect(result.blocked).toBe(true);
  });

  it('allows normal shell commands', () => {
    expect(
      detectSandboxInstallShellCommand('extract-text /mnt/user-data/uploads/a.xlsx').blocked,
    ).toBe(false);
    expect(detectSandboxInstallShellCommand('python3 -c "import pandas"').blocked).toBe(false);
    expect(detectSandboxInstallShellCommand('grep pip install README.md').blocked).toBe(false);
  });
});

describe('detectSandboxInstallPythonCode', () => {
  it('blocks subprocess pip install in executeCode', () => {
    const code = `import subprocess\nsubprocess.run(["pip", "install", "numpy"])`;
    const result = detectSandboxInstallPythonCode(code);

    expect(result.blocked).toBe(true);
  });

  it('allows normal imports', () => {
    expect(
      detectSandboxInstallPythonCode('import pandas as pd\nprint(pd.__version__)').blocked,
    ).toBe(false);
  });
});
