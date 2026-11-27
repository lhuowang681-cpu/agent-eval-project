import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '../evaluate';

describe('Judge task context and legacy configuration', () => {
  for (const type of ['llm-rubric', 'answer-relevance'] as const) {
    it(`${type} sends task, choices, category, expected, output and explicit criteria`, async () => {
      const generateObject = vi.fn().mockResolvedValue({ score: 1, reason: 'synthetic' });
      await evaluate(
        {
          actual: 'ACTUAL_SENTINEL',
          testCase: {
            input: 'QUESTION_SENTINEL',
            expected: 'EXPECTED_SENTINEL',
            choices: ['CHOICE_SENTINEL'],
            category: 'CATEGORY_SENTINEL',
          },
          rubrics: [
            {
              id: 'judge',
              name: 'judge',
              type,
              weight: 1,
              config: {
                criteria: 'CRITERIA_SENTINEL',
                judgePrompt: 'LEGACY_IGNORED',
                model: 'synthetic',
                provider: 'openai',
              },
            },
          ],
        },
        { matchContext: { generateObject } },
      );
      const prompt = JSON.stringify(generateObject.mock.calls[0][0].messages);
      for (const sentinel of [
        'ACTUAL_SENTINEL',
        'QUESTION_SENTINEL',
        'EXPECTED_SENTINEL',
        'CHOICE_SENTINEL',
        'CATEGORY_SENTINEL',
        'CRITERIA_SENTINEL',
      ])
        expect(prompt).toContain(sentinel);
      expect(prompt).not.toContain('LEGACY_IGNORED');
    });
    it(`${type} accepts legacy judgePrompt and propagates deadline`, async () => {
      const generateObject = vi.fn().mockResolvedValue({ score: 0, reason: 'synthetic zero' });
      const result = await evaluate(
        {
          actual: 'answer',
          testCase: { input: 'question' },
          rubrics: [
            {
              id: 'judge',
              name: 'judge',
              type,
              weight: 1,
              config: {
                judgePrompt: 'LEGACY_CRITERIA',
                model: 'synthetic',
                provider: 'openai',
                timeoutMs: 500,
              },
            },
          ],
        },
        { matchContext: { generateObject } },
      );
      expect(JSON.stringify(generateObject.mock.calls[0][0].messages)).toContain('LEGACY_CRITERIA');
      expect(generateObject.mock.calls[0][0].timeoutMs).toBe(500);
      expect(result.score).toBe(0);
    });
  }
});
