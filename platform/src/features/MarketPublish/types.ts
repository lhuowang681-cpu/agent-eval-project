export type PublishableResourceAction = 'publish' | 'relist';

export type PublishableResourceSource = 'local' | 'market-installed';

export interface PublishableResourceItem {
  action: PublishableResourceAction;
  id: string;
  /** Stable identifier (skill/mcp), optional for agents */
  identifier?: string;
  installedFromMarketIdentifier?: string | null;
  marketCategory?: string | null;
  marketIdentifier?: string;
  /** Original market listing name — fork publish must differ from this */
  marketSourceName?: string | null;
  /** Human-readable title shown in the list */
  name: string;
  requiresRename: boolean;
  source: PublishableResourceSource;
}

export type BatchPublishResourceType = 'agent' | 'skill' | 'mcp';

export interface PublishItemDraft {
  action: PublishableResourceAction;
  category?: string;
  displayName: string;
  id: string;
  installedFromMarket: boolean;
  marketIdentifier?: string;
  marketSourceName?: string | null;
  name: string;
  requiresRename: boolean;
  selected: boolean;
}
