export type McpRunner = 'docker' | 'node' | 'python' | 'unknown' | 'uv';

export interface McpRunnerInfo {
  command?: string;
  displayName: string;
  runner: McpRunner;
}

export interface McpRunnerGuide {
  descriptionKey: string;
  downloadUrl?: string;
  manualCommand?: string;
  titleKey: string;
}

const basename = (command?: string) => command?.split(/[\\/]/).pop()?.toLowerCase();

export const detectMcpRunner = (command?: string): McpRunnerInfo => {
  const name = basename(command);

  if (name === 'node' || name === 'npm' || name === 'npx') {
    return { command, displayName: 'Node.js', runner: 'node' };
  }

  if (name === 'uv' || name === 'uvx') {
    return { command, displayName: 'uv', runner: 'uv' };
  }

  if (name === 'python' || name === 'python3' || name === 'pip') {
    return { command, displayName: 'Python', runner: 'python' };
  }

  if (name === 'docker') {
    return { command, displayName: 'Docker', runner: 'docker' };
  }

  return { command, displayName: command || 'Command', runner: 'unknown' };
};

export const getMcpRunnerGuide = (runner: McpRunner): McpRunnerGuide => {
  switch (runner) {
    case 'node': {
      return {
        descriptionKey: 'mcpInstall.runnerGuide.node.description',
        downloadUrl: 'https://nodejs.org/',
        titleKey: 'mcpInstall.runnerGuide.node.title',
      };
    }
    case 'uv': {
      return {
        descriptionKey: 'mcpInstall.runnerGuide.uv.description',
        downloadUrl: 'https://docs.astral.sh/uv/getting-started/installation/',
        titleKey: 'mcpInstall.runnerGuide.uv.title',
      };
    }
    case 'python': {
      return {
        descriptionKey: 'mcpInstall.runnerGuide.python.description',
        downloadUrl: 'https://www.python.org/downloads/',
        titleKey: 'mcpInstall.runnerGuide.python.title',
      };
    }
    case 'docker': {
      return {
        descriptionKey: 'mcpInstall.runnerGuide.docker.description',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
        titleKey: 'mcpInstall.runnerGuide.docker.title',
      };
    }
    default: {
      return {
        descriptionKey: 'mcpInstall.runnerGuide.unknown.description',
        titleKey: 'mcpInstall.runnerGuide.unknown.title',
      };
    }
  }
};
