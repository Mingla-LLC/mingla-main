/**
 * #4273 polish — the campaign screen, mounted for real (T-16 .. T-19).
 *
 * T-16 a three-method blast: one tab per method ("Email · Sent"), the preview
 *      exactly as sent, SMS segments and cost, push counts from the push
 *      ledger, and no recipient list for SMS.
 * T-17 draft / scheduled / failed / cancelled / legacy copy.
 * T-18 wide web: preview and numbers side by side; narrow: one column.
 * T-19 the #2262 doctrine: no height derived from the window, panes unscrolled.
 *
 * Mocked at the boundaries only: router, the two data hooks, the layout hook.
 */
import React from "react";
import { readFileSync } from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer");
const { act } = TestRenderer;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: "42730000-0000-4000-8000-0000000000c2" }),
}));
jest.mock("../../../../../src/services/supabase", () => ({ supabase: {} }));
// EmptyState pulls the animated Button (reanimated needs a native module).
jest.mock("../../../../../src/components/ui/EmptyState", () => {
  const ReactModule = require("react");
  const { Text } = require("react-native");
  return {
    EmptyState: (props: { title: string; description?: string }) =>
      ReactModule.createElement(Text, null, `${props.title} ${props.description ?? ""}`),
  };
});
jest.mock("../../../../../src/hooks/useStickyFooterOffset", () => ({ useStickyFooterOffset: () => 24 }));
let mockWide = false;
jest.mock("../../../../../src/hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: mockWide, isWeb: mockWide, width: mockWide ? 1280 : 390 }),
}));
let mockGroupState: Record<string, unknown> = {};
jest.mock("../../../../../src/hooks/marketing/useCampaignGroupView", () => ({
  useCampaignGroupView: () => mockGroupState,
}));
const mockReportFor = jest.fn();
jest.mock("../../../../../src/hooks/marketing/useCampaignReport", () => ({
  useCampaignReport: (id: string | null) => mockReportFor(id),
}));

import CampaignReportRoute from "../[id]";

const HEAD = "42730000-0000-4000-8000-0000000000c1";
const SMS = "42730000-0000-4000-8000-0000000000c2";
const PUSH = "42730000-0000-4000-8000-0000000000c3";
const brand = { name: "Lantern Room", slug: "lantern-room", coverUrl: null };

const emailSnapshot = {
  v: 1, kind: "email", captured_at: "2026-11-07T10:00:00Z",
  brand: { name: "Lantern Room", slug: "lantern-room" },
  subject: "Hi {first_name}", body_html: "<p>Hi {first_name}, doors at 9.</p>",
  from_display: "Lantern Room", from_address: "lanternroom@campaigns.usemingla.com",
  reply_to_is_brand: true, header_image_url: null, follow_url: null,
  campaign_variables: { brand_name: "Lantern Room", event_date: null, event_date_short: null, ends_at: null, event_url: null, next_event_name: null, event_id: null },
  per_guest_tokens: ["first_name", "event_name", "previous_event_name"], embedded_events: [],
};
const smsSnapshot = {
  v: 1, kind: "sms", captured_at: "2026-11-07T10:00:00Z",
  brand: { name: "Lantern Room", slug: "lantern-room" },
  body_as_authored: "Doors at 9",
  wire_text: "Doors at 9\n\nReply STOP to opt out.",
  segments: 1, encoding: "GSM-7", media_urls: [], follow_included: false, links_shortened: false,
};
const pushSnapshot = {
  v: 1, kind: "push", captured_at: "2026-11-07T10:00:00Z",
  brand: { name: "Lantern Room", slug: "lantern-room" },
  title: null, body_as_authored: "Doors at 9", deep_link: null,
  variants: [{ reason: "follower", title: "Lantern Room", body: "Doors at 9 You follow Lantern Room." }],
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseSentSnapshot } = require("../../../../../src/services/marketing/marketingCampaignGroupViewService");

const member = (over: Record<string, unknown>) => ({
  campaignId: HEAD, channel: "email", status: "sent", name: "Rooftop", isHead: false,
  createdAt: "2026-11-07T09:00:00Z", updatedAt: "2026-11-07T10:00:00Z",
  scheduledFor: null, sentAt: "2026-11-07T10:00:00Z",
  payload: { kind: "email", subject: "Hi {first_name}", body_html: "<p>Saved</p>", body_text: "" },
  snapshot: null, push: null, sms: null, cost: null,
  ...over,
});

const blast = () => [
  member({ campaignId: HEAD, isHead: true, snapshot: parseSentSnapshot(emailSnapshot) }),
  member({
    campaignId: SMS, channel: "sms", createdAt: "2026-11-07T09:01:00Z",
    payload: { kind: "sms", body: "Doors at 9" }, snapshot: parseSentSnapshot(smsSnapshot),
    sms: { segmentsSent: 4, messagesAccepted: 2, deferred: 1 },
    cost: { costKind: "provider_estimate", estimatedCostMinor: 412, currency: "USD", smsSegmentCount: 6, reachableCount: 3, selectedCount: 3 },
  }),
  member({
    campaignId: PUSH, channel: "push", createdAt: "2026-11-07T09:02:00Z",
    payload: { kind: "push", body: "Doors at 9" }, snapshot: parseSentSnapshot(pushSnapshot),
    push: { queued: 0, sent: 2, failed: 1, skipped: 3 },
  }),
];

