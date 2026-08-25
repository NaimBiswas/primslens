/**
 * Incrementally scans a stream of text for complete top-level JSON values
 * (`{...}` or `[...]`) and calls `onValue(parsedValue)` for each one found,
 * the moment it closes — whether that value spans one line or many, and
 * ignoring any stray text between values (whitespace, commas, an enclosing
 * array's brackets). A candidate that fails to parse is silently dropped;
 * the scanner keeps looking for the next value rather than corrupting the
 * whole stream over one bad chunk.
 *
 * This lets a single LLM response be read as either one JSON object per
 * line (the streaming contract PrismLens's review agent is prompted to use)
 * or one big `{"findings": [...]}` blob (what an older prompt, or a model
 * that ignores the streaming instruction, might still produce) without the
 * caller needing to know in advance which shape actually comes back —
 * either way, `onValue` fires with something parseable, just at different
 * granularity.
 */
export function createJsonValueScanner(onValue) {
  let buffer = '';
  let scanPos = 0;
  let depth = 0;
  let valueStart = -1;
  let inString = false;
  let escapeNext = false;

  function push(chunk) {
    buffer += chunk;
    while (scanPos < buffer.length) {
      const ch = buffer[scanPos];

      if (valueStart === -1) {
        if (ch === '{' || ch === '[') {
          valueStart = scanPos;
          depth = 1;
          inString = false;
          escapeNext = false;
        }
        scanPos++;
        continue;
      }

      if (inString) {
        if (escapeNext) escapeNext = false;
        else if (ch === '\\') escapeNext = true;
        else if (ch === '"') inString = false;
        scanPos++;
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          const candidate = buffer.slice(valueStart, scanPos + 1);
          buffer = buffer.slice(scanPos + 1);
          scanPos = 0;
          valueStart = -1;
          try { onValue(JSON.parse(candidate)); } catch { /* malformed candidate — drop it, keep scanning */ }
          continue;
        }
      }
      scanPos++;
    }
  }

  return { push };
}
