/**
 * staticMapImage (app-mobile) — RE-EXPORT shim.
 *
 * ORCH-1162 Bug 2 (B.0): the builder lives in @mingla/offering-rendering so
 * there is exactly ONE buildStaticMapUrl owner across the trip / event /
 * experience public pages (I-PROPOSED-1162-MAP-PRIMITIVE-SINGLE-OWNER,
 * I-MOR-0827-PACKAGE-ISOLATION). Do NOT re-fork the implementation here.
 */
export { buildStaticMapUrl } from "@mingla/offering-rendering";
export type { StaticMapParams } from "@mingla/offering-rendering";
