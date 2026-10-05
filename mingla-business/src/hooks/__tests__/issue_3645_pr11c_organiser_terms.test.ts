/**
 * #3645 PR11c — Organiser Terms version parity + gate honesty.
 *
 * App CURRENT_MINGLA_TOS_VERSION must match the public marketing page version.
 * Gate copy must stay free of MoR / chargeback-absorb / event+3d payout lies
 * (#1180 + #3650 AC).
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  CURRENT_MINGLA_TOS_VERSION,
  ORGANISER_TERMS_URL,
} from "../../hooks/useMinglaToSAcceptance";

function marketingOrganiserTermsVersion(): string {
  const source = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "mingla-marketing",
      "lib",
      "organiserTermsContent.ts",
    ),
    "utf8",
  );
  const match = source.match(
    /export const ORGANISER_TERMS_VERSION\s*=\s*['"]([^'"]+)['"]/,
  );
  if (match === null) {
    throw new Error("ORGANISER_TERMS_VERSION not found in marketing content");
  }
  return match[1];
}

describe("#3645 PR11c — Organiser Terms version parity", () => {
  test("app CURRENT_MINGLA_TOS_VERSION matches marketing ORGANISER_TERMS_VERSION", () => {
    expect(CURRENT_MINGLA_TOS_VERSION).toBe(marketingOrganiserTermsVersion());
    expect(CURRENT_MINGLA_TOS_VERSION).toBe("1.0");
  });

  test("canonical public URL points at usemingla.com/organiser-terms", () => {
    expect(ORGANISER_TERMS_URL).toBe("https://usemingla.com/organiser-terms");
  });
});

describe("#3645 PR11c — gate honesty + publish wiring", () => {
  const gateSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "onboarding",
      "MinglaToSAcceptanceGate.tsx",
    ),
    "utf8",
  );
  const hookSource = readFileSync(
    join(__dirname, "..", "..", "hooks", "useMinglaToSAcceptance.ts"),
    "utf8",
  );
  const publishGateSource = readFileSync(
    join(__dirname, "..", "..", "hooks", "useOrganiserTermsPublishGate.ts"),
    "utf8",
  );
  const eventWizard = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "event",
      "EventCreatorWizard.tsx",
    ),
    "utf8",
  );
  const tripWizard = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "trip",
      "TripCreatorWizard.tsx",
    ),
    "utf8",
  );
  const experienceWizard = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "experience",
      "ExperienceCreatorWizard.tsx",
    ),
    "utf8",
  );
  const onboardSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "brand",
      "BrandOnboardView.tsx",
    ),
    "utf8",
  );
  const bankConnectSource = readFileSync(
    join(
      __dirname,
      "..",
      "..",
      "components",
      "brand",
      "BrandBankConnectBody.web.tsx",
    ),
    "utf8",
  );

  test("gate summary uses version-aware acceptance and public organiser-terms link", () => {
    expect(gateSource).toContain("isCurrentMinglaToSAccepted");
    expect(gateSource).toContain("ORGANISER_TERMS_URL");
    expect(gateSource).toContain("usemingla.com/organiser-terms");
    expect(gateSource).toContain("Accept Organiser Terms");
    expect(hookSource).toContain('CURRENT_MINGLA_TOS_VERSION = "1.0"');
  });

  test("gate copy stays free of MoR / absorb-chargebacks / event+3d payout lies", () => {
    const lower = gateSource.toLowerCase();
    expect(lower).not.toMatch(/merchant of record/);
    expect(lower).not.toMatch(/mingla (is|as) (the )?seller of record/);
    expect(lower).not.toMatch(/absorb[s]? chargebacks/);
    expect(lower).not.toMatch(/3 days after (the )?event/);
    expect(lower).not.toMatch(/three days after/);
    // #1180 honesty — about-a-day framing must remain.
    expect(gateSource).toContain("about a day after each payment");
  });

  test("paid publish wizards mount the shared Organiser Terms publish gate", () => {
    expect(publishGateSource).toContain("ORGANISER_TERMS_PUBLISH_RETRY_TOAST");
    expect(publishGateSource).toContain("tap Publish again");
    expect(publishGateSource).toContain("MinglaToSAcceptanceGate");
    expect(eventWizard).toContain("useOrganiserTermsPublishGate");
    expect(eventWizard).toContain("blockPaidPublishUntilAccepted");
    expect(tripWizard).toContain("useOrganiserTermsPublishGate");
    expect(experienceWizard).toContain("useOrganiserTermsPublishGate");
  });

  test("Paystack onboard + web bank connect require Organiser Terms before bank form", () => {
    expect(onboardSource).toContain("paystackSelected && tosPassed");
    expect(onboardSource).toContain("MinglaToSAcceptanceGate");
    expect(bankConnectSource).toContain("MinglaToSAcceptanceGate");
    expect(bankConnectSource).toContain("ORGANISER_TERMS_URL");
    expect(bankConnectSource).toContain("tosPassed");
  });
});
