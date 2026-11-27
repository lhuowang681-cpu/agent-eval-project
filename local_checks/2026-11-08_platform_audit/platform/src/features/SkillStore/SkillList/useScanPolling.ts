import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatScanFailedMessage,
  formatScanRejectedMessage,
  isScanRiskLevelAllowed,
  normalizeScanReport,
  translateSkillImportError,
} from '@/features/SkillStore/SkillList/skillImportError';
import { agentSkillService } from '@/services/skill';

const POLL_INTERVAL_MS = 10_000;
const FRONTEND_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export interface ScanProgress {
  progress?: number;
  stageMessage?: string;
  status?: string;
}

interface UseScanPollingReturn {
  cancel: () => void;
  isScanning: boolean;
  scanProgress: ScanProgress | null;
}

/**
 * Starts polling GET /getScanStatus every 10s until the scan completes or fails.
 * Calls onDone when scan passes, onError when it fails or times out.
 *
 * Returns { isScanning, scanProgress, cancel }.
 */
export const useScanPolling = (
  scanId: string | null,
  onDone: () => void,
  onError: (message: string) => void,
): UseScanPollingReturn => {
  const { t } = useTranslation('setting');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    setIsScanning(false);
    setScanProgress(null);
  }, []);

  useEffect(() => {
    if (!scanId) return;

    cancelledRef.current = false;
    startedAtRef.current = Date.now();
    setIsScanning(true);
    setScanProgress(null);

    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelledRef.current) return;

      if (Date.now() - startedAtRef.current > FRONTEND_TIMEOUT_MS) {
        setIsScanning(false);
        onError(t('agentSkillModal.import.errors.SCAN_TIMEOUT'));
        return;
      }

      try {
        const status = await agentSkillService.getScanStatus({ scanId });

        if (cancelledRef.current) return;

        setScanProgress({
          progress: status.progress,
          stageMessage: status.stage_message,
          status: status.status,
        });

        if (status.status === 'completed') {
          setIsScanning(false);
          const { riskLevel } = normalizeScanReport(status);
          if (!isScanRiskLevelAllowed(riskLevel)) {
            onError(formatScanRejectedMessage(status, t));
          } else {
            onDone();
          }
          return;
        }

        if (status.status === 'failed' || status.status === 'cancelled') {
          setIsScanning(false);
          onError(formatScanFailedMessage(status, t));
          return;
        }
      } catch (err) {
        if (cancelledRef.current) return;
        setIsScanning(false);
        onError(translateSkillImportError(t, err));
        return;
      }

      timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();

    return () => {
      cancelledRef.current = true;
      clearTimeout(timeoutId);
    };
  }, [scanId, onDone, onError, t]);

  return { cancel, isScanning, scanProgress };
};