const ready = (members: unknown[], focus = SMS) => {
  mockGroupState = {
    data: { groupId: HEAD, focusCampaignId: focus, brand, members },
    isLoading: false, isError: false, notFound: false, hasResolved: true, refetch: jest.fn(),
  };
};

const report = (over: Record<string, unknown> = {}) => ({
  data: {
    campaign: { audience_name_snapshot: "Your Book" },
    recipientStats: {
      total: 3, queued: 0, accepted: 2, delivered: 0, opened: 0, trackedDelivered: 0, preview_skipped: 0,
      failed: 1, bounced: 0, complained: 0, unsubscribed: 0, clicked: 1,
      hasDeliveryCoverage: false, hasOpenCoverage: false, deliveryHealthy: true, openHealthy: true,
    },
    clickStats: { total_clicks: 5, unique_clickers: 1, top_links: [] },
    recipients: [{ id: "r1", recipient_email: "guest@example.test", status: "sent", sent_at: null, click_count: 0, failure_reason: null, delivered_at: null, opened_at: null }],
  },
  isLoading: false, isError: false, hasResolved: true, refetch: jest.fn(),
  ...over,
});

const treeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(treeText).join(" ");
  if (value && typeof value === "object" && "children" in value) {
    return treeText((value as { children?: unknown }).children);
  }
  return "";
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mount = async (): Promise<any> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let renderer: any;
  // The composer panes load on demand (React.lazy): let them resolve.
  await act(async () => { renderer = TestRenderer.create(<CampaignReportRoute />); });
  await act(async () => { await Promise.resolve(); });
  return renderer;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byTestId = (renderer: any, id: string) => renderer.root.findAll((node: any) => node.props.testID === id);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tab = (renderer: any, label: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderer.root.findAll((node: any) => node.props.accessibilityRole === "tab" && node.props.accessibilityLabel === `Show ${label}`)[0];

beforeEach(() => {
  mockWide = false;
  mockPush.mockReset();
  mockReportFor.mockReset();
  mockReportFor.mockImplementation((id: string | null) => (id === null
    ? { data: undefined, isLoading: false, isError: false, hasResolved: false, refetch: jest.fn() }
    : report()));
});

describe("#4273 T-16 a three-method blast", () => {
  it("one tab per method, labelled with its status", async () => {
    ready(blast());
    const renderer = await mount();
    for (const label of ["Email · Sent", "SMS · Sent", "Push · Sent"]) {
      expect(tab(renderer, label)).toBeDefined();
    }
    expect(treeText(renderer.toJSON())).toContain("Email · Sent");
  });

  it("the tapped SMS opens first: exactly as sent, segments, cost, and no recipient list", async () => {
    ready(blast());
    const renderer = await mount();
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Exactly as sent");
    expect(text).toContain("Reply STOP to opt out.");
    expect(text).toContain("Each guest got their own short link.");
    expect(text).toMatch(/Segments sent:\s+4/);
    expect(text).toContain("Cost: USD 4.12 estimated");
    expect(text).toContain("Held for quiet hours");
    expect(text).toContain("Link taps");
    expect(text).not.toContain("EVERY RECIPIENT");
    expect(text).not.toContain("Opened");
    expect(text).not.toContain("Bounced");
    expect(mockReportFor).toHaveBeenLastCalledWith(SMS);
  });

  it("an SMS with no confirmed cost says so", async () => {
    const members = blast();
    (members[1] as Record<string, unknown>).cost = null;
    ready(members);
    expect(treeText((await mount()).toJSON())).toContain("Cost not recorded for this send.");
  });

  it("the push tab shows the push ledger's counts and the push as sent", async () => {
    ready(blast());
    const renderer = await mount();
    act(() => tab(renderer, "Push · Sent").props.onPress());
    const text = treeText(renderer.toJSON());
    const cells = byTestId(renderer, "campaign-push-numbers");
    expect(cells.length).toBeGreaterThan(0);
    expect(text).toContain("Not delivered");
    expect(text).toContain("Skipped (muted or no device)");
    expect(text).not.toContain("Waiting");
    expect(text).toContain("To followers");
    expect(text).toContain("Doors at 9 You follow Lantern Room.");
    expect(text).not.toContain("EVERY RECIPIENT");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labels = renderer.root.findAll((node: any) => typeof node.props.accessibilityLabel === "string")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((node: any) => node.props.accessibilityLabel as string);
    expect(labels).toContain("Sent: 2");
    expect(labels).toContain("Not delivered: 1");
    expect(labels).toContain("Skipped (muted or no device): 3");
    expect(mockReportFor).toHaveBeenLastCalledWith(null);
  });

  it("the email tab keeps the email numbers and the recipient list, From as sent", async () => {
    ready(blast());
    const renderer = await mount();
    act(() => tab(renderer, "Email · Sent").props.onPress());
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Lantern Room");
    expect(text).not.toContain("via Mingla");
    expect(text).toContain("[first name]");
    expect(text).toContain("Words in [brackets] were filled in for each guest.");
    expect(text).toContain("What these numbers mean");
    expect(text).toContain("EVERY RECIPIENT");
    expect(text).toMatch(/Audience:\s+Your Book/);
  });
});

describe("#4273 T-17 states", () => {
  it("draft: not sent yet, Keep editing opens the composer, no numbers", async () => {
    ready([member({ campaignId: SMS, status: "draft", sentAt: null, isHead: true })]);
    const renderer = await mount();
    const text = treeText(renderer.toJSON());
    expect(text).toContain("Draft — not sent yet");
    expect(text).toContain("Numbers appear once it sends.");
    expect(text).not.toContain("Exactly as sent");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keep = renderer.root.findAll((node: any) => node.props.accessibilityLabel === "Keep editing the email draft" && node.props.onPress)[0];
    act(() => keep.props.onPress());
    expect(mockPush).toHaveBeenCalledWith(`/marketing/campaigns/compose?draft=${SMS}`);
  });

  it("scheduled, failed and cancelled copy", async () => {
    ready([member({ campaignId: SMS, status: "scheduled", sentAt: null, scheduledFor: "2026-12-01T18:00:00Z" })]);
    let text = treeText((await mount()).toJSON());
    expect(text).toContain("This is what will be sent.");
    expect(text).toContain("Numbers appear once it sends.");
    ready([member({ campaignId: SMS, status: "cancelled", sentAt: null })]);
    text = treeText((await mount()).toJSON());
    expect(text).toContain("Cancelled — nothing was sent");
    expect(text).toContain("Numbers appear once it sends.");
    ready([member({ campaignId: SMS, status: "failed", sentAt: null })]);
    text = treeText((await mount()).toJSON());
    expect(text).toContain("This didn't go out");
    expect(text).toContain("Failed ");
  });

  it("a legacy send with no snapshot is rebuilt and labelled (Q2)", async () => {
    ready([member({ campaignId: SMS, snapshot: null })]);
    const text = treeText((await mount()).toJSON());
    expect(text).toContain("Rebuilt from your saved message. Brand details may have changed since.");
    expect(text).not.toContain("Exactly as sent");
  });

  it("loading and not-found", async () => {
    mockGroupState = { data: undefined, isLoading: true, isError: false, notFound: false, hasResolved: false, refetch: jest.fn() };
    expect(treeText((await mount()).toJSON())).not.toContain("Couldn't load");
    mockGroupState = { data: undefined, isLoading: false, isError: true, notFound: true, hasResolved: true, refetch: jest.fn() };
    expect(treeText((await mount()).toJSON())).toContain("Campaign not found");
  });
});

describe("#4273 T-18 wide vs narrow", () => {
  it("web at 1024px and wider: preview and numbers side by side", async () => {
    mockWide = true;
    ready(blast());
    const renderer = await mount();
    const row = byTestId(renderer, "campaign-layout-wide");
    expect(row.length).toBeGreaterThan(0);
    const style = [row[0].props.style].flat();
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ flexDirection: "row" })]));
    expect(byTestId(renderer, "campaign-layout-narrow")).toHaveLength(0);
  });

  it("native and narrow web: one column", async () => {
    mockWide = false;
    ready(blast());
    const renderer = await mount();
    expect(byTestId(renderer, "campaign-layout-narrow").length).toBeGreaterThan(0);
    expect(byTestId(renderer, "campaign-layout-wide")).toHaveLength(0);
  });
});

