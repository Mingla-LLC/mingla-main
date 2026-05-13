/**
 * Pure parser for the composer's `?audience={kind}:{uuid}` query param
 * (I-PROPOSED-BU). Extracted from useResolveAudience.ts so jest can test
 * it without pulling in supabase / RN modules through hooks transitives.
 */

export type AudienceKind = "brand" | "event";

export interface ParsedAudienceParam {
  kind: AudienceKind;
  id: string;
}

const KIND_RE = /^(brand|event):([0-9a-fA-F-]{36})$/;

export function parseAudienceParam(
  value: string | null | undefined,
): ParsedAudienceParam | null {
  if (typeof value !== "string") return null;
  const match = value.match(KIND_RE);
  if (match === null) return null;
  const kind = match[1] as AudienceKind;
  return { kind, id: match[2] };
}
