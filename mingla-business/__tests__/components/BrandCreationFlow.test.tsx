import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

jest.mock("../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Medium: "Medium" } }));

/* eslint-disable import/first */
import { OFFERING_OPTIONS, routeForOffering } from "../../src/components/brand/OfferingChooser";
/* eslint-enable import/first */

const repoRoot = path.resolve(__dirname, "../..");
const readBusinessFile = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// fails-on-revert verified at 6633be066 (original META-ORCH-0972 Sub-B pins).
//
// #4389 replaced the 5-step wizard (name + bio → address → cover → chooser)
// with the approved 4-step setup (design v11 / spec v2: F1 Name your brand →
// F2 Where will you collect funds? → F3 Get paid → F4 You're all set). The
// bio, address and cover steps and their copy were removed by that design, so
// each Sub-B invariant below now pins the approved behaviour that replaced it.
// The words moved out of the component into the English locale (#4389 i18n),
// which the flow reads through BRAND_SETUP_COPY.

const en = JSON.parse(
  readBusinessFile("src/i18n/locales/en/brandSetup.json"),
) as { brandSetup: Record<string, Record<string, string>> };
const copy = en.brandSetup;

describe("META-ORCH-0972 Sub-B BrandCreationFlow contract", () => {
  test("SC-B-1 keeps locked brand creation copy verbatim (design v11 words since #4389)", () => {
    const locked: [string, string, string][] = [
      ["f1", "title", "Name your brand"],
      ["f1", "label", "Brand name"],
      ["f1", "helper", "This is what guests see on tickets and your page."],
      ["f1", "cta", "Continue"],
      ["f2", "title", "Where will you collect funds?"],
      ["f2", "body", "Pick the country your bank account is in. Prices and payouts use its currency."],
      ["f2", "footnote", "Payouts go to a bank in {{country}}, in {{currency}}."],
      ["f3", "title", "Get paid"],
      ["f3", "stripeCta", "Continue to secure setup"],
      ["common", "later", "Save and finish later"],
      ["f4", "done", "You're all set."],
      ["f4", "makeFirst", "What do you want to make first?"],
    ];
    for (const [group, key, words] of locked) {
      expect(copy[group]?.[key]).toBe(words);
    }

    // The flow renders those keys, never hand-typed strings.
    const source = readBusinessFile("src/components/brand/BrandCreationFlow.tsx");
    for (const ref of [
      "{C.f1.title}",
      "{C.f1.label}",
      "label={C.f1.cta}",
      "{C.f2.title}",
      "{C.f2.body}",
      "C.f2.footnote(option.name, option.currency)",
      "{C.f3.title}",
      "label={C.common.later}",
      "headline={C.f4.makeFirst}",
    ]) {
      expect(source).toContain(ref);
    }
  });

  test("SC-B-2 skip address preserves a null brand address (address step removed by #4389)", () => {
    // There is no address step any more: create sends the name only, so a new
    // brand never gets an address it did not ask for. (The Tap to Pay address
    // is a separate, optional T1 screen.)
    const service = readBusinessFile("src/services/brandSetupService.ts");
    const create = service.slice(
      service.indexOf("export async function createSetupBrand"),
      service.indexOf("export interface PayoutCountrySaved"),
    );
    expect(create).toContain('supabase.rpc("biz_create_setup_brand", {');
    expect(create).not.toMatch(/address/i);

    // The step that replaced it can also be skipped: "Save and finish later"
    // on F2 opens K1 and writes nothing; "Free events only" marks the brand
    // free-only and leaves the bank country null.
    const source = readBusinessFile("src/components/brand/BrandCreationFlow.tsx");
    expect(source).toContain('onLater={() => setK1("country")}');
    const k1 = source.slice(source.indexOf("const K1Sheet"), source.indexOf("// ── N1"));
    expect(k1).toContain("useMarkBrandSetupFreeOnly(brandId)");
    expect(k1).not.toContain("useSetBrandPayoutCountry");
    expect(service).toContain('supabase.rpc("biz_mark_brand_setup_free_only", { p_brand_id: brandId })');
  });

  test("SC-B-5 welcome offering chooser routes to every creator", () => {
    const creationSource = readBusinessFile("src/components/brand/BrandCreationFlow.tsx");
    // F4 hands the pick straight to the creator route (replace: setup is done,
    // Back from the creator should not land on the finished setup).
    expect(creationSource).toContain("onSelect={(o) => router.replace(routeForOffering(o) as never)}");

    const routes = Object.fromEntries(
      OFFERING_OPTIONS.map((o) => [o.kind, routeForOffering(o.kind)]),
    );
    expect(routes).toEqual({
      event: "/event/create",
      experience: "/experience/create",
      trip: "/trip/create",
      rsvp: "/rsvp/create",
      venue: "/venue/create",
    });
  });
});
