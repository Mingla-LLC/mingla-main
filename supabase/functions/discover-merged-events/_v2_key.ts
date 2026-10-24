import type { DiscoverV2Request } from "./_v2_types.ts";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return [...value].sort();
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined && (!Array.isArray(item) || item.length > 0))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, normalize(item)]));
}
export function buildDiscoverV2Key(request: DiscoverV2Request, generation: string, timezone: string, currency: string): string {
  return `discover:v2:${JSON.stringify(normalize({
    gen: generation, op: request.op, kind: request.filters.kind,
    anchor: { name: request.anchor.name?.toLowerCase() ?? null, state: request.anchor.stateCode, country: request.anchor.countryCode, lat4: request.anchor.lat.toFixed(4), lng4: request.anchor.lng.toFixed(4), r: request.anchor.radiusKm },
    tz: timezone, currency, filters: request.filters.f, cursor: request.cursor ?? null,
    size: request.size ?? 20, bandsVersion: 1, radiusVersion: 1, tmHorizonDays: 120,
    tmSegmentMode: "all",
  }))}`;
}
