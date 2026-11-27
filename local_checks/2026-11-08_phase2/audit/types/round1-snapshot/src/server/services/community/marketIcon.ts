export const DEFAULT_SKILL_MARKET_ICON = '🧩';
export const DEFAULT_MCP_MARKET_ICON = 'MCP_AVATAR';

interface MarketMcpMeta {
  avatar?: string;
  icon?: string;
}

interface MarketMcpManifest {
  meta?: MarketMcpMeta;
}

export const getExplicitSkillIcon = (
  manifest?: Record<string, unknown> | null,
): string | undefined => {
  const icon = manifest?.icon ?? manifest?.avatar;
  return typeof icon === 'string' && icon.trim() ? icon : undefined;
};

export const getExplicitMcpIcon = (manifest?: MarketMcpManifest | null): string | undefined => {
  const icon = manifest?.meta?.icon ?? manifest?.meta?.avatar;
  return typeof icon === 'string' && icon.trim() ? icon : undefined;
};

export const resolveSkillMarketIcon = (
  manifest: Record<string, unknown> | null | undefined,
  generatedIcon?: string,
): string => getExplicitSkillIcon(manifest) ?? generatedIcon ?? DEFAULT_SKILL_MARKET_ICON;

export const resolveMcpMarketIcon = (
  manifest: MarketMcpManifest | null | undefined,
  generatedIcon?: string,
): string => getExplicitMcpIcon(manifest) ?? generatedIcon ?? DEFAULT_MCP_MARKET_ICON;
