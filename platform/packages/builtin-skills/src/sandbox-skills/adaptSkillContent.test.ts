import { describe, expect, it } from 'vitest';

import { adaptSandboxOfficeSkillContent } from './adaptSkillContent';

describe('adaptSandboxOfficeSkillContent', () => {
  it('strips frontmatter and rewrites script paths for absolute sandbox execution', () => {
    const raw = `---
description: "Test skill"
---

# Demo

\`\`\`bash
python scripts/office/unpack.py input.docx /tmp/out/
python scripts/recalc.py output.xlsx
\`\`\`

Use \`scripts/office/validate.py\` after packing.
`;

    const adapted = adaptSandboxOfficeSkillContent('docx', raw);

    expect(adapted).not.toContain('description: "Test skill"');
    expect(adapted).toContain('The cloud sandbox working directory is `/`.');
    expect(adapted).toContain(
      'python /mnt/skills/public/docx/scripts/office/unpack.py input.docx /tmp/out/',
    );
    expect(adapted).toContain('python /mnt/skills/public/docx/scripts/recalc.py output.xlsx');
    expect(adapted).toContain('`/mnt/skills/public/docx/scripts/office/validate.py`');
  });
});
