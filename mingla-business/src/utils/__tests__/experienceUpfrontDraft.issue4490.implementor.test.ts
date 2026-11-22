/**
 * N129 (#4490) — a new experience's up-front draft must be creatable before
 * the host names a price (biz_create_experience refuses a blank price name).
 *
 * Fails-on-revert: deleting the unnamed check fails U-1. [TEST-MOD-APPROVED #4490]
 * U-3 (the wizard's call goes through the filter): the source-text pins moved to the additive gate .github/scripts/strict-grep/issue-4490-host-wiring.mjs (I-PROPOSED-1047).
 */
import { upfrontDraftPayload } from "../experienceUpfrontDraft";

describe("N129 up-front experience draft", () => {
  it("U-1 unnamed price seeds are left out of the up-front draft", () => {
    const p = { title: "Arcade walk", price_options: [{ name: "", price_cents: 0 }, { name: "  ", price_cents: 500 }] };
    expect(upfrontDraftPayload(p)).toEqual({ title: "Arcade walk" });
  });

  it("U-2 named prices are kept, and a payload with no options is unchanged", () => {
    const named = { title: "x", price_options: [{ name: "Entry", price_cents: 500000 }] };
    expect(upfrontDraftPayload(named)).toBe(named);
    const none = { title: "x" };
    expect(upfrontDraftPayload(none)).toBe(none);
  });


});
