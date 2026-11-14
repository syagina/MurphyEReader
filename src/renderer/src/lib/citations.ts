export type CitationSegment =
  | { type: 'text'; text: string }
  | { type: 'cite'; pageNo: number };

const CITATION_PATTERN = /\[p\.(\d+)\]/g;

/**
 * Splits assistant text into plain text and `[p.N]` citation segments. Only the
 * exact lowercase `p` form is recognized; anything else stays literal text.
 */
export function parseCitations(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const index = match.index ?? lastIndex;
    if (index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, index) });
    }
    segments.push({ type: 'cite', pageNo: Number(match[1]) });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}
