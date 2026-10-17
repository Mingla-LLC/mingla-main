export type GuideCaptionCue = { start: number; end: number; text: string };

function seconds(value: string): number {
  const parts = value.replace(",", ".").split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

/** Small, dependency-free VTT parser shared by the player and its regressions. */
export function parseGuideCaptions(source: string): GuideCaptionCue[] {
  return source
    .replace(/^\uFEFF?WEBVTT[^\n]*\n/u, "")
    .split(/\n\s*\n/u)
    .map((block) => block.trim().split(/\r?\n/u))
    .map((lines) => {
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) return null;
      const [from, rawTo] = lines[timingIndex].split("-->").map((part) => part.trim());
      const to = rawTo.split(/\s+/u)[0];
      const text = lines.slice(timingIndex + 1).join(" ").replace(/<[^>]+>/gu, "").trim();
      return text ? { start: seconds(from), end: seconds(to), text } : null;
    })
    .filter((cue): cue is GuideCaptionCue => cue !== null);
}
