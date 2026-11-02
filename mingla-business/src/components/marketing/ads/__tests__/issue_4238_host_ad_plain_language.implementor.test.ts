/**
 * #4238 — every Host ad screen and every Ari ad tool message uses plain words.
 *
 * invariant: {"id":"I-PROPOSED-HOST-AD-PLAIN-LANGUAGE","status":"DRAFT","issue":4238,"rule":"Host-visible ad text (Business ad screens, their helpers and Ari ad tool messages) never uses Mingla's internal words (provider, lane, immutable, hash, snapshot, widening, creative, delivery, ...) and never shows the plan hash; identifiers, testIDs and comments may.","gate":"this file"}
 *
 * Fails on revert: restoring any old sentence such as "Immutable plan hash",
 * "Provider estimates overlap" or "provider create returned no campaign id"
 * reds the scan with the file, line and word.
 */

import fs from "node:fs";
import path from "node:path";

import {
  hostAdErrorMessage,
  hostAdStatusLabel,
  hostAdTargetingNote,
  platformName,
} from "../hostAdCopy";
import { scanAriAdMessages, scanHostCopy } from "./hostAdPlainLanguageScan";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

const HOST_AD_FILES = [
  "app/(tabs)/marketing/ads/create.tsx",
  "app/(tabs)/marketing/ads/[id].tsx",
  "app/(tabs)/marketing/ads/index.tsx",
  "src/components/marketing/ads/HostAdPagePicker.tsx",
  "src/components/marketing/ads/HostAdCountryPicker.tsx",
  "src/components/marketing/ads/hostAdCopy.ts",
  "src/components/marketing/ads/hostAdCountries.ts",
  "src/components/marketing/ads/hostAdGoal.ts",
  "src/components/marketing/ads/hostAdPageLabels.ts",
  "src/components/marketing/ads/hostAdSetupCopy.ts",
  "src/components/marketing/AdCreditLedgerRow.tsx",
  "src/components/marketing/AdCreditQuoteSheet.tsx",
  "src/services/hostAdPlanService.ts",
  "src/services/hostAdCampaignService.ts",
  "src/services/hostAdLifecycle.ts",
  "src/services/adCreditService.ts",
  "src/utils/adVideoFit.ts",
  "src/utils/homeAdLifecycle.ts",
];

/** The ad-plan part of Ari's proposal card (other tools are out of scope). */
function adCardSource(): string {
  const card = read("src/components/ari/ToolProposalCard.tsx");
  const start = card.indexOf('if (toolName === "propose_ad_plan" || toolName === "approve_ad_plan") {');
  const end = card.indexOf("return out;", start);
  const assurance = card.indexOf("isAdPlanProposal\n                  ?");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  expect(assurance).toBeGreaterThan(-1);
  return `${card.slice(start, end)}\n${card.slice(assurance, card.indexOf(":", card.indexOf('"', assurance) + 1) + 1)}`;
}

