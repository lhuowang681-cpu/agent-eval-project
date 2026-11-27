import { describe, expect, it, vi } from 'vitest';

import { communityApiService } from '@/services/marketApi';

import { classifyShareError, resolveInstaller } from './ShareInstallPage';

describe('resolveInstaller', () => {
  it('skill → installSkill', () => {
    const spy = vi.spyOn(communityApiService, 'installSkill').mockResolvedValue(undefined as never);
    resolveInstaller('skill', 'skl_1')();
    expect(spy).toHaveBeenCalledWith('skl_1');
  });

  it('mcp → installMcp', () => {
    const spy = vi.spyOn(communityApiService, 'installMcp').mockResolvedValue(undefined as never);
    resolveInstaller('mcp', 'mcp_1')();
    expect(spy).toHaveBeenCalledWith('mcp_1');
  });

  it('agent → installAgent', () => {
    const spy = vi.spyOn(communityApiService, 'installAgent').mockResolvedValue(undefined as never);
    resolveInstaller('agent', 'agt_1')();
    expect(spy).toHaveBeenCalledWith('agt_1');
  });
});

describe('classifyShareError', () => {
  const trpcError = (code: string) => ({ data: { code } });

  it('CONFLICT → expired', () => {
    expect(classifyShareError(trpcError('CONFLICT'))).toBe('expired');
  });

  it('NOT_FOUND → notFound', () => {
    expect(classifyShareError(trpcError('NOT_FOUND'))).toBe('notFound');
  });

  it('UNAUTHORIZED → unauthorized', () => {
    expect(classifyShareError(trpcError('UNAUTHORIZED'))).toBe('unauthorized');
  });

  it('INTERNAL_SERVER_ERROR → error', () => {
    expect(classifyShareError(trpcError('INTERNAL_SERVER_ERROR'))).toBe('error');
  });

  it('plain Error → error', () => {
    expect(classifyShareError(new Error('network'))).toBe('error');
  });

  it('undefined → error', () => {
    expect(classifyShareError(undefined)).toBe('error');
  });

  it('null → error', () => {
    expect(classifyShareError(null)).toBe('error');
  });
});
