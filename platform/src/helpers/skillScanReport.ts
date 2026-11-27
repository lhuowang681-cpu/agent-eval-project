export type ScanRiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical' | 'unknown';

export interface ScanReportData {
  findings?: unknown;
  recommendation?: unknown;
  risk_level?: unknown;
  score?: unknown;
  summary?: unknown;
}

export interface ScanStatusResponse {
  current_stage?: string;
  error_code?: string;
  error_message?: string;
  message?: string;
  progress?: number;
  recommendation?: unknown;
  report_data?: ScanReportData | string | null;
  risk_level?: unknown;
  scan_id?: string;
  score?: unknown;
  stage_message?: string;
  status?: string;
}

export interface NormalizedScanReport {
  findings?: unknown;
  recommendation?: string;
  riskLevel: ScanRiskLevel;
  score?: string;
}

export const ALLOWED_SCAN_RISK_LEVELS = new Set<string>(['none', 'low']);

const normalizeRiskLevel = (riskLevel: unknown): ScanRiskLevel => {
  if (typeof riskLevel !== 'string') return 'unknown';
  const normalized = riskLevel.toLowerCase();

  if (
    normalized === 'none' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'critical'
  ) {
    return normalized;
  }

  return 'unknown';
};

const normalizeText = (value: unknown) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
};

const safeParseJson = <T>(value: string): T | undefined => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

export const normalizeScanReport = (status: ScanStatusResponse): NormalizedScanReport => {
  const reportData =
    typeof status.report_data === 'string'
      ? safeParseJson<ScanReportData>(status.report_data)
      : status.report_data;

  const report = reportData && typeof reportData === 'object' ? reportData : {};
  const riskLevel = normalizeRiskLevel(report.risk_level ?? status.risk_level);

  return {
    findings: report.findings,
    recommendation: normalizeText(report.recommendation ?? status.recommendation),
    riskLevel,
    score: normalizeText(report.score ?? status.score),
  };
};

export const extractFirstScanFinding = (findings: unknown) => {
  const parsedFindings = typeof findings === 'string' ? safeParseJson<unknown>(findings) : findings;
  if (!Array.isArray(parsedFindings) || parsedFindings.length === 0) return;

  const first = parsedFindings[0];
  if (!first || typeof first !== 'object') return;

  const record = first as Record<string, unknown>;
  return normalizeText(record.description) || normalizeText(record.suggestion);
};

type ScanMessageTFunction = (
  key: string,
  options?: Record<string, string | number | undefined>,
) => string;

const resolveScanFailureDetail = (status: ScanStatusResponse) =>
  status.error_message ||
  status.stage_message ||
  status.message ||
  status.error_code ||
  status.status ||
  'unknown';

export const formatScanFailedMessage = (status: ScanStatusResponse, t?: unknown) => {
  const translate = t as ScanMessageTFunction | undefined;
  const rawDetail = resolveScanFailureDetail(status);
  const detail =
    rawDetail === 'unknown' && translate
      ? translate('agentSkillModal.import.errors.scanUnknownDetail')
      : rawDetail;

  if (translate) {
    return translate('agentSkillModal.import.errors.SCAN_FAILED', { detail });
  }

  return `Skill 安全扫描失败：${detail === 'unknown' ? '未知错误' : detail}`;
};

export const formatScanRejectedMessage = (status: ScanStatusResponse, t?: unknown) => {
  const translate = t as ScanMessageTFunction | undefined;
  const report = normalizeScanReport(status);
  const reason =
    report.recommendation ||
    extractFirstScanFinding(report.findings) ||
    (translate ? translate('agentSkillModal.import.errors.scanRetryHint') : '请修复风险后重试');

  if (translate) {
    if (report.score) {
      return translate('agentSkillModal.import.errors.SCAN_REJECTED_WITH_SCORE', {
        reason,
        riskLevel: report.riskLevel,
        score: report.score,
      });
    }

    return translate('agentSkillModal.import.errors.SCAN_REJECTED', {
      reason,
      riskLevel: report.riskLevel,
    });
  }

  const scoreText = report.score ? `，评分 ${report.score}` : '';

  return `Skill 安全扫描未通过：风险等级 ${report.riskLevel}${scoreText}。${reason}`;
};

export const isScanRiskLevelAllowed = (riskLevel: string | undefined) =>
  Boolean(riskLevel && ALLOWED_SCAN_RISK_LEVELS.has(riskLevel.toLowerCase()));