describe("#4238 plain-language Host ad screens", () => {
  it("no Host ad screen or helper shows an internal word", () => {
    const hits = HOST_AD_FILES.flatMap((file) =>
      scanHostCopy(read(file), file).map(
        (hit) => `${file}:${hit.line} [${hit.word}] ${hit.text}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  it("Ari's ad proposal card shows no internal word", () => {
    const hits = scanHostCopy(adCardSource(), "ToolProposalCard.tsx").map(
      (hit) => `ToolProposalCard:${hit.line} [${hit.word}] ${hit.text}`,
    );
    expect(hits).toEqual([]);
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).not.toContain('label: "Plan binding"');
  });

  it("the facts Ari puts on its ad card are plain", () => {
    const ari = read("../supabase/functions/_shared/agentDomainTools.ts");
    const start = ari.indexOf('if (toolName === "propose_ad_plan") {', ari.indexOf("export async function preflightMoneyProposal("));
    const end = ari.indexOf('if (toolName === "cancel_trip_booking") {', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const hits = scanHostCopy(ari.slice(start, end), "ari-card.ts").map(
      (hit) => `ari-card:${hit.line} [${hit.word}] ${hit.text}`,
    );
    expect(hits).toEqual([]);
  });

  it("no Ari ad tool message shows an internal word", () => {
    const ari = read("../supabase/functions/_shared/agentDomainTools.ts");
    const start = ari.indexOf("function hostAdScheduleDays(");
    const end = ari.indexOf("const updateCampaignDraft = writeTool(");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const hits = scanAriAdMessages(ari.slice(start, end)).map(
      (hit) => `ari:${hit.line} [${hit.word}] ${hit.text}`,
    );
    expect(hits).toEqual([]);
  });

  it("the scan catches the old wording (self-test)", () => {
    const old = `const a = <Text>Immutable plan hash</Text>;
      setNotice("This provider can run a broader audience. Review the exact widening before accepting it.");
      // comments may say provider, hash and lane
      const b = <View testID="host-ad-provider-hash" />;`;
    expect(scanHostCopy(old, "old.tsx").map((hit) => hit.word.toLowerCase())).toEqual([
      "immutable",
      "provider",
    ]);
    expect(
      scanAriAdMessages(
        'throw new ToolError("RPC_FAILED", "provider create returned no campaign id");',
      ),
    ).toHaveLength(1);
  });

  it("never shows the plan hash, but still sends it to Mingla", () => {
    const create = read("app/(tabs)/marketing/ads/create.tsx");
    expect(create).not.toContain("{prepared.planHash}");
    expect(create).toContain("planHash: prepared.planHash");
    const service = read("src/services/hostAdPlanService.ts");
    expect(service).toContain("plan_hash: aggregate.version.plan_hash");
    expect(service).toContain("plan_hash: input.planHash");
  });

  it("keeps the typed confirmations and explains them", () => {
    const create = read("app/(tabs)/marketing/ads/create.tsx");
    const detail = read("app/(tabs)/marketing/ads/[id].tsx");
    expect(create).toContain('launchPhrase !== "LAUNCH"');
    expect(create).toContain("Type LAUNCH to start your ad.");
    expect(create).toContain('confirmText="CANCEL PLAN"');
    expect(detail).toContain('confirmText={destructiveAction === "end" ? "END" : "CANCEL"}');
    expect(detail).toContain("Type END to stop your ad on every app.");
  });

  it("names platforms the way Hosts know them", () => {
    expect(platformName("meta")).toBe("Facebook & Instagram");
    expect(platformName("tiktok")).toBe("TikTok");
    expect(hostAdStatusLabel("PARTIALLY_LIVE")).toBe("Running on some apps");
    expect(hostAdStatusLabel("staff_review_required")).toBe("Mingla is checking your ad");
  });

  it("translates targeting notes and errors into next steps", () => {
    expect(
      hostAdTargetingNote(
        "reddit",
        "broader",
        "Reddit cannot preserve city targeting; the selected countries are broader.",
        ["NG"],
      ),
    ).toBe("Reddit can't target cities, so it will show your ad across Nigeria. Accept that or turn Reddit off.");
    expect(
      hostAdTargetingNote("meta", "check_required", "Resolve Meta city keys for: Ikeja."),
    ).toBe("Facebook & Instagram couldn't find Ikeja. Remove it, or turn Facebook & Instagram off.");
    expect(hostAdErrorMessage({ code: "network", detail: "fetch failed" })).toBe(
      "We couldn't reach Mingla. Check your connection and try again.",
    );
    expect(
      hostAdErrorMessage({ code: "plan_preflight_failed", detail: "budget_below_minimum" }),
    ).toContain("Your daily budget is too low");
    expect(
      hostAdErrorMessage({ code: "validation_error", detail: "x", message: "Add a campaign name." }),
    ).toBe("Add a campaign name.");
    // Raw technical text never reaches a Host.
    expect(
      hostAdErrorMessage({ code: "boom", detail: "x", message: "provider_create_failed in lane business" }),
    ).toContain("Try again in a minute");
  });
});
