import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1331 [partner Paystack payout rail] — implementor happy-path client
 * suite (T-15 badge + labels, T-16 picker + NG fork), following the
 * established mingla-business CI pattern (ts-jest, node env, source-assertion
 * — see orch_1057_ari_composer_icons_emptystate.test.ts).
 *
 * DESIGN_ORCH-1331_PARTNER_PAYSTACK_UI.md binds the §1.4 picker-replacement
 * flow, the §3.2 state machine, and the §7 copy strings VERBATIM — each
 * assertion below targets a string/structure that exists ONLY after the
 * ORCH-1331 build, so reverting any file flips its assertions red.
 */

const BUSINESS_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(BUSINESS_ROOT, rel), "utf8");

const earnings = read("app/partner/earnings.tsx");
const brands = read("app/partner/brands.tsx");
const form = read("src/components/partner/PartnerPaystackOnboardForm.tsx");
const splitsService = read("src/services/partnerSplitsService.ts");
const linksService = read("src/services/partnerBrandLinksService.ts");
const stripeCountries = read("src/constants/stripeSupportedCountries.ts");

describe("ORCH-1331 · T-15 — badge + provider-neutral labels", () => {
  it("earnings StatusBadge maps blocked_no_paystack → 'Blocked — Paystack' (error tint)", () => {
    expect(earnings).toMatch(
      /blocked_no_paystack:\s*\{\s*label:\s*"Blocked — Paystack",\s*color:\s*semantic\.error,\s*bg:\s*semantic\.errorTint\s*\}/,
    );
  });

  it("partnerSplitsService type union carries blocked_no_paystack + provider select", () => {
    expect(splitsService).toMatch(/\|\s*"blocked_no_paystack"/);
    expect(splitsService).toMatch(/provider\?:\s*"stripe"\s*\|\s*"paystack"/);
    expect(splitsService).toMatch(/reversed_at,\s*provider"/);
  });

  it("brands labels are provider-neutral: 'Awaiting payouts' + 'Payouts connected'", () => {
    expect(brands).toContain('return "Awaiting payouts";');
    expect(brands).toContain('"Payouts connected"');
    expect(brands).not.toContain('"Awaiting Stripe"');
    expect(brands).not.toContain('"Stripe connected"');
  });

  it("the internal status VALUE awaiting_stripe is untouched (I-PROPOSED-1331-LINK-COLUMNS-FROZEN)", () => {
    expect(brands).toContain('case "awaiting_stripe":');
    // deriveLinkStatus still reads owner_stripe_connected_at by NAME.
    expect(linksService).toContain("owner_stripe_connected_at");
    expect(linksService).toContain("awaiting_stripe");
  });
});

describe("ORCH-1331 · T-16 — picker extraOptions + NG fork (design §1.4)", () => {
  it("Nigeria rides the picker's extraOptions slot (never the Stripe allowlist)", () => {
    expect(earnings).toMatch(
      /extraOptions=\{\[\s*\{\s*code:\s*"NG",\s*name:\s*"Nigeria",\s*currency:\s*"NGN",\s*sublabel:\s*"Paystack"\s*\},?\s*\]\}/,
    );
    // SC-13 — NG never enters the canonical Stripe allowlist.
    expect(stripeCountries).not.toMatch(/["']NG["']/);
  });

  it("NG fork replaces the not-connected card with PartnerPaystackOnboardForm (picker not rendered)", () => {
    expect(earnings).toMatch(
      /selectedCountry === "NG" && !paystackConnected\)\s*\{\s*return\s*\(\s*<PartnerPaystackOnboardForm/,
    );
  });

  it("onCancel clears the country AND re-opens the picker sheet via defaultOpen", () => {
    expect(earnings).toContain("setSelectedCountry(null);");
    expect(earnings).toContain("setReopenPickerOnReturn(true);");
    expect(earnings).toMatch(/defaultOpen=\{reopenPicker\}/);
  });

  it("country lock derives from EITHER active rail (design §2 row 4)", () => {
    expect(earnings).toMatch(
      /countryLocked = stripeAccountStatus !== "not_connected" \|\|\s*paystackConnected/,
    );
  });

  it("PAYOUTS READY (Paystack) card renders in the StatusBlock slot with the bound copy", () => {
    expect(earnings).toContain('testID="partner-paystack-ready-card"');
    expect(earnings).toContain(">PAYOUTS READY</Text>");
    expect(earnings).toContain("Account holder:");
    expect(earnings).toContain('accessibilityLabel="Disconnect Nigerian bank account"');
    // C15 — disconnect confirm alert strings.
    expect(earnings).toContain('"Disconnect bank?"');
    expect(earnings).toContain(
      "Your bank account will be unlinked from Mingla partner payouts.",
    );
  });

  it("C18 — copy generalizations shipped ('connect payouts' / 'payouts are connected')", () => {
    expect(earnings).toContain(
      "once they connect payouts and sell their first ticket.",
    );
    expect(earnings).toContain(
      "as soon as their payouts are connected and tickets sell.",
    );
    expect(earnings).not.toContain(
      "once they connect Stripe and sell their first ticket.",
    );
    expect(earnings).not.toContain(
      "as soon as their Stripe is connected and tickets sell.",
    );
  });

  it("the earnings scroll body rides the canonical SmartScrollView wrapper with persistTaps", () => {
    // [TEST-MOD-APPROVED ORCH-1331] CI conformance rework 2 (ORCH-0892 +
    // ORCH-1296): keyboard avoidance is owned by the SANCTIONED SmartScrollView
    // wrapper (native = KeyboardAwareScrollView inside the ORCH-1296-safelisted
    // .native file; web = plain RN ScrollView). No bespoke KAV plumbing and no
    // top-level keyboard-controller import may reappear in this route file.
    expect(earnings).toMatch(
      /import \{ ScrollView \} from "[^"]*wrappers\/SmartScrollView"/,
    );
    expect(earnings).not.toMatch(
      /import[^;]*from\s+"react-native-keyboard-controller"/,
    );
    expect(earnings).not.toMatch(/\bKeyboardAvoidingView\b/);
    // ScrollView must NOT also come from react-native (single owner).
    expect(earnings).not.toMatch(
      /import \{[^}]*\bScrollView\b[^}]*\} from "react-native"/,
    );
    expect(earnings).toContain('keyboardShouldPersistTaps="handled"');
    expect(earnings).toContain('keyboardDismissMode="on-drag"');
  });

  it("the form carries NO keyboard plumbing: no keyboard-controller import, no KAV, plain modal shell (ORCH-0892/1296)", () => {
    // [TEST-MOD-APPROVED ORCH-1331] CI conformance rework 2: the bespoke lazy
    // KAV loader is DELETED (ORCH-0892 flags KeyboardAvoidingView-from-
    // react-native; ORCH-1296 flags the static library import). The modal
    // shell is a plain View; keyboard handling = host screen SmartScrollView
    // + the ORCH-1165 keyed Done-bar clearance on the bank list.
    const fs = require("node:fs");
    const path = require("node:path");
    expect(
      fs.existsSync(
        path.join(
          BUSINESS_ROOT,
          "src/components/partner/lazyKeyboardAvoidingView.tsx",
        ),
      ),
    ).toBe(false);
    expect(form).not.toMatch(
      /import[^;]*from\s+"react-native-keyboard-controller"/,
    );
    expect(form).not.toMatch(/\bKeyboardAvoidingView\b/);
    expect(form).toMatch(/<View style=\{styles\.modalRoot\}>/);
  });
});

describe("ORCH-1331 · PartnerPaystackOnboardForm — design §3 contract", () => {
  it("copy master strings are verbatim (C2/C3/C4/C8/C9/C11)", () => {
    expect(form).toContain(">Get paid in Nigeria</Text>");
    expect(form).toContain(
      "Connect your bank account to receive your partner earnings. Splits are",
    );
    expect(form).toContain("paid in NGN directly to this account.");
    expect(form).toContain("ll only be able to partner with");
    expect(form).toContain(
      "We keep only the last 4 digits of your account number.",
    );
    expect(form).toContain('"Verify account"');
    expect(form).toContain('"Verifying…"');
    expect(form).toContain('"Connect bank & get paid"');
    expect(form).toContain('"Connecting…"');
    expect(form).toContain(
      "Make sure this is you — payouts go to this account.",
    );
    expect(form).toContain('label="‹ Choose a different country"');
  });

  it("state 8 BINDING — connect CTA holds loading through isSuccess (no flash back)", () => {
    expect(form).toMatch(
      /const connecting = submitMutation\.isPending \|\|\s*submitMutation\.isSuccess/,
    );
  });

  it("re-editing digits or re-picking the bank invalidates the verification", () => {
    expect(form).toMatch(
      /const onAccountChange[\s\S]*?if \(resolvedName !== null\) setResolvedName\(null\);/,
    );
    expect(form).toMatch(
      /const onPickBank[\s\S]*?if \(resolvedName !== null\) setResolvedName\(null\);/,
    );
  });

  it("bank sheet keeps the ORCH-1165 keyboard hardening (42dp clearance, opaque fill, dedupe)", () => {
    // [TEST-MOD-APPROVED ORCH-1331] rework 2: the KAV (and its
    // keyboardVerticalOffset) is gone per ORCH-0892; the keyed 42dp Done-bar
    // clearance on the list remains the hardening contract.
    expect(form).toContain("paddingBottom: 42");
    expect(form).toContain('"#14110f"');
    expect(form).toMatch(/seen\.has\(b\.code\)/); // dedupe-by-code
    expect(form).toContain("useKeyboardIsVisible");
  });

  it("error taxonomy maps the bound strings (E1/E3/E5)", () => {
    expect(form).toContain(
      "We couldn't verify that account. Check the number and bank, then try again.",
    );
    expect(form).toContain(
      "You already have a Stripe payout account. Disconnect it first, then connect your Nigerian bank.",
    );
    expect(form).toContain(
      "Couldn't load the bank list. Check your connection and try again.",
    );
    expect(form).toContain('message.includes("stripe_already_connected")');
    expect(form).toContain('message.includes("account_unresolved")');
  });

  it("test hooks — the design §12 testIDs exist", () => {
    for (
      const id of [
        "partner-paystack-form",
        "partner-paystack-bank-field",
        "partner-paystack-account-input",
        "partner-paystack-verify-cta",
        "partner-paystack-connect-cta",
        "partner-paystack-confirm-name",
      ]
    ) {
      expect(form).toContain(`testID="${id}"`);
    }
    expect(earnings).toContain('testID="partner-paystack-disconnect"');
  });

  it("a11y — live regions + labeled pressables (I-38/I-39)", () => {
    expect(form).toMatch(/accessibilityLiveRegion="polite"/);
    expect(form).toContain('accessibilityLabel="Bank account number"');
    expect(form).toContain("`Bank: ${bankName}, tap to change`");
    expect(form).toContain('accessibilityLabel="Close bank picker"');
    expect(form).toContain('accessibilityLabel="Search banks"');
  });

  it("motion — confirm-name entrance gates on useReducedMotion (design §6)", () => {
    expect(form).toContain("useReducedMotion");
    expect(form).toMatch(/withTiming\(1,\s*\{\s*duration:\s*durations\.normal/);
  });

  it("the frozen picker/brand-view components are NOT imported by the form", () => {
    // Doc comments cite the brand twin by name; the IMPORT graph must not.
    expect(form).not.toMatch(/import[\s\S]{0,120}BrandStripeCountryPicker/);
    expect(form).not.toMatch(/import[\s\S]{0,120}BrandPaystackOnboardView/);
    expect(form).not.toMatch(/from\s+["'][^"']*Brand(StripeCountryPicker|PaystackOnboardView)["']/);
  });
});
