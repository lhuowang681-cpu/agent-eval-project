import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';

export const InteractiveWidgetsIdentifier = 'lobe-interactive-widgets';

export const InteractiveWidgetsSkill: BuiltinSkill = {
  avatar: `data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIHJ4PSI1MTIiIGZpbGw9IiM1QjdGQzQiLz48cmVjdCB4PSIyMzIiIHk9IjMxMiIgd2lkdGg9IjI0MCIgaGVpZ2h0PSI0MDAiIHJ4PSIzMiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjQ4Ii8+PHJlY3QgeD0iNTUyIiB5PSIzMTIiIHdpZHRoPSIyNDAiIGhlaWdodD0iNDAwIiByeD0iMzIiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSI0OCIvPjwvc3ZnPg==`,
  content: systemPrompt,
  description:
    'Render inline interactive widgets — clickable option cards and structured forms — using a unified `interactive-widget` JSON envelope. Use when the user asks for a set of options/choices, or when you need to collect structured input via a form.',
  identifier: InteractiveWidgetsIdentifier,
  name: 'Interactive Widgets',
  source: 'builtin',
};
