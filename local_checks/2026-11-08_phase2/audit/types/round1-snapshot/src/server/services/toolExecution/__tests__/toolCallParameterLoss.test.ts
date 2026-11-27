import { parseToolCalls } from '@lobechat/model-runtime';
import { escapeXmlAttr, escapeXmlContent } from '@lobechat/prompts';
import { safeParseJSON, safeParsePartialJSON } from '@lobechat/utils';
import { describe, expect, it } from 'vitest';

/**
 * Simulates how an XML parser processes JSON content containing < > & characters.
 *
 * When a JSON arguments string is embedded in an XML transport layer
 * (e.g., <parameter>{...json...}</parameter>), bare < > & inside
 * the JSON string get interpreted as XML markup:
 *
 * - < starts a child element → creates mixed content nodes
 * - & triggers entity decoding (&quot; → " etc.)
 * - </tagName> prematurely closes the parent element
 *
 * Different extraction strategies produce different levels of damage:
 * - First text node: always malformed JSON → complete parameter loss
 * - textContent: valid JSON but corrupted content → values wrong but structure intact
 * - Premature close: always malformed JSON → complete parameter loss
 * - Entity decoding: breaks JSON string boundaries → complete parameter loss
 */
class XmlParserSimulation {
  /**
   * Decode XML entities in text content.
   * XML parsers decode &quot; → " etc., which can break JSON string boundaries.
   */
  static decodeXmlEntities(text: string): string {
    return text
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&apos;', "'");
  }

  /**
   * Simulate DOM textContent extraction from mixed content.
   * Removes all <...> tags but preserves text between and inside them.
   * Result: JSON structure usually survives but markdown content is corrupted.
   */
  static extractTextContent(content: string): string {
    return content.replaceAll(/<[^>]+>/g, '');
  }

  /**
   * Simulate extracting only the FIRST text node from mixed content.
   * An XML parser splits content at < into mixed content (text nodes + child elements).
   * If the consumer only processes the first text node child, they get the
   * initial fragment before any child element — always malformed JSON
   * because the closing quote/brace is in a later text node.
   */
  static extractFirstTextNode(content: string): string {
    const firstTagIdx = content.search(/<[a-z/!?]/i);
    if (firstTagIdx === -1) return content;
    return content.slice(0, firstTagIdx);
  }

  /**
   * Simulate extracting only direct text nodes (excluding child element content).
   * Iteratively removes paired <tag>content</tag> blocks and standalone tags.
   * Result: JSON may be valid but with empty/missing values.
   */
  static extractDirectTextNodes(content: string): string {
    let result = content;
    let prev = '';
    while (prev !== result) {
      prev = result;
      result = result.replaceAll(/<([^>]+)>([^<]*)<\/\1>/g, '');
    }
    result = result.replaceAll(/<[^>]+>/g, '');
    return result;
  }

  /**
   * Simulate premature closing of an XML element.
   * When </tagName> appears inside text content, the XML parser treats it
   * as the actual closing tag, truncating everything after it.
   * Result: always produces malformed JSON → complete parameter loss.
   */
  static extractUntilFirstClose(xml: string, tagName: string): string {
    const openTag = `<${tagName}>`;
    const closeTag = `</${tagName}>`;
    const startIdx = xml.indexOf(openTag);
    if (startIdx === -1) return '';
    const contentStart = startIdx + openTag.length;
    const closeIdx = xml.indexOf(closeTag, contentStart);
    if (closeIdx === -1) return '';
    return xml.slice(contentStart, closeIdx);
  }

