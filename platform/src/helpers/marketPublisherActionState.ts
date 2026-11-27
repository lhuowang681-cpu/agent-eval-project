export type MarketPublisherAction = 'publish' | 'update' | 'relist';

export interface MarketPublisherStateInput {
  installedFromMarketIdentifier?: string | null;
  isPublishable?: boolean;
  marketDeletedAt?: Date | string | null;
  marketIdentifier?: string | null;
}

export interface MarketPublisherState {
  action: MarketPublisherAction;
  isDelisted: boolean;
  isPublished: boolean;
  labelKey: string;
  requiresForkRename: boolean;
  showPublishedTag: boolean;
}

const LABEL_KEYS = {
  publish: {
    agent: 'assistants.publishToMarketLabel',
    knowledgeBase: 'knowledgeBases.publishToMarketLabel',
    mcp: 'mcp.publishToMarketLabel',
    skill: 'skills.publishToMarketLabel',
  },
  relist: {
    agent: 'assistants.relist',
    knowledgeBase: 'knowledgeBases.relist',
    mcp: 'mcp.relist',
    skill: 'skills.relist',
  },
  update: {
    agent: 'assistants.updateToMarket',
    knowledgeBase: 'mcp.updateToMarket',
    mcp: 'mcp.updateToMarket',
    skill: 'skills.updateToMarket',
  },
} as const;

export type MarketPublisherResourceType = keyof typeof LABEL_KEYS.publish;

export const isPublishableMcpPlugin = (plugin?: {
  customParams?: Record<string, unknown> | null;
  type?: string | null;
}) => plugin?.type === 'customPlugin' || Boolean(plugin?.customParams?.mcp);

export const computeMarketPublisherActionState = (
  input: MarketPublisherStateInput,
  resourceType: MarketPublisherResourceType,
): MarketPublisherState => {
  const {
    marketIdentifier,
    installedFromMarketIdentifier,
    marketDeletedAt,
    isPublishable = true,
  } = input;

  if (!isPublishable) {
    return {
      action: 'publish',
      isDelisted: false,
      isPublished: false,
      labelKey: LABEL_KEYS.publish[resourceType],
      requiresForkRename: false,
      showPublishedTag: false,
    };
  }

  const isDelisted = Boolean(marketIdentifier && marketDeletedAt);
  const isPublished = Boolean(marketIdentifier && !marketDeletedAt);
  const requiresForkRename = Boolean(installedFromMarketIdentifier && !marketIdentifier);

  if (isDelisted) {
    return {
      action: 'relist',
      isDelisted: true,
      isPublished: false,
      labelKey: LABEL_KEYS.relist[resourceType],
      requiresForkRename: false,
      showPublishedTag: true,
    };
  }

  if (isPublished) {
    return {
      action: 'update',
      isDelisted: false,
      isPublished: true,
      labelKey: LABEL_KEYS.update[resourceType],
      requiresForkRename: false,
      showPublishedTag: true,
    };
  }

  return {
    action: 'publish',
    isDelisted: false,
    isPublished: false,
    labelKey: LABEL_KEYS.publish[resourceType],
    requiresForkRename,
    showPublishedTag: false,
  };
};
