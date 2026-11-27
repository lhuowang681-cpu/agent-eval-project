import { TRPCClientError } from '@trpc/client';

import { translateSkillImportMessage } from '@/helpers/skillImportMessage';

export type { ScanStatusResponse } from '@/helpers/skillScanReport';
export {
  formatScanFailedMessage,
  formatScanRejectedMessage,
  isScanRiskLevelAllowed,
  normalizeScanReport,
} from '@/helpers/skillScanReport';

export const getSkillImportErrorMessage = (err: unknown): string => {
  if (err instanceof TRPCClientError) {
    return err.message;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
};

export const translateSkillImportError = (t: unknown, err: unknown): string =>
  translateSkillImportMessage(t, getSkillImportErrorMessage(err));
