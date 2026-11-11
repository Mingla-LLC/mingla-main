/**
 * #4389 — structure of the brand setup flow.
 * MINGLA-INVARIANT: I-4389-NO-MODAL-ON-OVERLAY | issue #4389 | BrandCreationFlow is reached only through LazyBrandCreationFlow from app/brand/new.tsx and app/brand/[id]/setup.tsx; the brand switcher never embeds it; the bank-country step renders no Sheet or RN Modal.
 * FAILS-ON-REVERT: re-mounting LazyBrandCreationFlow in BrandSwitcherSheet
 * fails test 1; rendering PayoutCountryList inside a Sheet/Modal fails test 2.
 */
import fs from "fs";
import path from "path";

import { BRAND_SETUP_COPY, BRAND_SETUP_BANNED_WORDS } from "../brandSetupCopy";
import { BRAND_SETUP_EVENTS } from "../brandSetupAnalytics";
import { PAYOUT_COUNTRY_OPTIONS, filterPayoutCountries, suggestedPayoutCountry } from "../PayoutCountryList";
import { tapAddressFromPlace, withBuildingNumber } from "../tapLocationAddress";
import { STRIPE_SUPPORTED_COUNTRIES } from "../../../constants/stripeSupportedCountries";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe("#4389 freeze designed out (U-1, SC-14)", () => {
  test("1 — only the two full-screen routes reach the setup flow", () => {
    const importers = [...walk("src"), ...walk("app")].filter((f) =>
      /LazyBrandCreationFlow\b|from "\.\/BrandCreationFlow"|BrandCreationFlow"\)/.test(read(f)) &&
      !f.endsWith("LazyBrandCreationFlow.tsx") && !f.endsWith("BrandCreationFlow.tsx")
    );
    expect(importers.sort()).toEqual(["app/brand/[id]/setup.tsx", "app/brand/new.tsx"]);
    expect(read("src/components/brand/BrandSwitcherSheet.tsx")).not.toMatch(/LazyBrandCreationFlow|BrandCreationFlow\b/);
    expect(read("src/components/brand/BrandSwitcherSheet.tsx")).toContain('router.push("/brand/new"');
  });

  test("2 — the bank-country step is inline: no Sheet or Modal in the list", () => {
    const list = read("src/components/brand/PayoutCountryList.tsx");
    expect(list).not.toMatch(/from "react-native"[^;]*\bModal\b/);
    expect(list).not.toMatch(/ui\/Sheet|SheetMobile|TopSheet/);
    const flow = read("src/components/brand/BrandCreationFlow.tsx");
    const country = flow.slice(flow.indexOf("const CountryStep"), flow.indexOf("const PayStep"));
    expect(country).toContain("<PayoutCountryList");
    expect(country).not.toMatch(/<Sheet|<Modal/);
  });

  test("3 — the shared sheets are untouched by this work", () => {
    for (const f of ["SheetMobile.tsx", "TopSheet.tsx", "useSheetGone.ts"]) {
      expect(fs.existsSync(path.join(ROOT, "src/components/ui", f))).toBe(true);
    }
  });
});

describe("#4389 copy rules (U-7, U-8, Apple naming)", () => {
  const strings: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string") strings.push(v);
    else if (typeof v === "function") strings.push(String((v as (...a: string[]) => string)("X", "Y")));
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect(BRAND_SETUP_COPY);

  test("no partner names, no 'business', no reader/terminal/hardware", () => {
    for (const s of strings) for (const re of BRAND_SETUP_BANNED_WORDS) expect(`${s}`).not.toMatch(re);
  });

  test("Tap to Pay is never shortened on iPhone copy", () => {
    const iphone = [BRAND_SETUP_COPY.f4.ttpTitle, BRAND_SETUP_COPY.f4.ttpCta, BRAND_SETUP_COPY.k1.body, BRAND_SETUP_COPY.t1.helper];
    for (const s of iphone) expect(s).toMatch(/Tap to Pay on iPhone/);
    expect(BRAND_SETUP_COPY.f4.ttpBody).toBe(
      "Accept physical debit and credit cards as well as Apple Pay and other digital wallets. Right on your iPhone.",
    );
  });
});

describe("#4389 analytics names are pinned", () => {
  test("exact event list", () => {
    expect([...BRAND_SETUP_EVENTS]).toEqual([
      "brand_setup_step_viewed", "brand_setup_step_completed", "brand_setup_free_only_chosen",
      "brand_setup_bank_now_chosen", "brand_draft_discarded", "brand_draft_continued", "ttp_home_card_shown",
      "ttp_home_card_cta", "ttp_home_card_not_now", "take_payment_opened", "take_payment_method_chosen",
      "ari_brand_switched", "door_sale_completed", "door_mode_opened",
    ]);
  });
});

describe("#4389 bank country list", () => {
  test("35 countries (34 card + Nigeria), BG in EUR, search and suggestion", () => {
    expect(PAYOUT_COUNTRY_OPTIONS).toHaveLength(STRIPE_SUPPORTED_COUNTRIES.length + 1);
    expect(PAYOUT_COUNTRY_OPTIONS.find((o) => o.country === "BG")?.currency).toBe("EUR");
    expect(filterPayoutCountries("nig").map((o) => o.country)).toEqual(["NG"]);
    expect(filterPayoutCountries("zzz")).toHaveLength(0);
    expect(suggestedPayoutCountry("en-GB")?.country).toBe("GB");
    expect(suggestedPayoutCountry("en-AU")).toBeNull();
  });
});

describe("#4389 T1 address from a picked place", () => {
  test("full US address, missing building number, wrong country", () => {
    const base = { city: "Chicago", regionCode: "IL", countryCode: "US", postalCode: "60622" };
    expect(tapAddressFromPlace({ ...base, line1: "1520 N Milwaukee Ave" }, "US")).toMatchObject({ ok: true, state: "IL" });
    const noNumber = tapAddressFromPlace({ ...base, line1: "N Milwaukee Ave" }, "US");
    expect(noNumber).toMatchObject({ ok: false, missing: "building_number" });
    expect(withBuildingNumber("N Milwaukee Ave", "1520")).toBe("1520 N Milwaukee Ave");
    expect(tapAddressFromPlace({ ...base, line1: "1 A St", countryCode: "GB" }, "US")).toMatchObject({ ok: false, missing: "wrong_country" });
  });
});
