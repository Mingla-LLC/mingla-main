/**
 * #4389 (Seth) — F3 for Nigeria had a "Your Nigerian bank" label above the
 * bank card, repeating what the card's own fields say. The heading is gone
 * (and its string from every locale); the card keeps an accessibilityLabel
 * ("Bank details") so screen readers keep the context.
 *
 * FAILS ON REVERT: bring back the visible heading → T1; drop the card label → T1.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import React from "react";

import {
  BrandCreationFlow,
  allText,
  byLabel,
  byTestId,
  checklistAt,
  harness,
  mount,
  press,
  resetHarness,
  unmountAll,
  TestRenderer,
} from "./issue4389FlowHarness";
import { BRAND_SETUP_COPY as C } from "../brandSetupCopy";

const ID = "43890000-0000-4000-8000-0000000000a9";

describe("#4389 — the Nigerian bank card has no redundant heading", () => {
  beforeEach(() => resetHarness());
  afterEach(() => unmountAll());

  test("T1: after Continue on F3 (Nigeria) the card shows without 'Your Nigerian bank', labelled 'Bank details'", async () => {
    harness.checklist = checklistAt("pay", { provider: "paystack", payoutCountry: "NG", currency: "NGN", terms: true });
    const t = await mount(<BrandCreationFlow brandId={ID} onExit={() => undefined} />);
    await press(byTestId(t, "brand-setup-pay-continue")[0]);
    await TestRenderer.act(async () => {
      for (let i = 0; i < 5; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
    });
    const card = byTestId(t, "brand-setup-ng-bank-card");
    expect(card).toHaveLength(1);
    expect(card[0]?.props.accessibilityLabel).toBe("Bank details");
    expect(byLabel(t, "Bank details")).toHaveLength(1);
    expect(allText(t)).not.toContain("Your Nigerian bank");
    expect(C.f3.ngCardLabel).toBe("Bank details");
  });

  test("T2: the old string is gone from every locale", () => {
    const base = path.join(__dirname, "../../../i18n/locales");
    for (const lang of fs.readdirSync(base)) {
      for (const file of fs.readdirSync(path.join(base, lang))) {
        const text = fs.readFileSync(path.join(base, lang, file), "utf8");
        expect(text).not.toContain("\"ngHeading\"");
      }
      const setup = lang === "en" ? "brandSetup.json" : "hostSetup.json";
      expect(fs.readFileSync(path.join(base, lang, setup), "utf8")).toContain("\"ngCardLabel\"");
    }
  });
});
