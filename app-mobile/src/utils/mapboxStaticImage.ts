/**
 * mapboxStaticImage (app-mobile) — RE-EXPORT shim.
 *
 * ORCH-1162 Bug 2 (B.0): the pure builder was PROMOTED into
 * @mingla/offering-rendering so there is exactly ONE buildStaticMapUrl owner across
 * the trip / event / experience public pages. app-mobile now imports it from the
 * @mingla/* package (NOT from mingla-business/src) — this preserves
 * I-MOR-0827-PACKAGE-ISOLATION and ends the prior byte-for-byte fork. The
 * existing in-app import path (ConsumerExperienceDetailScreen.tsx) keeps working
 * unchanged. Do NOT re-fork the implementation here
 * (I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER).
 */
export {
  buildStaticMapUrl,
  getPublicMapboxToken,
} from "@mingla/offering-rendering";
export type { StaticMapParams } from "@mingla/offering-rendering";
