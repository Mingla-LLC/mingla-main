/**
 * #4238 media-buyer, wave D — the live edit card (money moves said up
 * front, once a day) and Duplicate (same setup as a new draft).
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
jest.mock("../../../ui/Input", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Input: (props: Record<string, unknown>) => require("react").createElement("TextInput", props),
}));
jest.mock("../../../ui/DateField", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DateField: (props: Record<string, unknown>) => require("react").createElement("DateField", props),
}));
jest.mock("../../../ui/Button", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Button: (props: Record<string, unknown>) => require("react").createElement("Button", props),
}));

// eslint-disable-next-line import/first
import { HostAdLiveEditCard, hostAdLiveEditDoneNote, hostAdLiveEditError } from "../HostAdLiveEditCard";
// eslint-disable-next-line import/first
import { hostAdDraftFromPlan, type HostAdPlanAggregate } from "../../../../services/hostAdPlanService";
// eslint-disable-next-line import/first
import { hostAdCopyIsPlain } from "../hostAdCopy";

const textOf = (n: RenderNode | string): string => (typeof n === "string" ? n : n.children.map(textOf).join(""));
const allText = (r: Renderer): string => r.root.findAll((n) => n.type === "Text").map(textOf).join(" | ");
const byId = (r: Renderer, id: string) => r.root.findAll((n) => n.props.testID === id)[0];

describe("#4238 wave D — edit budget and end date", () => {
  const base = {
    currency: "NGN",
    currentTotalCents: 5_000_000_00,
    spentCents: 610_000_00,
    currentEndsAt: "2026-12-06T22:59:00Z",
    timezone: "Africa/Lagos",
    nowIso: "2026-11-08T10:00:00Z",
    busy: false,
  };
  it("says what moves before saving, and sends only what changed", async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    let r!: Renderer;
    await act(() => { r = create(<HostAdLiveEditCard {...base} lastEditAt={null} onSubmit={onSubmit} />); });
    await act(() => (byId(r, "host-ad-live-edit-open").props.onPress as () => void)());
    await act(() => (byId(r, "host-ad-live-edit-total").props.onChangeText as (v: string) => void)("6000000"));
    expect(allText(r)).toContain("We'll set aside NGN 1,000,000.00 more from your Ads credit now.");
    await act(() => (byId(r, "host-ad-live-edit-total").props.onChangeText as (v: string) => void)("4000000"));
    expect(allText(r)).toContain("NGN 1,000,000.00 goes back to your Ads credit now.");
    await act(() => (byId(r, "host-ad-live-edit-save").props.onPress as () => void)());
    expect(onSubmit).toHaveBeenCalledWith({ newBudgetCents: 4_000_000_00, newEndsAt: null });
    expect(hostAdCopyIsPlain(allText(r))).toBe(true);
  });
  it("is locked for a day after a change", async () => {
    let r!: Renderer;
    await act(() => { r = create(<HostAdLiveEditCard {...base} lastEditAt="2026-11-08T01:00:00Z" onSubmit={jest.fn()} />); });
    expect(byId(r, "host-ad-live-edit-open").props.disabled).toBe(true);
    expect(allText(r)).toContain("You changed this ad in the last day.");
  });
  it("names refusals plainly", () => {
    expect(hostAdLiveEditError("host_ad_live_edit_once_a_day")).toBe("You can change this ad once a day. Try again tomorrow.");
    expect(hostAdLiveEditError("host_ad_live_edit_end_after_last_bookable")).toContain("last day people can book");
    expect(hostAdLiveEditDoneNote({ daily_not_pushed: ["google"], end_not_pushed: [] })).toBe(
      "Your ad is updated. Google keep their daily amount; Mingla stops them at your new total.",
    );
  });
});

describe("#4238 wave D — Duplicate", () => {
  it("copies the setup into a new draft: Copy of, no dates, rights to confirm again", () => {
    const aggregate = {
      plan: { id: "p1", brand_id: "b", state: "live" },
      version: {
        id: "v", plan_hash: "h",
        canonical_plan: {
          name: "Sunday Rooftop",
          destination: { page_type: "event", brand_slug: "harmattan", entity_slug: "sunday" },
          audience_intent: { countries: ["NG"], ageMin: 21, ageMax: 45, gender: "all", languages: ["en"] },
          targeting_selection: { places: [{ name: "Lagos", countryCode: "NG", radiusKm: 20, refs: { meta: "1" } }], excluded: [], interests: [] },
          copy: { primary: "Sunsets", headline: "Sunday" },
          creative_library_id: "c",
          media_rights: { rights_basis: "owned", ai_generated: false },
          audience_selection: { include_keys: [], exclude_keys: ["brand:b:guests"] },
          call_to_action: "tickets",
          budget_mode: "total",
          delivery_budgets: { meta: { host_amount_cents: 150_000_00 } },
          optimization_by_platform: { meta: "sales" },
        },
      },
      provider_allocations: [{ platform: "meta", connection_id: "k", host_budget_cents: 5_000_000_00 }],
      targeting_snapshots: [],
    } as unknown as HostAdPlanAggregate;
    const draft = hostAdDraftFromPlan(aggregate);
    expect(draft).toMatchObject({
      page_key: "event:harmattan:sunday",
      name: "Copy of Sunday Rooftop",
      rights_confirmed: false,
      start_date: "",
      end_date: "",
      cta: "tickets",
      budget_mode: "total",
      total_amount: "5000000",
      exclude_past_buyers: true,
      optimization: "sales",
      connection_ids: ["k"],
      prepared: null,
    });
    expect((draft.cities as { refs: Record<string, string> }[])[0].refs.meta).toBe("1");
  });
});
