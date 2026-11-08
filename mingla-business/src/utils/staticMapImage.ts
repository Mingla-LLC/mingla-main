/**
 * staticMapImage (mingla-business) — RE-EXPORT shim.
 *
 * ORCH-1162 Bug 2: the builder lives in @mingla/offering-rendering so there is
 * exactly ONE buildStaticMapUrl owner (I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER).
 * Do NOT re-fork the implementation here.
 */
export { buildStaticMapUrl } from "@mingla/offering-rendering";
export type { StaticMapParams } from "@mingla/offering-rendering";
