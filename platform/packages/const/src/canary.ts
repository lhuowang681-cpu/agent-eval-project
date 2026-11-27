export const CANARY_REQ_HEADER = 'x-ctx-CanaryReq';
export const CANARY_IDC_HEADER = 'x-ctx-CanaryIdc';

export const CANARY_IDC_LATEST = 'LATEST';

export const CANARY_IDC_OPTIONS = [
  CANARY_IDC_LATEST,
  'SHAOY',
  'SHARB',
  'SHAJZ',
  'SHAFQ',
  'NTGXH',
] as const;

export type CanaryIdc = (typeof CANARY_IDC_OPTIONS)[number];
