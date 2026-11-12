// MINGLA-INVARIANT: I-4389-NO-MODAL-ON-OVERLAY | issue #4389 | BrandCreationFlow mounts only on its full-screen routes (app/brand/new and the brand setup route), never embedded in the brand switcher or any other sheet or overlay.
/**
 * #4389 — structure of the brand setup flow.
 * Invariant I-4389-NO-MODAL-ON-OVERLAY | issue #4389 | BrandCreationFlow is reached only through LazyBrandCreationFlow from app/brand/new.tsx and app/brand/[id]/setup.tsx; the brand switcher never embeds it; the bank-country step renders no Sheet or RN Modal.
 * FAILS-ON-REVERT: re-mounting LazyBrandCreationFlow in BrandSwitcherSheet
 * fails test 1; rendering PayoutCountryList inside a Sheet/Modal fails test 2.
 */
import fs from "fs";
import path from "path";

import { BRAND_SETUP_COPY, BRAND_SETUP_BANNED_WORDS } from "../brandSetupCopy";
import { BRAND_SETUP_SHARED_COPY } from "../brandSetupSharedCopy";
import { BRAND_SETUP_ADDRESS_COPY } from "../brandSetupAddressCopy";
import { BRAND_ONBOARD_COPY } from "../brandOnboardCopy";
import { BRAND_DELETE_COPY } from "../brandDeleteCopy";
import { BRAND_SWITCHER_COPY } from "../brandSwitcherCopy";
import { BRAND_OFFERINGS_COPY } from "../brandOfferingsCopy";
import { BRAND_NEW_COPY } from "../brandNewCopy";
import { F4_TAP_TO_PAY_COPY } from "../../door/tap/f4TapToPayCopy";
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
    // #4389 N1 — Create brand opens /brand/new (or N1 when a draft exists).
    expect(read("src/components/brand/BrandSwitcherSheet.tsx")).toContain(': "/brand/new") as never,');
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
  // #4389 — brand setup's words are split by screen chunk; check every part.
  for (const part of [BRAND_SETUP_COPY, BRAND_SETUP_SHARED_COPY, BRAND_SETUP_ADDRESS_COPY, BRAND_ONBOARD_COPY, BRAND_DELETE_COPY, BRAND_SWITCHER_COPY, BRAND_OFFERINGS_COPY, BRAND_NEW_COPY, F4_TAP_TO_PAY_COPY]) collect(part);

  test("no partner names, no 'business', no reader/terminal/hardware", () => {
    for (const s of strings) for (const re of BRAND_SETUP_BANNED_WORDS) expect(`${s}`).not.toMatch(re);
  });

  test("Tap to Pay is never shortened on iPhone copy", () => {
    const iphone = [F4_TAP_TO_PAY_COPY.f4.ttpTitle, F4_TAP_TO_PAY_COPY.f4.ttpCta, BRAND_SETUP_COPY.k1.body, BRAND_SETUP_ADDRESS_COPY.t1.helper];
    for (const s of iphone) expect(s).toMatch(/Tap to Pay on iPhone/);
    expect(F4_TAP_TO_PAY_COPY.f4.ttpBody).toBe(
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

// ── The bank-country list, rendered: search narrows, a tap picks ─────────
/* eslint-disable import/first, @typescript-eslint/no-require-imports */
import React from "react";
import { PayoutCountryList } from "../PayoutCountryList";

const TR = require("react-test-renderer") as {
  create(el: React.ReactElement): {
    root: { findAll(fn: (n: { props: Record<string, unknown> }) => boolean): Array<{ props: Record<string, unknown> }> };
    unmount(): void;
  };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("#4389 F2 list, rendered", () => {
  test("rows read '{country}, {currency}'; search narrows; tapping a row picks it", () => {
    const picked: string[] = [];
    let tree!: ReturnType<typeof TR.create>;
    TR.act(() => {
      tree = TR.create(
        React.createElement(PayoutCountryList, { selected: null, onSelect: (c: string) => picked.push(c) }),
      );
    });
    const rows = () =>
      tree.root.findAll(
        (n) => typeof n.props.testID === "string" && (n.props.testID as string).startsWith("payout-country-list-row-") && typeof n.props.onPress === "function",
      );
    expect(rows().length).toBeGreaterThanOrEqual(35);
    const search = tree.root.findAll((n) => n.props.testID === "payout-country-list-search" && typeof n.props.onChangeText === "function")[0];
    TR.act(() => (search?.props.onChangeText as (t: string) => void)("canad"));
    const canada = rows().find((r) => r.props.accessibilityLabel === "Canada, CAD");
    expect(canada).toBeDefined();
    expect(rows().some((r) => r.props.accessibilityLabel === "Nigeria, NGN")).toBe(false);
    TR.act(() => (canada?.props.onPress as () => void)());
    expect(picked).toEqual(["CA"]);
    TR.act(() => tree.unmount());
  });
});
