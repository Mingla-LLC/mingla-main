/** Keep public roadmap summaries compact without cutting through a word. */
export function truncateRoadmapBlurb(value: string | null, max = 140): string {
  const normalized = (value ?? "").trim();
  if (normalized.length <= max) return normalized;
  const bounded = normalized.slice(0, max + 1);
  const lastSpace = bounded.lastIndexOf(" ");
  return `${bounded.slice(0, lastSpace > 0 ? lastSpace : max).trim()}…`;
}
