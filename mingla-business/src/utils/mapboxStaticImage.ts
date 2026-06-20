/**
 * mapboxStaticImage (mingla-business) — RE-EXPORT shim.
 *
 * ORCH-1162 Bug 2 (B.0): the pure builder was PROMOTED into
 * @mingla/offering-rendering so there is exactly ONE buildStaticMapUrl owner across
 * the trip / event / experience public pages. This module re-exports it so the
 * existing in-app import paths (TripPreview.tsx, ExperiencePreview.tsx) keep
 * working unchanged. Do NOT re-fork the implementation here
 * (I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER).
 */
export {
  buildStaticMapUrl,
  getPublicMapboxToken,
} from "@mingla/offering-rendering";
export type { StaticMapParams } from "@mingla/offering-rendering";
