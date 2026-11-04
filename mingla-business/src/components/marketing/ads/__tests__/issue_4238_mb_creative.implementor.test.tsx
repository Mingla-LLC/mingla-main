/**
 * #4238 media-buyer, wave C — button, per-app counters (never cut), preview
 * per app and placement, read-only tracking tags, and no silent cut in the
 * Host payload.
 */
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type RenderNode = { props: Record<string, unknown>; type: unknown; children: (RenderNode | string)[] };
type Renderer = { root: { findAll: (p: (n: RenderNode) => boolean) => RenderNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (cb: () => void | Promise<void>) => Promise<void> | void;
  create: (el: React.ReactElement) => Renderer;
};
jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { HostAdCtaPicker, HostAdPreview, HostAdTextCounters, HostAdUtmTags } from "../HostAdCreativeExtras";
// eslint-disable-next-line import/first
import { HostAdBudgetPanel } from "../HostAdBudgetPanel";
// eslint-disable-next-line import/first
import { hostAdSplitWithMinimums } from "../hostAdBudget";
// eslint-disable-next-line import/first
import { hostAdCopyError, hostAdTextCounts, hostAdUtmLines, hostAdUtmSlug } from "../hostAdCreativeRules";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain } from "../hostAdCopy";
// eslint-disable-next-line import/first
import { providerCreatePayload, type HostAdPlanAggregate } from "../../../../services/hostAdPlanService";

const textOf = (n: RenderNode | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
const allText = (r: Renderer): string =>
  r.root.findAll((n) => n.type === "Text").map(textOf).join(" | ");
const press = (r: Renderer, id: string): void =>
  (r.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0].props.onPress as () => void)();

describe("#4238 wave C — words", () => {
  it("counters are per app and an over-limit word blocks plainly; nothing is cut", () => {
    const long = "x".repeat(110);
    const counts = hostAdTextCounts(["tiktok", "snapchat", "meta"], { primary: long, headline: "Sunday Rooftop Sessions at the pier" });
    expect(counts.find((c) => c.platform === "tiktok")?.line).toBe(
      "TikTok: 110/100. Shorten the ad text to 100 characters, or turn TikTok off.",
    );
    expect(counts.find((c) => c.platform === "snapchat" && c.field === "headline")?.over).toBe(true);
    // Meta's 125 is a soft limit: shown, never blocking.
    expect(hostAdCopyError(["meta"], { primary: "y".repeat(200), headline: "ok" })).toBeNull();
    expect(hostAdCopyError(["tiktok"], { primary: long, headline: "ok" })).toContain("Shorten the ad text");
    for (const c of counts) expect(hostAdCopyIsPlain(c.line)).toBe(true);
  });

  it("the Host payload sends the words whole (no slice) and no client button", () => {
    const words = "A".repeat(99);
    const aggregate = {
      plan: { brand_id: "b", id: "p", state: "funded_held" },
      version: {
        id: "v",
        plan_hash: "h".repeat(64),
        canonical_plan: {
          name: "Sunday",
          copy: { primary: words, headline: "Thirty four characters headline!!" },
          creative_library_id: "c",
          destination: { page_type: "event", brand_slug: "b", entity_slug: "e" },
          delivery_budgets: {},
        },
      },
      targeting_snapshots: ["tiktok", "snapchat", "meta"].map((platform) => ({
        platform, audience_intent: { countries: ["NG"] }, compiled_targeting: {},
      })),
      provider_allocations: [],
    } as unknown as HostAdPlanAggregate;
    const tiktok = providerCreatePayload(aggregate, { platform: "tiktok" });
    expect((tiktok.creative as Record<string, unknown>).ad_text).toBe(words);
    const snap = providerCreatePayload(aggregate, { platform: "snapchat" });
    expect((snap.creative as Record<string, unknown>).headline).toBe("Thirty four characters headline!!");
    const meta = providerCreatePayload(aggregate, { platform: "meta" });
    expect((meta.creative as Record<string, unknown>).call_to_action_type).toBeUndefined();
  });

  it("tracking tags are the standard ones, read-only", async () => {
    expect(hostAdUtmSlug("Sunday Rooftop Sessions!")).toBe("sunday-rooftop-sessions");
    expect(hostAdUtmLines(["meta"], "Sunday Rooftop Sessions")).toEqual([
      "Facebook & Instagram: utm_source=facebook&utm_medium=paid_social&utm_campaign=sunday-rooftop-sessions",
    ]);
    let r!: Renderer;
    await act(() => { r = create(<HostAdUtmTags apps={["tiktok"]} adName="Sunday" />); });
    await act(() => press(r, "host-ad-utm-toggle"));
    expect(allText(r)).toContain("utm_source=tiktok&utm_medium=paid_social&utm_campaign=sunday");
  });
});

describe("#4238 wave C — button and preview", () => {
  it("the four buttons, and each app's own wording in the preview", async () => {
    const onChange = jest.fn();
    let r!: Renderer;
    await act(() => { r = create(<HostAdCtaPicker value="tickets" onChange={onChange} apps={["meta", "google"]} />); });
    expect(allText(r)).toContain("Get tickets | Book now | Sign up | Learn more");
    expect(allText(r)).toContain("Google ads have no button");
    await act(() => press(r, "host-ad-cta-book"));
    expect(onChange).toHaveBeenCalledWith("book");

    await act(() => {
      r = create(
        <HostAdPreview apps={["meta", "snapchat"]} posterUrl={null} brandName="Harmattan" primary={"z".repeat(130)} headline="Sunday" cta="learn" />,
      );
    });
    expect(allText(r)).toContain("Learn more");
    expect(allText(r)).toContain("… See more");
    await act(() => press(r, "host-ad-preview-place-story"));
    await act(() => press(r, "host-ad-preview-app-snapchat"));
    // Snapchat's own "Learn more" button reads "More".
    expect(textOf(r.root.findAll((n) => n.props.testID === "host-ad-preview-button")[0])).toBe("More");
  });
});

describe("#4238 wave C — budget panel", () => {
  it("shows each app's minimum, the recommended amount and how spending works", async () => {
    const split = hostAdSplitWithMinimums(90_000_00, ["meta", "tiktok"], { meta: 2_000_00, tiktok: 78_000_00 });
    const onUse = jest.fn();
    let r!: Renderer;
    await act(() => {
      r = create(
        <HostAdBudgetPanel mode="total" onMode={jest.fn()} currency="NGN" days={34} split={split} dailyTotalCents={90_000_00} onUseRecommended={onUse} />,
      );
    });
    const text = allText(r);
    expect(text).toContain("About NGN 90,000.00 a day for 34 days.");
    // NGN 80,000 of minimums, then NGN 10,000 shared evenly.
    expect(text).toContain("TikTok: NGN 83,000.00 a day · needs at least NGN 78,000.00");
    await act(() => press(r, "host-ad-budget-recommended"));
    expect(onUse).toHaveBeenCalledWith(130_000_00);
    await act(() => press(r, "host-ad-budget-explain"));
    expect(allText(r)).toContain("Each app gets its minimum first");
    expect(hostAdCopyIsPlain(allText(r))).toBe(true);
  });
});
