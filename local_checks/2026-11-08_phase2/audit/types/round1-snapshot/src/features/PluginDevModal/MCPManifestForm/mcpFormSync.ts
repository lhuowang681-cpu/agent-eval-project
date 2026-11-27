import { type LobeToolCustomPlugin } from '@lobechat/types';
import { createNanoId } from '@lobechat/utils';

const IDENTIFIER_PATTERN = /^[\w-]+$/;

export const slugifyMcpIdentifier = (title: string): string | undefined => {
  const slug = title
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\w-]/g, '');

  if (!slug || !/^\w[\w-]*$/.test(slug)) return undefined;

  return slug;
};

export const generateMcpIdentifier = () => `mcp_${createNanoId(8)()}`;

export const buildMcpTitleFromIdentifier = (identifier: string) => ({
  manifest: {
    meta: {
      title: identifier,
    },
  },
});

export const ensureMcpCreateFormValues = (values: LobeToolCustomPlugin): LobeToolCustomPlugin => {
  const title = values.manifest?.meta?.title?.trim();
  let identifier = values.identifier?.trim();

  if (!identifier) {
    identifier = (title && slugifyMcpIdentifier(title)) || generateMcpIdentifier();
  }

  const nextTitle = title || identifier;

  return {
    ...values,
    identifier,
    manifest: {
      ...values.manifest,
      meta: {
        ...values.manifest?.meta,
        title: nextTitle,
      },
    },
  };
};

type McpConnectionConfig = Record<string, unknown>;

export const serializeMcpConnection = (mcp?: McpConnectionConfig | null): string | undefined => {
  if (!mcp) return undefined;

  const { args, auth, command, env, headers, type, url } = mcp;

  return JSON.stringify({ args, auth, command, env, headers, type, url });
};

export const hasMcpConnectionChanged = (
  initial: string | undefined,
  nextMcp?: McpConnectionConfig | null,
) => serializeMcpConnection(nextMcp) !== initial;
