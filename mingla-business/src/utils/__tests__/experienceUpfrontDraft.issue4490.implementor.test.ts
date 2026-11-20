/**
 * N129 (#4490) — a new experience's up-front draft must be creatable before
 * the host names a price (biz_create_experience refuses a blank price name).
 *
 * Fails-on-revert: sending buildPayload(false) unfiltered from ensureDraft (or
 * deleting the unnamed check) fails U-1 / U-3.
 */
import { readFileSync } from "fs";
import path from "path";

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

  it("U-3 the wizard's up-front draft call goes through the filter", () => {
    const src = readFileSync(path.join(__dirname, "../../components/experience/ExperienceCreatorWizard.tsx"), "utf8");
    const call = src.slice(src.indexOf('supabase.rpc("biz_create_experience"'), src.indexOf('supabase.rpc("biz_create_experience"') + 600);
    expect(call).toMatch(/p_payload: upfrontDraftPayload\(buildPayload\(false\)\)/);
  });
});
