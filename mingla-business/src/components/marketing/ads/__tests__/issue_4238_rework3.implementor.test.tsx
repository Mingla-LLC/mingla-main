// MINGLA-INVARIANT: I-4238-HOST-AD-SHEET-PINNED-FOOTER | issue #4238 rework 3 | Every Host ads sheet built on SheetFrame (edit budget, Ari confirm, withdraw, receipts, statement, compare, share) and the top-up sheet render their body in SheetScrollLayout with the action buttons in its pinned footer, inside a flex:1 / minHeight:0 frame, so Save stays reachable on a 1280x800 window.
/**
 * #4238 rework 3 (after retest 3, FAIL at a1c5958958) — Host app side.
 *
 *  P1-1  "Edit budget or end date": Save sat below the desktop card's clip at
 *        1280×800 / 1440×900. The body now scrolls and the buttons are pinned
 *        (also top-up and every SheetFrame sheet).
 *  P2-1  the local seed's ad connections use HOST_AD_LANE ('consumer').
 *  P2-2  Home "Ads" card: the true reason, never "payment method" for a
 *        rejected / in-review ad.
 *  P3    Ari's unit, Promote list identity line, slider mark edges, country
 *        sheet search, copy fixes.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";

type RenderNode = { props: Record<string, unknown>; type: unknown };
type ReactTestRenderer = {
  root: {
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
    findByProps: (props: Record<string, unknown>) => RenderNode;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => Promise<void> | void) => Promise<void>;
  create: (el: React.ReactElement) => ReactTestRenderer;
};

const mockShare = jest.fn();
const mockCopy = jest.fn();
const mockQuote = jest.fn();
const mockStart = jest.fn();
const mockApply = jest.fn();
const mockPresent = jest.fn();
const mockStatement = jest.fn();

jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../../../utils/sharePublicUrl", () => ({
  sharePublicUrl: (...args: unknown[]) => mockShare(...args),
  copyPublicUrl: (...args: unknown[]) => mockCopy(...args),
}));
jest.mock("../../../ui/Button", () => {
  const { Pressable, Text: RNText } = jest.requireActual("react-native");
  return {
    Button: (props: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) => (
      <Pressable onPress={props.onPress} testID={props.testID} accessibilityLabel={props.label} disabled={props.disabled}>
        <RNText>{props.label}</RNText>
      </Pressable>
    ),
  };
});
jest.mock("../../../ui/DateField", () => ({ DateField: () => null }));
// #4238 rework 2: the share sheet shows a "Link copied" toast (reanimated-backed).
jest.mock("../../../ui/Toast", () => ({
  Toast: (props: { visible: boolean; message: string; testID?: string }) => {
    const { Text: RNText } = jest.requireActual("react-native");
    return props.visible ? <RNText testID={props.testID}>{props.message}</RNText> : null;
  },
}));
jest.mock("../../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../ui/Switch", () => ({ Switch: () => null }));
jest.mock("../../../../utils/hapticFeedback", () => ({ HapticFeedback: { selectionEnter: jest.fn(), success: jest.fn() } }));
// #4238 rework 3: a stand-in for the bounded body (the real one needs the
// keyboard + safe-area natives). It keeps the same testIDs: <id>-scroll holds
// the body, <id>-footer the pinned buttons.
jest.mock("../../../ui/SheetScrollLayout", () => {
  const { View } = jest.requireActual("react-native");
  return {
    SheetScrollLayout: (props: { children: React.ReactNode; footer?: React.ReactNode; testID?: string }) => (
      <View testID={props.testID}>
        <View testID={`${props.testID}-scroll`}>{props.children}</View>
        {props.footer ? <View testID={`${props.testID}-footer`}>{props.footer}</View> : null}
      </View>
    ),
  };
});
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children: React.ReactNode }) => (props.visible ? props.children : null),
}));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: { children: React.ReactNode; testID?: string }) => {
    const { View } = jest.requireActual("react-native");
    return <View testID={props.testID}>{props.children}</View>;
  },
}));
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) =>
    ReactLib.createElement(name, props, props.children as React.ReactNode);
  return { __esModule: true, default: make("Svg"), Path: make("Path") };
});
jest.mock("../../../../payments/useAdCreditTopUpPay", () => ({ useAdCreditTopUpPay: () => mockPresent }));
jest.mock("../../../../services/adCreditService", () => ({
  quoteAdCreditTopUp: (...args: unknown[]) => mockQuote(...args),
  startAdCreditTopUp: (...args: unknown[]) => mockStart(...args),
  applyAdCreditTopUp: (...args: unknown[]) => mockApply(...args),
  applyAdCreditWithdraw: jest.fn(),
  getAdCreditReceipt: jest.fn(),
  getAdCreditStatement: (...args: unknown[]) => mockStatement(...args),
  quoteAdCreditWithdraw: jest.fn(),
}));
jest.mock("../../../../services/adCreditQuoteErrors", () => ({ mapAdCreditQuoteError: () => "That didn't work." }));


// eslint-disable-next-line import/first
import { HostAdEditBudgetSheet, hostAdSuggestionBasisUnit } from "../HostAdManageSheets";
// eslint-disable-next-line import/first
import { HostAdTopUpSheet } from "../HostAdTopUpSheet";
// eslint-disable-next-line import/first
import { hostAdMarkEdge } from "../HostAdBuilderBits";
// eslint-disable-next-line import/first
import { hostAdCountryMatches } from "../hostAdCountries";
// eslint-disable-next-line import/first
import { homeAdAttentionReason, homeAdStatusLabel } from "../../../../utils/homeAdLifecycle";
// eslint-disable-next-line import/first
import { hostAdRowIdentity } from "../../../../services/hostAdLifecycle";
// eslint-disable-next-line import/first
import type { HostAdCampaign, HostAdSuggestion } from "../../../../services/hostAdCampaignService";
// eslint-disable-next-line import/first
import type { HostAdListItem } from "../../../../services/hostAdLifecycle";

const REPO = path.resolve(__dirname, "../../../../../..");
const naira = (cents: number): string => `₦${(cents / 100).toLocaleString("en-NG")}`;

function isInside(r: ReactTestRenderer, containerId: string, childId: string): boolean {
  const containers = r.root.findAll((n) => n.props.testID === containerId && typeof n.type !== "string");
  return containers.some((c) =>
    (c as unknown as { findAll: (p: (n: RenderNode) => boolean) => RenderNode[] })
      .findAll((n) => n.props.testID === childId).length > 0,
  );
}

describe("P1-1: Save is in the pinned footer, the body scrolls", () => {
  test("Edit budget or end date: Save / Save anyway live in the footer, not the scroll body (fail-on-revert)", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdEditBudgetSheet
          visible
          currency="NGN"
          money={naira}
          capCredit={70_000_00}
          dailyCredit={2_333_00}
          minDailyPay={1_000_00}
          spentCredit={23_330_00}
          walletCredit={1_000_000_00}
          currentEndsAt="2028-08-09T12:00:00.000Z"
          timezone="UTC"
          nowIso="2028-07-20T12:00:00.000Z"
          learning
          daysLive={3}
          busy={false}
          needsLearningConfirm
          error={null}
          onTopUp={jest.fn()}
          onClose={jest.fn()}
          onSubmit={jest.fn()}
        />,
      );
    });
    expect(isInside(r, "host-ad-edit-sheet-layout-footer", "host-ad-edit-save")).toBe(true);
    expect(isInside(r, "host-ad-edit-sheet-layout-footer", "host-ad-edit-cancel")).toBe(true);
    expect(isInside(r, "host-ad-edit-sheet-layout-scroll", "host-ad-edit-save")).toBe(false);
    // The frame takes the card's bounded height so the scroll can shrink.
    const frame = r.root.findAll((n) => n.props.testID === "host-ad-edit-sheet-frame" && typeof n.type !== "string")[0];
    const style = Object.assign({}, ...([] as unknown[]).concat(frame.props.style as unknown).flat(5).filter(Boolean)) as Record<string, unknown>;
    expect(style.flex).toBe(1);
    expect(style.minHeight).toBe(0);
  });

  test("Top-up: the Pay button is pinned in the footer (fail-on-revert)", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdTopUpSheet
          visible
          brandId="brand-1"
          currency="NGN"
          neededCents={50_000_00}
          returnPath="/marketing/ads"
          money={naira}
          onClose={jest.fn()}
          onApplied={jest.fn()}
        />,
      );
    });
    expect(isInside(r, "host-ad-topup-layout-footer", "host-ad-topup-pay-button")).toBe(true);
    expect(isInside(r, "host-ad-topup-layout-scroll", "host-ad-topup-amount-0")).toBe(true);
  });

  test("every SheetFrame sheet and the words sheet keep a bounded, scrolling body (source)", () => {
    const manage = fs.readFileSync(path.join(__dirname, "../HostAdManageSheets.tsx"), "utf8");
    const frame = manage.slice(manage.indexOf("function SheetFrame("), manage.indexOf("// ── How the money works"));
    expect(frame).toContain("<SheetScrollLayout");
    expect(frame).toContain("footer={props.foot");
    const words = fs.readFileSync(path.join(__dirname, "../HostAdWordsSheet.tsx"), "utf8");
    expect(words).toMatch(/wrap: \{ flex: 1, minHeight: 0/);
    expect(words).toMatch(/scroll: \{ flex: 1, minHeight: 0 \}/);
  });
});

describe("P2-1: the local seed opens the builder", () => {
  test("seed ad connections use HOST_AD_LANE, with a brand country and brand-owned creatives (fail-on-revert)", () => {
    const core = fs.readFileSync(path.join(REPO, "supabase/functions/_shared/adChannelCore.ts"), "utf8");
    const lane = /export const HOST_AD_LANE: Lane = "(\w+)"/.exec(core)?.[1];
    expect(lane).toBe("consumer");
    const seed = fs.readFileSync(path.join(REPO, "scripts/sites/local/fixtures/host-ads-states.sql"), "utf8");
    const connections = seed.slice(seed.indexOf("INSERT INTO public.ad_connections"), seed.indexOf("-- ── One plan + campaign per state"));
    const lanes = [...connections.matchAll(/'(meta|tiktok)', '(\w+)'/g)].map((m) => m[2]);
    expect(lanes).toEqual([lane, lane]);
    expect(seed).toMatch(/default_currency, country_code\)/);
    expect(seed).toMatch(/source_brand_id, brand_id, width, height\)/);
    expect(seed).toMatch(/'plan_id', v_plan/);
  });
});

function campaign(over: Partial<HostAdCampaign>): HostAdCampaign {
  return {
    lifecycle: "needs_attention",
    next_action: "Fix issue",
    plan_state: "platform_rejected",
    creative: null,
    ...over,
  } as HostAdCampaign;
}

describe("P2-2: the Home Ads card tells the true reason", () => {
  test("a rejected or in-review ad never reads 'payment method' (fail-on-revert)", () => {
    const rejected = campaign({});
    expect(homeAdAttentionReason(rejected)).toBe("An app didn't approve this ad");
    expect(homeAdStatusLabel(rejected)).toBe("Not approved");
    const reviewReject = campaign({ plan_state: "live", creative: { name: "x", kind: "image", preview_url: null, review_status: "REJECTED" } });
    expect(homeAdAttentionReason(reviewReject)).toBe("An app didn't approve this ad");
    for (const state of ["platform_rejected", "staff_rejected", "partially_live", "creation_failed_terminal", "settling", "changes_requested", "platform_review", ""]) {
      expect(homeAdAttentionReason(campaign({ plan_state: state }))).not.toMatch(/payment method/i);
    }
  });

  test("only a failed payment talks about payment", () => {
    expect(homeAdAttentionReason(campaign({ plan_state: "payment_failed" }))).toBe("The payment for this ad didn't go through");
    expect(homeAdAttentionReason(campaign({ plan_state: "partially_live" }))).toBe("Some apps couldn't start this ad");
  });

  test("HomeAdsSection uses the true reason, not the next-action copy", () => {
    const home = fs.readFileSync(path.join(REPO, "mingla-business/src/components/home/HomeAdsSection.tsx"), "utf8");
    expect(home).not.toContain("homeAdAttentionCopy(campaign.next_action)");
    expect(home.match(/homeAdAttentionReason\(campaign\)/g)?.length).toBe(2);
  });
});

function suggestion(basis: Partial<HostAdSuggestion["basis"]>): HostAdSuggestion {
  return {
    suggestion_id: "s",
    kind: "extend_end",
    apply_action: "change_live",
    days_live: 10,
    basis: { results: 0, cost_per_result_cents: null, guidance_mid_cents: null, guidance_high_cents: null, stock_left: null, ...basis },
  };
}

describe("P3: Ari, list, slider, country, copy", () => {
  test("Ari's cost line uses the server's counted goal, never 'per ticket' for clicks (fail-on-revert)", () => {
    const clicks = suggestion({ results: 120, cost_per_result_cents: 79, goal: "visits" });
    expect(hostAdSuggestionBasisUnit(clicks, "sales")).not.toMatch(/ticket/i);
    expect(hostAdSuggestionBasisUnit(clicks, "sales")).toBe(hostAdSuggestionBasisUnit(suggestion({ results: 1, goal: "visits" }), "visits"));
    // An older server (no basis.goal) with a tickets plan: say nothing.
    expect(hostAdSuggestionBasisUnit(suggestion({ results: 120, cost_per_result_cents: 79 }), "sales")).toBeNull();
  });

  test("two ads for the same page are told apart by apps and start day", () => {
    const base = { kind: "campaign", name: "Rooftop Test Night", lifecycle: "live" } as HostAdListItem;
    const a = hostAdRowIdentity({ ...base, platforms: ["meta"], startedAt: "2026-11-04T10:00:00Z" }, "en-GB");
    const b = hostAdRowIdentity({ ...base, platforms: ["tiktok"], startedAt: "2026-11-09T10:00:00Z" }, "en-GB");
    expect(a).not.toBe(b);
    expect(a).toContain("4 Nov");
    expect(hostAdRowIdentity({ ...base, platforms: [], startedAt: null }, "en-GB")).toBeNull();
  });

  test("slider marks near an end hang inward (Minimum label keeps its breathing room)", () => {
    expect(hostAdMarkEdge(0)).toBe("start");
    expect(hostAdMarkEdge(14.9)).toBe("start");
    expect(hostAdMarkEdge(50)).toBe("middle");
    expect(hostAdMarkEdge(100)).toBe("end");
  });

  test("country sheet search: by name or code, chosen countries left out", () => {
    const rows = hostAdCountryMatches("nig", ["NG"]);
    expect(rows.map((r) => r.code)).toContain("NE");
    expect(rows.map((r) => r.code)).not.toContain("NG");
    expect(hostAdCountryMatches("gb", [])[0]?.code).toBe("GB");
    const picker = fs.readFileSync(path.join(__dirname, "../HostAdCountryPicker.tsx"), "utf8");
    expect(picker).not.toContain("CountryPickerOverlay");
    expect(picker).toContain('testID="host-ad-country-sheet"');
  });

  test("copy: no Snapchat promise for photos, no 'videos' on photo ads, full stops, 'needs'", () => {
    const dir = path.join(REPO, "mingla-business/src/i18n/locales");
    for (const lang of fs.readdirSync(dir)) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, lang, "hostAds.json"), "utf8")).hostAds;
      expect(j.builder.creative.photoNote).not.toContain("Snapchat");
      if (lang !== "th") expect(j.manage.detail.rejectedTitle).toMatch(/[.!?。।]$/);
    }
    const en = JSON.parse(fs.readFileSync(path.join(dir, "en/hostAds.json"), "utf8")).hostAds;
    expect(en.builder.platforms.googleSetup).not.toMatch(/need setup/);
    expect(en.manage.detail.partRejectedTitle).not.toMatch(/video/);
    expect(en.manage.detail.rejectedGeneral).not.toMatch(/the video/);
    expect(en.manage.detail.changeVideo).toBe("Change the photo or video");
  });
});