describe("#4273 T-19 the #2262 layout doctrine on the campaign screen", () => {
  const source = readFileSync(path.join(__dirname, "../[id].tsx"), "utf8");
  const previews = readFileSync(path.join(__dirname, "../../../../../src/components/marketing/SentCampaignPreviews.tsx"), "utf8");
  it("no height or maxHeight is built from the window", async () => {
    expect(source).not.toMatch(/\bheight\s*[,}]/);
    expect(source).not.toMatch(/(?:max|min)?[hH]eight\s*:\s*[^,\n]*(?:height|width|window)/);
    expect(source).not.toMatch(/useWindowDimensions\(\)\.height/);
    expect(source).toMatch(/const \{ width, fontScale \} = useWindowDimensions\(\);/);
  });
  it("the panes render without their own scroll, and load on demand", async () => {
    expect(previews.match(/scrollable=\{false\}/g)).toHaveLength(2);
    expect(previews).toContain("fill={false}");
    // Keep the report screen lazy: no static import of a composer pane here.
    expect(source).not.toMatch(/^import .*(EmailPreviewPane|SmsPreviewPane|PushComposeCard|ComposerPreviewTabs|blastSendModel)/m);
    expect(source).toContain('import("../../../../src/components/marketing/SentCampaignPreviews")');
  });
});
