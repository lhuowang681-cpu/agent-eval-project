import isEqual from 'fast-deep-equal';

export interface MarketInstallButtonState {
  disabled?: boolean;
  isCopy?: boolean;
  label: string;
  reason?: string;
  type: 'disabled' | 'install' | 'update';
  withWarning?: boolean;
}

interface MarketInstallLabels {
  delistWarning: string;
  install: string;
  update: string;
}

interface InstalledMarketItem {
  currentSnapshot: Record<string, unknown>;
  installedFromSnapshot?: Record<string, unknown> | null;
  marketIdentifier?: string | null;
}

export const computeMarketInstallButtonState = ({
  deletedAt,
  installed,
  labels,
}: {
  deletedAt?: Date | string | null;
  installed: InstalledMarketItem | null;
  labels: MarketInstallLabels;
}): MarketInstallButtonState => {
  if (deletedAt) {
    return {
      disabled: true,
      label: labels.install,
      reason: labels.delistWarning,
      type: 'disabled',
    };
  }

  if (!installed) {
    return { label: labels.install, type: 'install' };
  }

  const isModified = !isEqual(installed.currentSnapshot, installed.installedFromSnapshot || {});

  if (!isModified) {
    return { label: labels.update, type: 'update' };
  }

  if (installed.marketIdentifier) {
    return { isCopy: true, label: labels.install, type: 'install' };
  }

  return {
    label: labels.update,
    type: 'update',
    withWarning: true,
  };
};
