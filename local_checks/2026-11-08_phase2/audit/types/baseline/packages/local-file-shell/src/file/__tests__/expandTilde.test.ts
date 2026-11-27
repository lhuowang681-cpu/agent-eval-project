import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { expandTilde } from '../expandTilde';

describe('expandTilde', () => {
  it('returns undefined for undefined input', () => {
    expect(expandTilde(undefined)).toBeUndefined();
  });

  it('returns empty string for empty input', () => {
    expect(expandTilde('')).toBe('');
  });

  it('expands a bare ~ to the home directory', () => {
    expect(expandTilde('~')).toBe(os.homedir());
  });

  it('expands ~/... to a home-joined path', () => {
    expect(expandTilde('~/foo/bar')).toBe(path.join(os.homedir(), 'foo/bar'));
  });

  it('expands ~\\... (windows-style separator)', () => {
    expect(expandTilde('~\\foo')).toBe(path.join(os.homedir(), 'foo'));
  });

  it('passes absolute paths through untouched', () => {
    expect(expandTilde('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('passes relative paths through untouched', () => {
    expect(expandTilde('foo/bar')).toBe('foo/bar');
  });

  it('does not touch a tilde that is not leading', () => {
    expect(expandTilde('/home/u/~foo')).toBe('/home/u/~foo');
    expect(expandTilde('a~b')).toBe('a~b');
  });
});
