// MINGLA-INVARIANT: I-CLAIM-KIND-PARITY | issue #4490 | the SQL claim CHECK, mint_claim_link, ClaimLinkKind, BuyerLinkKind and the app's CLAIM_KINDS / CLAIM_ROUTE_KINDS all carry the four venue claim kinds.
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
const root = new URL("../../../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, root));
const KINDS = ["venue_booking", "venue_membership", "venue_waitlist", "venue_till_sale"];
Deno.test("claim kinds agree across SQL, edge and app", () => {
  const sql = read("supabase/migrations/20281203334490_issue_4490_explorer_w1_handoff.sql");
  const check = sql.slice(sql.indexOf("claim_links_subject_kind_check"), sql.indexOf("));"));
  const guard = sql.slice(sql.indexOf("IF p_subject_kind NOT IN"), sql.indexOf("claim_kind_invalid', USING") > 0 ? undefined : sql.indexOf("OR p_subject_id IS NULL"));
  const claimTs = read("supabase/functions/_shared/claimLink.ts");
  const buyerTs = read("supabase/functions/_shared/messageLinks.ts");
  const app = read("app-mobile/src/services/attendanceClaimService.ts");
  const kinds = app.slice(app.indexOf("const CLAIM_KINDS"), app.indexOf("const CLAIM_OFFERING_TYPES"));
  for (const k of KINDS) {
    for (const [name, text] of [["CHECK", check], ["mint guard", guard], ["ClaimLinkKind", claimTs], ["BuyerLinkKind", buyerTs], ["app sets", kinds]]) {
      assert(text.includes(`'${k}'`) || text.includes(`"${k}"`), `${k} missing from ${name}`);
    }
  }
});
