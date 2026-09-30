/**
 * Shared deterministic text metrics (server + client use the SAME counters,
 * so contract limits mean one thing everywhere).
 * Words = whitespace-separated Latin tokens + individual CJK characters.
 */
export function countWords(text: string): number {
  const cjk = text.match(/[぀-ヿ㐀-鿿豈-﫿]/g)?.length ?? 0;
  const latinTokens = text
    .replace(/[぀-ヿ㐀-鿿豈-﫿]/g, ' ')
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
  return cjk + latinTokens;
}

/**
 * PF-01.1 fix 3: the user's LOCAL calendar day, never UTC.
 * timeZone is injectable for deterministic boundary tests; at runtime the
 * browser's own zone applies.
 */
export function localTodayISO(now: Date = new Date(), timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    ...(timeZone ? { timeZone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
