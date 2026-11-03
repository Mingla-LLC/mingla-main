/**
 * #4238 retest-4 follow-ups:
 * P2-a  A Host read "canceling statement due to statement timeout": a
 *       service error's message is the server's detail, and plain-looking
 *       server text was shown as is. Only sentences the app owns are shown.
 * P3    The ad page, the "set aside" line and the Available credit card used
 *       "₦1,500,000.00"; they now use "NGN 1,500,000.00", and an ad that
 *       hasn't launched reads "NGN 1,500,000.00 budget", not "NGN 0.00 of …".
 *
 * FAILS ON REVERT: put back the "any plain sentence passes" branch in
 * hostAdErrorMessage, `spendCents: 0` on plan rows, or formatCurrency in the
 * detail line / credit card.
 */
import fs from "fs";
import path from "path";

import {
  HOST_AD_OWNED_ERROR_COPY,
  hostAdErrorMessage,
  hostAdVideoFailedMessage,
  hostAdVideoPendingMessage,
} from "../../components/marketing/ads/hostAdCopy";
import {
  buildHostAdList,
  hostAdDetailMoneyLine,
  hostAdListRowMoney,
} from "../hostAdLifecycle";
import { HostAdPlanError } from "../hostAdPlanService";
import type { HostAdPlanAggregate } from "../hostAdPlanService";

jest.mock("../supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

const FALLBACK = hostAdErrorMessage({});
const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("#4238 P2-a server text is never shown to a Host", () => {
  it.each([
    "canceling statement due to statement timeout",
    "permission denied for table ad_plans",
    "Your card could not be charged today",
    "Something went sideways on our side",
  ])("%s reads as the fallback", (text) => {
    expect(hostAdErrorMessage(new HostAdPlanError("plan_operation_failed", text))).toBe(FALLBACK);
    expect(hostAdErrorMessage({ code: "apply_failed", detail: text, message: text }, "The campaign could not launch.")).toBe(
      "The campaign could not launch.",
    );
  });

  it("the neutral server code reads as the fallback", () => {
    expect(
      hostAdErrorMessage(new HostAdPlanError("plan_operation_failed", "database_operation_failed")),
    ).toBe(FALLBACK);
  });

  it("every sentence the app owns is still shown as is", () => {
    for (const text of Object.values(HOST_AD_OWNED_ERROR_COPY)) {
      expect(hostAdErrorMessage(new HostAdPlanError("x", text))).toBe(text);
    }
    for (const platform of ["meta", "tiktok", "snapchat", "google", "reddit"]) {
      expect(hostAdErrorMessage(new HostAdPlanError("x", hostAdVideoFailedMessage(platform)))).toBe(
        hostAdVideoFailedMessage(platform),
      );
      expect(hostAdErrorMessage(new HostAdPlanError("x", hostAdVideoPendingMessage(platform)))).toBe(
        hostAdVideoPendingMessage(platform),
      );
    }
  });

  it("raised codes are still mapped to plain copy", () => {
    expect(hostAdErrorMessage(new HostAdPlanError("plan_operation_failed", "ad_plan_version_hash_mismatch"))).toBe(
      "This ad changed since you last looked. Go back to the review step and check it again.",
    );
  });

  it("every sentence the plan service throws comes from the owned copy", () => {
    const service = read("src/services/hostAdPlanService.ts");
    // A literal sentence in a HostAdPlanError would bypass the allowlist.
    expect(service).not.toMatch(/new HostAdPlanError\(\s*"[a-z_]+",\s*["`][A-Z]/);
  });
});

const planAggregate = (state: string): HostAdPlanAggregate =>
  ({
    plan: {
      id: `plan-${state}`,
      state,
      current_version_id: "v-1",
      destination_key: "event:femzy:deserted-island",
      review_required: false,
      review_reasons: [],
      updated_at: "2026-10-01T00:00:00.000Z",
      brand_id: "brand-a",
      owner_kind: "host",
    },
    version: {
      id: "v-1",
      plan_hash: "a".repeat(64),
      host_currency: "NGN",
      host_budget_cents: 150_000_000,
      canonical_plan: { name: "Deserted island" },
    },
    provider_allocations: [],
    targeting_snapshots: [],
    reviews: [],
    funding_hold: null,
    provider_attempts: [],
    campaigns: [],
  }) as HostAdPlanAggregate;

describe("#4238 P3 code-style money", () => {
  it.each(["ready_for_funding", "funded_held", "staff_approved", "staff_review_required"])(
    "a %s plan row reads as its budget only",
    (state) => {
      const [row] = buildHostAdList({ drafts: [], plans: [planAggregate(state)], campaigns: [] });
      expect(hostAdListRowMoney(row)).toBe("NGN 1,500,000.00 budget");
    },
  );

  it("the ad page line uses the code style once the ad is on the apps", () => {
    expect(
      hostAdDetailMoneyLine({ spentCents: 4_200_000, capCents: 150_000_000, currency: "NGN", planState: "live" }),
    ).toBe("Spent NGN 42,000.00 of your NGN 1,500,000.00 budget");
    expect(
      hostAdDetailMoneyLine({ spentCents: null, capCents: 150_000_000, currency: "NGN", planState: "live" }),
    ).toBe("NGN 1,500,000.00 set aside · we can't show spend in your currency yet");
  });

  it("an ad that hasn't launched names only its budget", () => {
    for (const planState of ["funded_held", "staff_approved", "staff_review_required"]) {
      expect(
        hostAdDetailMoneyLine({ spentCents: 0, capCents: 150_000_000, currency: "NGN", planState }),
      ).toBe("NGN 1,500,000.00 budget");
    }
  });

  it("no symbol-style money is left on the ad page top line or the credit card", () => {
    const detail = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(detail).not.toMatch(/Spent \$\{formatCurrency/);
    expect(detail).not.toMatch(/\$\{formatCurrency\(cap, currency, true\)\} set aside/);
    const index = read("src/screens/hostAds/HostAdListScreen.tsx");
    const card = index.slice(index.indexOf("Available credit"), index.indexOf("Top-ups keep"));
    expect(card).toContain("formatHostAdMoneyCents(balanceCents, currency)");
    for (const line of [
      hostAdDetailMoneyLine({ spentCents: 1, capCents: 2, currency: "NGN", planState: "live" }),
      hostAdListRowMoney(buildHostAdList({ drafts: [], plans: [planAggregate("funded_held")], campaigns: [] })[0]),
    ]) {
      expect(line).not.toMatch(/₦|\$/);
    }
  });
});
