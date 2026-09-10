import { GroundingSource } from '../components/GroundingSources';

/**
 * Normalizes Markdown text for proper rendering:
 * 1. Collapses empty lines between Markdown table rows (which breaks GFM table parsing)
 * 2. Un-jams table rows formatted as `| |` or `||`
 * 3. Ensures clean double newlines before and after tables
 * 4. Strips amateur inline citation brackets like `[1]`, `[1.5]`, `[2.8, 3.15]` that clutter the text
 */
export function formatMarkdown(text: string): string {
  if (!text) return '';

  // 1. Separate jammed table rows: e.g. `| ... | | ... |` or `| ... ||| ... |`
  let pre = text
    .replace(/(?<!\\)\|\s*\|\s*\|/g, '|\n|')
    .replace(/(?<!\\)\|\s*\|(?!=)/g, '|\n|');

  // 2. Remove amateur inline citations like [1], [2], [1.5], [2.8, 3.15], [3.6]
  // Note: Only remove when inside brackets containing numbers/dots/commas, not standard markdown links [Title](url)
  pre = pre.replace(/(?<!\])\s*\[\s*\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*\s*\](?!\()/g, '');

  // 3. Line by line processing to fix empty lines between table rows
  const lines = pre.split(/\r?\n/);
  const result: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    // A table row starts with | and ends with |
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|');

    if (isTableRow) {
      if (!inTable) {
        // Ensure double newline before table starts
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('');
        }
        inTable = true;
      }
      result.push(trimmed);
    } else if (inTable) {
      if (trimmed === '') {
        // Check if the next non-empty line continues the table
        let nextIsTable = false;
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].trim();
          if (nextTrimmed === '') continue;
          if (nextTrimmed.startsWith('|') && nextTrimmed.endsWith('|')) {
            nextIsTable = true;
          }
          break;
        }
        if (nextIsTable) {
          // Skip empty line between table rows so GFM doesn't break
          continue;
        } else {
          inTable = false;
          result.push('');
        }
      } else {
        inTable = false;
        if (result.length > 0 && result[result.length - 1] !== '') {
          result.push('');
        }
        result.push(lines[i]);
      }
    } else {
      result.push(lines[i]);
    }
  }

  return result.join('\n');
}

/**
 * Extracts reference links from natural AI responses (such as Antigravity or Gemini
 * when outputting a "Sumber Referensi", "Referensi", or citation lists at the end of the text)
 * and strips the raw list/block from the rendered markdown body so it can
 * be rendered cleanly by GroundingSources.
 */
export function extractSourcesFromText(text: string): {
  cleanedText: string;
  extractedSources: GroundingSource[];
} {
  if (!text) return { cleanedText: text, extractedSources: [] };

  // Match header like Sumber Referensi, **Sumber Referensi**, ### Sumber Referensi, Referensi, Sources, etc.
  const headerRegex = /(?:\r?\n|^)\s*(?:#{1,6}\s*)?(?:\*{1,2})?(?:Sumber Referensi|Referensi|Sumber Rujukan|Daftar Referensi|Daftar Pustaka|References|Sources)(?:\*{1,2})?:?\s*([\s\S]*)$/i;
  const match = text.match(headerRegex);

  if (!match) {
    return { cleanedText: text, extractedSources: [] };
  }

  const rawReferencesBlock = match[1];
  const extractedSources: GroundingSource[] = [];
  const seenUrls = new Set<string>();

  // 1. Match markdown links with optional bracketed numbers:
  // e.g. `[1] [Title](url)` or `* [1] [Title](url)` or `[Title](url)`
  const linkWithNumberRegex = /\[?(?:\[\d+(?:\.\d+)?\]\s*)?\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  let m: RegExpExecArray | null;

  while ((m = linkWithNumberRegex.exec(rawReferencesBlock)) !== null) {
    let title = m[1].trim();
    const uri = m[2].trim();
    // Strip leading number badges like [1] or 1.
    title = title.replace(/^\[?\d+(?:\.\d+)?\]?[\s.-]*/, '');

    if (!seenUrls.has(uri)) {
      seenUrls.add(uri);
      try {
        const parsed = new URL(uri);
        const domain = parsed.hostname.replace(/^www\./, '');
        extractedSources.push({ uri, title: title || domain, domain });
      } catch {
        extractedSources.push({ uri, title: title || 'Sumber Web' });
      }
    }
  }

  // 2. Also match simple markdown links [Title](url)
  const simpleMdLink = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
  while ((m = simpleMdLink.exec(rawReferencesBlock)) !== null) {
    let title = m[1].trim();
    const uri = m[2].trim();
    title = title.replace(/^\[?\d+(?:\.\d+)?\]?[\s.-]*/, '');

    if (!seenUrls.has(uri)) {
      seenUrls.add(uri);
      try {
        const parsed = new URL(uri);
        const domain = parsed.hostname.replace(/^www\./, '');
        extractedSources.push({ uri, title: title || domain, domain });
      } catch {
        extractedSources.push({ uri, title: title || 'Sumber Web' });
      }
    }
  }

  // 3. Match raw URLs if any (e.g. `https://...`)
  const rawUrlRegex = /(https?:\/\/[^\s\)\],]+)/g;
  while ((m = rawUrlRegex.exec(rawReferencesBlock)) !== null) {
    const uri = m[1].trim();
    if (!seenUrls.has(uri)) {
      seenUrls.add(uri);
      try {
        const parsed = new URL(uri);
        const domain = parsed.hostname.replace(/^www\./, '');
        extractedSources.push({ uri, title: domain, domain });
      } catch {
        extractedSources.push({ uri, title: uri });
      }
    }
  }

  if (extractedSources.length > 0) {
    // Strip the messy reference block from the rendered markdown text
    const cleanedText = text.slice(0, match.index).trimEnd();
    return { cleanedText, extractedSources };
  }

  return { cleanedText: text, extractedSources: [] };
}
