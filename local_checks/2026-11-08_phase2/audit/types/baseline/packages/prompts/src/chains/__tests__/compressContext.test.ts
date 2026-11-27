import { describe, expect, it } from 'vitest';

import { chainCompressContext } from '../compressContext';

describe('chainCompressContext', () => {
  it('should escape XML-sensitive message content in compression history', () => {
    const payload = chainCompressContext([
      {
        id: 'msg-1',
        role: 'user',
        content: 'Use <script>alert("x")</script> & keep path /tmp/a',
        fileList: [
          {
            content: '<config key="a&b">',
            fileType: 'text',
            name: 'a&b.xml',
          },
        ],
      } as any,
    ]);

    const history = payload.messages?.[1].content as string;

    expect(history).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; keep path /tmp/a',
    );
    expect(history).toContain('name="a&amp;b.xml"');
    expect(history).toContain('&lt;config key=&quot;a&amp;b&quot;&gt;');
    expect(history).not.toContain('<script>alert');
  });
});
