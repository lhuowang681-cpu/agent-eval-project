/* eslint-disable */
import { readScenarios } from './read';
import type { Scenario } from './types';
import { writeScenarios } from './write';

export const allScenarios: Scenario[] = [...readScenarios, ...writeScenarios];

export function getScenario(id: string): Scenario | undefined {
  return allScenarios.find((s) => s.id.toLowerCase() === id.toLowerCase());
}

export function filterScenarios(filter?: string): Scenario[] {
  if (!filter) return allScenarios;
  const lc = filter.toLowerCase();
  if (lc === 'read' || lc === 'a') return readScenarios;
  if (lc === 'write' || lc === 'b') return writeScenarios;
  // 逗号分隔的 id 列表
  const ids = filter.split(',').map((s) => s.trim().toLowerCase());
  return allScenarios.filter((s) => ids.includes(s.id.toLowerCase()));
}

/**
 * D 组矩阵：选最易暴露问题的写入场景，跨模型逐一跑。
 */
export const MATRIX_SCENARIO_IDS = ['FS-WRITE-02', 'FS-WRITE-03', 'FS-WRITE-04'];

export { readScenarios, writeScenarios };
export type { Scenario };