  /**
   * Check if content contains bare < that would cause XML well-formedness error.
   * In XML, < must be escaped as &lt; or appear inside CDATA.
   * Bare < not followed by a valid XML construct start (letter, /, !, ?) is a parse error.
   */
  static hasBareLt(content: string): boolean {
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '<') {
        const nextChar = content[i + 1];
        if (!nextChar || !/[a-z/!?]/i.test(nextChar)) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Unit tests to reproduce the MCP tool call parameter loss bug
 * caused by XML special characters (<, >, &) in markdown content.
 *
 * Bug: When calling `update_doc` (or any MCP tool) with markdown containing
 * < > & characters, the MCP gateway's XML-based protocol layer interprets
 * these as XML markup, destroying the parameter structure. Feishu receives
 * empty request → "Document ID cannot be empty".
 *
 * Root cause: JSON arguments are valid JSON (where < > & are legal in strings),
 * but when embedded in an XML transport layer, < > are treated as XML tags
 * and & as entity references, breaking the parameter node structure.
 */
describe('Tool call parameter loss - XML special chars in markdown', () => {
  // ============================================================
  // Stage A: Premature closing — most destructive mechanism
  // ============================================================
  describe('Stage A: Premature closing destroys ALL parameters', () => {
    it('markdown containing </parameter> closes XML node prematurely', () => {
      const validArgs =
        '{"doc_id": "abc123", "mode": "markdown", "markdown": "Use </parameter> to close"}';
      const xmlWrapped = `<parameter>${validArgs}</parameter>`;

      // XML parser sees </parameter> inside markdown as the closing tag
      const extracted = XmlParserSimulation.extractUntilFirstClose(xmlWrapped, 'parameter');

      // Only content BEFORE </parameter> is captured:
      // {"doc_id": "abc123", "mode": "markdown", "markdown": "Use
      // Missing closing quote and brace → malformed JSON
      expect(safeParseJSON(extracted)).toBeUndefined();

      // safeParseJSON || {} fallback → empty object → Feishu error
      const mcpArgs = safeParseJSON(extracted) || {};
      expect(mcpArgs).toEqual({});
      expect((mcpArgs as any).doc_id).toBeUndefined();
    });

    it('markdown containing </invoke> closes outer invoke tag', () => {
      const validArgs = '{"doc_id": "abc123", "markdown": "Example of </invoke> tag"}';
      const xmlWrapped = `<invoke><parameter>${validArgs}</parameter></invoke>`;

      // </invoke> inside markdown prematurely closes the outer <invoke> tag
      const extracted = XmlParserSimulation.extractUntilFirstClose(xmlWrapped, 'invoke');

      // Contains <parameter> prefix — not valid JSON
      expect(safeParseJSON(extracted)).toBeUndefined();
    });

    it('markdown containing </tool_use> closes tool_use tag', () => {
      const validArgs = '{"doc_id": "abc123", "markdown": "Close with </tool_use>"}';
      const xmlWrapped = `<tool_use>${validArgs}</tool_use>`;

      const extracted = XmlParserSimulation.extractUntilFirstClose(xmlWrapped, 'tool_use');
      expect(safeParseJSON(extracted)).toBeUndefined();
    });
  });

  // ============================================================
  // Stage B: First text node extraction — always malformed JSON
  // ============================================================
  describe('Stage B: First text node extraction produces malformed JSON', () => {
    it('<div> in markdown value fragments JSON at first child element', () => {
      const validArgs = '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title\\n<div>content</div>"}';

      // JSON parsing of original string works fine
      const parsed = safeParseJSON(validArgs);
      expect(parsed).toBeDefined();
      expect((parsed as any).doc_id).toBe('OczKdwHJiheXlbC');

      // First text node: everything before <div>
      const firstTextNode = XmlParserSimulation.extractFirstTextNode(validArgs);

      // Result: {"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title\n
      // Missing closing quote for markdown value and closing } for JSON
      expect(firstTextNode).toContain('doc_id');
      expect(safeParseJSON(firstTextNode)).toBeUndefined();

      // All parameters lost
      const mcpArgs = safeParseJSON(firstTextNode) || {};
      expect((mcpArgs as any).doc_id).toBeUndefined();
    });

    it('<details> in markdown fragments JSON', () => {
      const validArgs =
        '{"doc_id": "abc123", "markdown": "# PRD\\n<details><summary>Details</summary>Content</details>"}';

      const firstTextNode = XmlParserSimulation.extractFirstTextNode(validArgs);
      expect(safeParseJSON(firstTextNode)).toBeUndefined();
    });

    it('TypeScript generics <T> in markdown fragments JSON', () => {
      const validArgs =
        '{"doc_id": "abc123", "markdown": "```typescript\\nfunction id<T>(x: T): T { return x; }\\n```"}';

      const firstTextNode = XmlParserSimulation.extractFirstTextNode(validArgs);

      // <T> looks like an XML tag → first text node stops before it
      expect(safeParseJSON(firstTextNode)).toBeUndefined();
    });
  });

  // ============================================================
  // Stage C: XML entity decoding breaks JSON string boundaries
  // ============================================================
  describe('Stage C: Entity decoding breaks JSON string boundaries', () => {
    it('&quot; decoded to bare " breaks JSON', () => {
      // &quot; is both a JSON representation and an XML entity
      const validArgs = '{"doc_id": "abc123", "markdown": "Use &quot;quotes&quot; in text"}';

      // JSON parsing works — &quot; is literal text in JSON string value
      const parsed = safeParseJSON(validArgs);
      expect(parsed).toBeDefined();

      // XML entity decoding: &quot; → "
      const decoded = XmlParserSimulation.decodeXmlEntities(validArgs);

      // Bare " inside JSON string value breaks string boundaries
      expect(decoded).toContain('"quotes"');
      expect(safeParseJSON(decoded)).toBeUndefined();

      // Parameters lost
      const mcpArgs = safeParseJSON(decoded) || {};
      expect((mcpArgs as any).doc_id).toBeUndefined();
    });

    it('double entity decoding: &amp;quot; → &quot; → "', () => {
      // Properly XML-escaped JSON goes through two decode rounds
      const xmlEscapedArgs = '{"doc_id": "abc123", "markdown": "Use &amp;quot;quotes&amp;quot;"}';

      const firstDecode = XmlParserSimulation.decodeXmlEntities(xmlEscapedArgs);
      // &amp;quot; → &quot;

      const secondDecode = XmlParserSimulation.decodeXmlEntities(firstDecode);
      // &quot; → " → bare quotes break JSON

      expect(safeParseJSON(secondDecode)).toBeUndefined();
    });

    it('&amp; alone does not break JSON structure (content changed only)', () => {
      // &amp; → & is valid in JSON strings
      const validArgs = '{"doc_id": "abc123", "markdown": "A &amp; B"}';

      const decoded = XmlParserSimulation.decodeXmlEntities(validArgs);
      // &amp; → & — valid in JSON strings, structure intact

      const parsed = safeParseJSON(decoded);
      expect(parsed).toBeDefined();
      expect((parsed as any).markdown).toBe('A & B');
    });
  });

  // ============================================================
  // Stage D: textContent extraction — valid JSON but corrupted content
  // ============================================================
  describe('Stage D: textContent preserves structure but corrupts content', () => {
    it('textContent extraction: valid JSON but markdown tags removed', () => {
      const validArgs =
        '{"doc_id": "OczKdwHJiheXlbC", "mode": "markdown", "markdown": "# Title\\n<div>content</div>"}';

      const textContent = XmlParserSimulation.extractTextContent(validArgs);

      // Tags removed, text preserved
      expect(textContent).not.toContain('<div>');
      expect(textContent).toContain('content');

      // JSON still valid! But markdown content is wrong
      const parsed = safeParseJSON(textContent);
      expect(parsed).toBeDefined();
      expect((parsed as any).doc_id).toBe('OczKdwHJiheXlbC');
      // Markdown value missing <div> tags — content corrupted but not completely lost
      expect((parsed as any).markdown).not.toContain('<div>');
      expect((parsed as any).markdown).toContain('content');
    });

    it('direct text nodes: valid JSON but markdown value incomplete', () => {
      const validArgs = '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title\\n<div>content</div>"}';

      const directText = XmlParserSimulation.extractDirectTextNodes(validArgs);

      // <div>content</div> removed entirely, leaving "# Title\n"
      const parsed = safeParseJSON(directText);
      expect(parsed).toBeDefined();
      expect((parsed as any).doc_id).toBe('OczKdwHJiheXlbC');
      // Markdown value incomplete — "content" text inside <div> is gone
      expect((parsed as any).markdown).not.toContain('content');
    });
  });

  // ============================================================
  // Stage E: End-to-end Feishu update_doc bug simulation
  // ============================================================
  describe('Stage E: End-to-end Feishu update_doc bug', () => {
    it('reproduces "Document ID cannot be empty" via premature close', () => {
      let toolCalls = parseToolCalls(
        [],
        [
          {
            index: 0,
            id: 'toolu_01',
            type: 'function' as const,
            function: { name: 'lark-doc____update_doc', arguments: '' },
          },
        ],
      );

      // LLM outputs markdown with </parameter> — closes XML node prematurely
      const deltas = [
        '{"doc_id": "OczKdwHJiheXlbC", ',
        '"mode": "markdown", ',
        '"markdown": "# PRD\\n\\nUse </parameter> to close"}',
      ];

      for (const delta of deltas) {
        toolCalls = parseToolCalls(toolCalls, [{ index: 0, function: { arguments: delta } }]);
      }

      const finalArgs = toolCalls[0].function.arguments;

      // Step 2: JSON parsing works (before XML layer)
      expect(safeParseJSON(finalArgs)).toBeDefined();

      // Step 3: XML layer — premature close destroys JSON
      const xmlWrapped = `<parameter>${finalArgs}</parameter>`;
      const extracted = XmlParserSimulation.extractUntilFirstClose(xmlWrapped, 'parameter');

      expect(safeParseJSON(extracted)).toBeUndefined();

      // Step 4: Feishu receives empty args → "Document ID cannot be empty"
      const feishuArgs = safeParseJSON(extracted) || {};
      expect((feishuArgs as any).doc_id).toBeUndefined();
    });

    it('reproduces "Document ID cannot be empty" via first text node', () => {
      let toolCalls = parseToolCalls(
        [],
        [
          {
            index: 0,
            id: 'toolu_01',
            type: 'function' as const,
            function: { name: 'lark-doc____update_doc', arguments: '' },
          },
        ],
      );

      // Markdown with HTML tags (common in rich markdown documents)
      const deltas = [
        '{"doc_id": "OczKdwHJiheXlbC", ',
        '"mode": "markdown", ',
        '"markdown": "# 产品需求\\n\\n<div class=\\"highlight\\">核心功能</div>"}',
      ];

      for (const delta of deltas) {
        toolCalls = parseToolCalls(toolCalls, [{ index: 0, function: { arguments: delta } }]);
      }

      const finalArgs = toolCalls[0].function.arguments;

      // JSON parsing works
      expect(safeParseJSON(finalArgs)).toBeDefined();

      // First text node: malformed JSON (missing closing quote/brace)
      const firstTextNode = XmlParserSimulation.extractFirstTextNode(finalArgs);
      expect(safeParseJSON(firstTextNode)).toBeUndefined();

      // Feishu receives empty args → "Document ID cannot be empty"
      const feishuArgs = safeParseJSON(firstTextNode) || {};
      expect((feishuArgs as any).doc_id).toBeUndefined();
    });

    it('reproduces "Document ID cannot be empty" via entity decoding', () => {
      const validArgs =
        '{"doc_id": "OczKdwHJiheXlbC", "mode": "markdown", "markdown": "Use &quot;引用&quot; text"}';

      const decoded = XmlParserSimulation.decodeXmlEntities(validArgs);
      expect(safeParseJSON(decoded)).toBeUndefined();

      const feishuArgs = safeParseJSON(decoded) || {};
      expect((feishuArgs as any).doc_id).toBeUndefined();
    });
  });

  // ============================================================
  // Stage F: Claude < escaping prevents XML interpretation
  // ============================================================
  describe('Stage F: Claude unicode escaping prevents XML issues', () => {
    it('\\u003c escaping makes arguments XML-safe', () => {
      let toolCalls = parseToolCalls(
        [],
        [
          {
            index: 0,
            id: 'toolu_01',
            type: 'function' as const,
            function: { name: 'lark-doc____update_doc', arguments: '' },
          },
        ],
      );

      // Claude escapes < > as < > in JSON output
      const deltas = [
        '{"doc_id": "OczKdwHJiheXlbC", ',
        '"mode": "markdown", ',
        '"markdown": "# Title\\n\\u003cdiv class=\\"note\\"\\u003e重要\\u003c/div\\u003e"}',
      ];

      for (const delta of deltas) {
        toolCalls = parseToolCalls(toolCalls, [{ index: 0, function: { arguments: delta } }]);
      }

      const finalArgs = toolCalls[0].function.arguments;

      // JSON.parse converts < back to < in the parsed value
      const parsed = safeParseJSON(finalArgs);
      expect(parsed).toBeDefined();
      expect((parsed as any).markdown).toContain('<div');

      // But the RAW string contains <, NOT raw < — XML parser won't interpret it
      expect(finalArgs).toContain('\\u003c');

      // First text node: < doesn't trigger XML tag detection
      const firstTextNode = XmlParserSimulation.extractFirstTextNode(finalArgs);
      expect(firstTextNode).toBe(finalArgs);

      // Premature close: no </parameter> to trigger truncation
      const xmlWrapped = `<parameter>${finalArgs}</parameter>`;
      const extracted = XmlParserSimulation.extractUntilFirstClose(xmlWrapped, 'parameter');
      expect(extracted).toBe(finalArgs);

      // All parameters survive through XML layer
      const reparsed = safeParseJSON(extracted);
      expect(reparsed).toBeDefined();
      expect((reparsed as any).doc_id).toBe('OczKdwHJiheXlbC');
    });

    it('contrast: raw < breaks while \\u003c survives through XML layer', () => {
      // Same markdown content, two escaping strategies

      // Raw < > (non-Claude models) → XML layer breaks it
      const rawArgs = '{"doc_id": "abc", "markdown": "# Title\\n<div>content</div>"}';
      const rawFirstNode = XmlParserSimulation.extractFirstTextNode(rawArgs);
      expect(safeParseJSON(rawFirstNode)).toBeUndefined();

      // Unicode-escaped (Claude models) → XML layer preserves it
      const escapedArgs =
        '{"doc_id": "abc", "markdown": "# Title\\n\\u003cdiv\\u003econtent\\u003c/div\\u003e"}';
      const escapedFirstNode = XmlParserSimulation.extractFirstTextNode(escapedArgs);
      expect(safeParseJSON(escapedFirstNode)).toBeDefined();
      expect((safeParseJSON(escapedFirstNode) as any).doc_id).toBe('abc');
    });
  });

  // ============================================================
  // Stage G: Mitigations — CDATA and safeParsePartialJSON
  // ============================================================
  describe('Stage G: Mitigations', () => {
    it('CDATA section preserves all content including < > &', () => {
      const validArgs =
        '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title<div>content</div>&<span>more</span>"}';

      // CDATA tells XML parser to treat content as raw text
      const xmlWithCdata = `<parameter><![CDATA[${validArgs}]]></parameter>`;
      const cdataMatch = xmlWithCdata.match(/<parameter><!\[CDATA\[([\s\S]*?)\]\]><\/parameter>/);

      expect(cdataMatch).not.toBeNull();
      const extracted = cdataMatch![1];
      expect(extracted).toBe(validArgs);

      const parsed = safeParseJSON(extracted);
      expect(parsed).toBeDefined();
      expect((parsed as any).doc_id).toBe('OczKdwHJiheXlbC');
      expect((parsed as any).markdown).toContain('<div>');
      expect((parsed as any).markdown).toContain('&');
    });

    it('CDATA breaks if markdown contains ]]> end marker', () => {
      // Edge case: markdown contains the CDATA closing marker ]]>
      const validArgs = '{"doc_id": "abc123", "markdown": "Use ]]> to end"}';
      const xmlWithCdata = `<parameter><![CDATA[${validArgs}]]></parameter>`;

      // CDATA ends at first ]]> — inside markdown, premature termination
      const cdataMatch = xmlWithCdata.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);

      expect(cdataMatch).not.toBeNull();
      const extracted = cdataMatch![1];
      // Captured: '{"doc_id": "abc123", "markdown": "Use ' — malformed JSON
      expect(safeParseJSON(extracted.trim())).toBeUndefined();
    });

    it('safeParsePartialJSON can recover partial parameters from truncated JSON', () => {
      // Premature close scenario — safeParseJSON returns undefined
      const truncatedJson = '{"doc_id": "abc123", "mode": "markdown", "markdown": "Use ';

      // safeParseJSON fails — complete parameter loss
      expect(safeParseJSON(truncatedJson)).toBeUndefined();

      // safeParsePartialJSON recovers partial data — doc_id preserved
      const partial = safeParsePartialJSON(truncatedJson);
      expect(partial).toBeDefined();
      expect((partial as any).doc_id).toBe('abc123');
      // markdown value is truncated but at least doc_id survives
      expect((partial as any).markdown).toContain('Use');
    });

    it('safeParsePartialJSON recovers doc_id from first text node fragment', () => {
      const firstTextNodeFragment = '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title\\n';

      expect(safeParseJSON(firstTextNodeFragment)).toBeUndefined();

      const partial = safeParsePartialJSON(firstTextNodeFragment);
      expect(partial).toBeDefined();
      expect((partial as any).doc_id).toBe('OczKdwHJiheXlbC');
    });
  });

  // ============================================================
  // Stage H: Bare < causes XML well-formedness error
  // ============================================================
  describe('Stage H: Bare < causes XML parse failure', () => {
    it('comparison operator x < 10 contains bare < — invalid in XML', () => {
      const validArgs = '{"doc_id": "abc123", "markdown": "If x < 10, then result > 5"}';

      // JSON parsing works fine
      const parsed = safeParseJSON(validArgs);
      expect(parsed).toBeDefined();

      // Bare < (not followed by valid XML tag start) detected — XML parse error
      expect(XmlParserSimulation.hasBareLt(validArgs)).toBe(true);
      // A strict XML parser would reject the entire document → parameter node completely lost
    });

    it('HTML <div> is NOT bare < but creates mixed content issue', () => {
      const validArgs = '{"doc_id": "abc123", "markdown": "<div>content</div>"}';

      // <div> starts with < followed by 'd' — valid XML tag start (not "bare")
      expect(XmlParserSimulation.hasBareLt(validArgs)).toBe(false);

      // But first text node extraction still fragments the JSON
      const firstTextNode = XmlParserSimulation.extractFirstTextNode(validArgs);
      expect(safeParseJSON(firstTextNode)).toBeUndefined();
    });
  });

  // ============================================================
  // Stage I: Fix verification — escapeXml prevents XML corruption
  // ============================================================
  describe('Stage I: Fix verification — escapeXml prevents XML corruption', () => {
    it('escapeXmlContent makes < > in arguments XML-safe', () => {
      const args = '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title\\n<div>content</div>"}';

      // Before fix: first text node extraction fragments JSON at <div>
      const rawFirstTextNode = XmlParserSimulation.extractFirstTextNode(args);
      expect(rawFirstTextNode).toContain('doc_id');
      expect(safeParseJSON(rawFirstTextNode)).toBeUndefined(); // Missing closing quote/brace

      // After fix: escapeXmlContent makes args safe for XML embedding
      const escapedArgs = escapeXmlContent(args);

      // Escaped: < becomes &lt;, > becomes &gt;, & becomes &amp;
      expect(escapedArgs).toContain('&lt;div');
      expect(escapedArgs).not.toContain('<div>');

      // XML structure is intact — no child elements from <div>
      // first text node extraction now returns the FULL escaped string (no < triggers truncation)
      const escapedFirstTextNode = XmlParserSimulation.extractFirstTextNode(escapedArgs);
      expect(escapedFirstTextNode).toBe(escapedArgs); // Full content preserved

      // The escaped content has no bare < — safe for XML
      expect(XmlParserSimulation.hasBareLt(escapedArgs)).toBe(false);
    });

    it('escapeXmlAttr makes tool names/ids safe in XML attributes', () => {
      const toolId = 'toolu_<01>';
      const toolName = 'update_<doc>';

      // Before fix: bare < in attributes breaks XML
      const xmlRawAttr = `<tool id="${toolId}" name="${toolName}">`;
      expect(XmlParserSimulation.hasBareLt(xmlRawAttr)).toBe(true);

      // After fix: escapeXmlAttr makes attributes safe
      const xmlFixedAttr = `<tool id="${escapeXmlAttr(toolId)}" name="${escapeXmlAttr(toolName)}">`;
      expect(XmlParserSimulation.hasBareLt(xmlFixedAttr)).toBe(false);
    });

    it('escapeXmlContent preserves XML structure for markdown with </parameter>', () => {
      const args = '{"doc_id": "abc123", "markdown": "Use </parameter> to close tags"}';

      // Before fix: </parameter> prematurely closes XML
      const xmlRaw = `<parameter>${args}</parameter>`;
      const rawExtracted = XmlParserSimulation.extractUntilFirstClose(xmlRaw, 'parameter');
      expect(rawExtracted).not.toBe(args); // Truncated!

      // After fix: </parameter> is escaped as &lt;/parameter&gt;
      const escapedArgs = escapeXmlContent(args);
      expect(escapedArgs).toContain('&lt;/parameter&gt;');
      expect(escapedArgs).not.toContain('</parameter>');

      const xmlFixed = `<parameter>${escapedArgs}</parameter>`;
      const fixedExtracted = XmlParserSimulation.extractUntilFirstClose(xmlFixed, 'parameter');
      expect(fixedExtracted).toBe(escapedArgs); // Full content preserved
    });

    it('escapeXmlContent handles & in markdown (entity conflicts)', () => {
      const args = '{"doc_id": "abc123", "markdown": "Use &quot;quotes&quot; in text"}';

      // Before fix: &quot; gets decoded by XML parser → bare " breaks JSON
      const decoded = XmlParserSimulation.decodeXmlEntities(args);
      expect(safeParseJSON(decoded)).toBeUndefined();

      // After fix: & is escaped as &amp; — XML parser won't decode it
      const escapedArgs = escapeXmlContent(args);
      expect(escapedArgs).toContain('&amp;quot;');
      expect(escapedArgs).not.toContain('&quot;');

      // The escaped version preserves the original content when decoded back
      const redecoded = XmlParserSimulation.decodeXmlEntities(escapedArgs);
      // After single decode: &amp;quot; → &quot; — still safe (not yet bare ")
      // This matches the original args content
      expect(redecoded).toContain('&quot;');
      expect(safeParseJSON(redecoded)).toBeDefined();
      expect((safeParseJSON(redecoded) as any).doc_id).toBe('abc123');
    });

    it('full GroupRoleTransform simulation: escaped args preserve XML context', () => {
      // Simulates the full buildToolUseSection with escaping applied
      const tools = [
        {
          id: 'toolu_01',
          arguments: '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# 产品\\n<div>核心功能</div>"}',
        },
      ];

      let section = '\n\n<tool_use>\n';
      for (const tool of tools) {
        const toolId = escapeXmlAttr(tool.id);
        const args = escapeXmlContent(tool.arguments || '');
        section += `<tool id="${toolId}">\n`;
        section += `${args}\n`;
        section += `</tool>\n`;
      }
      section += '</tool_use>';

      // The XML structure is intact — no bare < from markdown content
      expect(XmlParserSimulation.hasBareLt(section)).toBe(false);

      // Content is preserved as escaped text
      expect(section).toContain('&lt;div');
      expect(section).toContain('核心功能');
    });
  });

  // ============================================================
  // Stage J: Fix verification — safeParsePartialJSON fallback recovery
  // ============================================================
  describe('Stage J: Fix verification — safeParsePartialJSON fallback', () => {
    it('new pattern: safeParseJSON ?? safeParsePartialJSON ?? {} recovers doc_id', () => {
      // Simulates truncated JSON from premature close scenario
      const truncatedJson = '{"doc_id": "OczKdwHJiheXlbC", "mode": "markdown", "markdown": "Use ';

      // Old pattern (safeParseJSON || {}): complete parameter loss
      const oldResult = safeParseJSON(truncatedJson) || {};
      expect((oldResult as any).doc_id).toBeUndefined();

      // New pattern (safeParseJSON ?? safeParsePartialJSON ?? {}): doc_id recovered
      const newResult = safeParseJSON(truncatedJson) ?? safeParsePartialJSON(truncatedJson) ?? {};
      expect((newResult as any).doc_id).toBe('OczKdwHJiheXlbC');
      expect((newResult as any).markdown).toContain('Use');
    });

    it('new pattern recovers from first text node truncation', () => {
      const fragment = '{"doc_id": "OczKdwHJiheXlbC", "markdown": "# Title\\n';

      // Old pattern: empty object
      const oldResult = safeParseJSON(fragment) || {};
      expect((oldResult as any).doc_id).toBeUndefined();

      // New pattern: partial recovery
      const newResult = safeParseJSON(fragment) ?? safeParsePartialJSON(fragment) ?? {};
      expect((newResult as any).doc_id).toBe('OczKdwHJiheXlbC');
    });

    it('new pattern still returns {} for completely unrecognizable strings', () => {
      const garbage = 'random text that is not json at all';

      // Both patterns return empty object for garbage input
      const oldResult = safeParseJSON(garbage) || {};
      const newResult = safeParseJSON(garbage) ?? safeParsePartialJSON(garbage) ?? {};
      expect(oldResult).toEqual({});
      expect(newResult).toEqual({});
    });

    it('new pattern preserves valid JSON unchanged (primary parse succeeds)', () => {
      const validJson = '{"doc_id": "abc123", "markdown": "# Title<div>content</div>"}';

      // Primary parse succeeds — no fallback needed
      const result = safeParseJSON(validJson) ?? safeParsePartialJSON(validJson) ?? {};
      expect((result as any).doc_id).toBe('abc123');
      expect((result as any).markdown).toContain('<div>');
    });
  });
});
