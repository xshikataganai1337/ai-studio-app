type ReasoningContextState = {
  contents: any[];
  expectedNextHistoryLength: number;
  updatedAt: number;
};

const reasoningContextBySession = new Map<string, ReasoningContextState>();

const MAX_REASONING_CONTEXTS = 48;
const MAX_REASONING_CONTEXT_BYTES = 320_000;
const MAX_REASONING_CONTENT_ITEMS = 40;
const KEEP_RECENT_CONTENT_ITEMS = 26;
const MAX_COMPACTED_SUMMARY_CHARS = 14_000;

export const getReasoningContextKey = (sessionId: string, model: string) => `${sessionId}::${model}`;

const byteLength = (value: unknown) => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const stringifyCompactPart = (part: any) => {
  if (part?.text && !part?.thought) {
    return `text: ${String(part.text).slice(0, 1800)}`;
  }

  if (part?.functionCall) {
    return `tool_call ${part.functionCall.name}: ${JSON.stringify(part.functionCall.args || {}).slice(0, 1200)}`;
  }

  if (part?.functionResponse) {
    return `tool_result ${part.functionResponse.name}: ${JSON.stringify(part.functionResponse.response || {}).slice(0, 1600)}`;
  }

  if (part?.thought && part?.text) {
    // Old raw thoughts are intentionally not copied verbatim during compaction.
    // Recent thought signatures remain untouched in the retained tail.
    return `reasoning-summary: ${String(part.text).slice(0, 700)}`;
  }

  return '';
};

const compactReasoningContents = (contents: any[]) => {
  if (
    contents.length <= MAX_REASONING_CONTENT_ITEMS &&
    byteLength(contents) <= MAX_REASONING_CONTEXT_BYTES
  ) {
    return contents;
  }

  const keepCount = Math.min(KEEP_RECENT_CONTENT_ITEMS, contents.length);
  const older = contents.slice(0, Math.max(0, contents.length - keepCount));
  const recent = contents.slice(-keepCount);

  const summaryLines: string[] = [];
  for (const item of older) {
    const role = item?.role || 'unknown';
    const parts = Array.isArray(item?.parts) ? item.parts : [];
    const rendered = parts
      .map(stringifyCompactPart)
      .filter(Boolean)
      .join('\n');

    if (rendered) {
      summaryLines.push(`[${role}]\n${rendered}`);
    }

    if (summaryLines.join('\n\n').length >= MAX_COMPACTED_SUMMARY_CHARS) break;
  }

  const compactedSummary = summaryLines.join('\n\n').slice(0, MAX_COMPACTED_SUMMARY_CHARS);
  const prefix = compactedSummary
    ? [{
        role: 'user',
        parts: [{
          text:
            '[COMPACTED PRIOR CONTEXT]\n' +
            'Konteks lama telah dipadatkan untuk menjaga latency dan penggunaan memori. ' +
            'Gunakan ringkasan ini sebagai konteks historis; konteks tool/reasoning terbaru tetap dipertahankan secara utuh.\n\n' +
            compactedSummary
        }]
      }]
    : [];

  return [...prefix, ...recent];
};

export const getReasoningContext = (key: string) => reasoningContextBySession.get(key);

export const saveReasoningContext = (
  key: string,
  contents: any[],
  expectedNextHistoryLength: number
) => {
  reasoningContextBySession.set(key, {
    contents: compactReasoningContents(contents),
    expectedNextHistoryLength,
    updatedAt: Date.now()
  });

  if (reasoningContextBySession.size > MAX_REASONING_CONTEXTS) {
    const oldest = [...reasoningContextBySession.entries()]
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt)[0];
    if (oldest) reasoningContextBySession.delete(oldest[0]);
  }
};

export const clearReasoningContextsForSession = (sessionId: string) => {
  const prefix = `${sessionId}::`;
  for (const key of reasoningContextBySession.keys()) {
    if (key.startsWith(prefix)) reasoningContextBySession.delete(key);
  }
};
