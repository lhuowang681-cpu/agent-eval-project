import { describe, expect, it } from 'vitest';

import { detectMcpRunner, getMcpRunnerGuide } from './mcpRunner';

describe('detectMcpRunner', () => {
  it.each([
    ['npx', 'node'],
    ['npm', 'node'],
    ['node', 'node'],
    ['uvx', 'uv'],
    ['uv', 'uv'],
    ['python', 'python'],
    ['python3', 'python'],
    ['pip', 'python'],
    ['docker', 'docker'],
    ['/usr/local/bin/npx', 'node'],
    ['custom-server', 'unknown'],
  ])('maps %s to %s runner', (command, runner) => {
    expect(detectMcpRunner(command).runner).toBe(runner);
  });
});

describe('getMcpRunnerGuide', () => {
  it.each([
    [
      'node',
      {
        descriptionKey: 'mcpInstall.runnerGuide.node.description',
        downloadUrl: 'https://nodejs.org/',
        titleKey: 'mcpInstall.runnerGuide.node.title',
      },
    ],
    [
      'uv',
      {
        descriptionKey: 'mcpInstall.runnerGuide.uv.description',
        downloadUrl: 'https://docs.astral.sh/uv/getting-started/installation/',
        titleKey: 'mcpInstall.runnerGuide.uv.title',
      },
    ],
    [
      'python',
      {
        descriptionKey: 'mcpInstall.runnerGuide.python.description',
        downloadUrl: 'https://www.python.org/downloads/',
        titleKey: 'mcpInstall.runnerGuide.python.title',
      },
    ],
    [
      'docker',
      {
        descriptionKey: 'mcpInstall.runnerGuide.docker.description',
        downloadUrl: 'https://www.docker.com/products/docker-desktop/',
        titleKey: 'mcpInstall.runnerGuide.docker.title',
      },
    ],
    [
      'unknown',
      {
        descriptionKey: 'mcpInstall.runnerGuide.unknown.description',
        titleKey: 'mcpInstall.runnerGuide.unknown.title',
      },
    ],
  ] as const)('returns guide metadata for %s', (runner, guide) => {
    expect(getMcpRunnerGuide(runner)).toEqual(guide);
  });
});
