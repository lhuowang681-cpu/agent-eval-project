import { describe, expect, it } from 'vitest';

import {
  formatScanFailedMessage,
  formatScanRejectedMessage,
  isScanRiskLevelAllowed,
  normalizeScanReport,
} from './skillScanReport';

describe('skillScanReport', () => {
  it('formatScanFailedMessage should prefer error_message', () => {
    expect(
      formatScanFailedMessage({
        error_code: 'E001',
        error_message: '病毒特征匹配',
        status: 'failed',
      }),
    ).toBe('Skill 安全扫描失败：病毒特征匹配');
  });

  it('formatScanRejectedMessage should include score and recommendation', () => {
    expect(
      formatScanRejectedMessage({
        report_data: {
          recommendation: '请移除可疑脚本',
          risk_level: 'high',
          score: 42,
        },
        status: 'completed',
      }),
    ).toBe('Skill 安全扫描未通过：风险等级 high，评分 42。请移除可疑脚本');
  });

  it('normalizeScanReport should parse string report_data', () => {
    const report = normalizeScanReport({
      report_data: JSON.stringify({ risk_level: 'medium', score: 10 }),
      status: 'completed',
    });

    expect(report.riskLevel).toBe('medium');
    expect(report.score).toBe('10');
  });

  it('isScanRiskLevelAllowed should allow none and low only', () => {
    expect(isScanRiskLevelAllowed('none')).toBe(true);
    expect(isScanRiskLevelAllowed('low')).toBe(true);
    expect(isScanRiskLevelAllowed('medium')).toBe(false);
    expect(isScanRiskLevelAllowed(undefined)).toBe(false);
  });
});
