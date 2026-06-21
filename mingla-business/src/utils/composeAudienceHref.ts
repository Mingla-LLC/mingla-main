/**
 * ORCH-1186-D / I-PROPOSED-BU: single source of truth for the marketing
 * composer deep-link. The composer pre-fill param shape
 * `?audience={kind}:{id}` is a BINDING CONTRACT with `parseAudienceParam`
 * (`src/hooks/marketing/parseAudienceParam.ts`). Do NOT inline a divergent URL
 * anywhere — build it through `buildComposeAudienceHref` so the round-trip
 * regression test (composeAudienceHref.test.ts) guards the shape.
 *
 * Pure, no RN/expo imports → jest-testable in isolation (mirrors
 * parseAudienceParam.ts). Reuses `AudienceKind` so the produced URL always
 * round-trips through the parser; the kind union is NOT widened here.
 */

import type { AudienceKind } from "../hooks/marketing/parseAudienceParam";

export function buildComposeAudienceHref(
  kind: AudienceKind,
  id: string,
): string {
  return `/marketing/campaigns/compose?audience=${kind}:${id}`;
}
