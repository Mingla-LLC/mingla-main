/**
 * #4273 polish — T-14 (what each method's preview shows) and T-15 (one card
 * per blast in the list).
 */
// MINGLA-INVARIANT: I-4273-SENT-PREVIEW-GUEST-LABELS | issue #4273 | A sent preview shows per-guest words as [labels], never a real guest's value, and labels a preview rebuilt from the saved message as rebuilt.
import {
  filterCampaignGroups,
  groupCampaignRows,
  methodTabLabel,
  previewSourceFor,
  rollUpStatus,
  sendStarted,
  SOURCE_LABEL_EXACT,
  SOURCE_LABEL_REBUILT,
  tabMembers,
} from "../sentPreviewModel";
import {
  parseSentSnapshot,
  type CampaignGroupMember,
} from "../../../services/marketing/marketingCampaignGroupViewService";
import type { MarketingCampaignRow } from "../../../types/marketing";

const brand = { name: "Lantern Room", slug: "lantern-room", coverUrl: "https://cdn.example/now.jpg" };

const emailSnapshot = {
  v: 1,
  kind: "email",
  captured_at: "2026-11-07T10:00:00Z",
  brand: { name: "Lantern Room (old name)", slug: "lantern-room" },
  subject: "Hi {first_name}, {brand_name} is back",
  body_html: "<p>Hi {first_name}. See you at {event_name}.</p>",
  from_display: "Lantern Room (old name)",
  from_address: "lanternroom@campaigns.usemingla.com",
  reply_to_is_brand: true,
  header_image_url: "https://cdn.example/then.jpg",
  follow_url: "https://usemingla.com/b/lantern-room",
  campaign_variables: {
    brand_name: "Lantern Room (old name)",
    event_date: "Sat, Dec 5",
    event_date_short: "Sat, Dec 5",
    ends_at: null,
    event_url: "https://usemingla.com/e/lantern-room/rooftop",
    next_event_name: "Rooftop Night",
    event_id: "42730000-0000-4000-8000-0000000000e1",
  },
  per_guest_tokens: ["first_name", "event_name", "previous_event_name"],
  embedded_events: [{
    id: "42730000-0000-4000-8000-0000000000e1",
    title: "Rooftop Night",
    date_label: "Sat, Dec 5",
    ends_at_label: null,
    location_label: "Lagos",
    cover_image_url: null,
    cover_media_type: null,
    url: "https://usemingla.com/e/lantern-room/rooftop",
  }],
};

const member = (over: Partial<CampaignGroupMember>): CampaignGroupMember => ({
  campaignId: "42730000-0000-4000-8000-0000000000c1",
  channel: "email",
  status: "sent",
  name: "Rooftop",
  isHead: true,
  createdAt: "2026-11-07T09:00:00Z",
  updatedAt: "2026-11-07T10:00:00Z",
  scheduledFor: null,
  sentAt: "2026-11-07T10:00:00Z",
  payload: { kind: "email", subject: "Hi {first_name}", body_html: "<p>Saved {first_name}</p>", body_text: "" },
  snapshot: null,
  push: null,
  sms: null,
  cost: null,
  ...over,
});

describe("#4273 T-14 the preview each method shows", () => {
  it("email with a snapshot: exactly as sent, From as sent, guest words as labels", () => {
    const resolved = previewSourceFor(member({ snapshot: parseSentSnapshot(emailSnapshot) }), brand);
    expect(resolved.channel).toBe("email");
    if (resolved.channel !== "email") return;
    expect(resolved.source).toBe("snapshot");
    expect(resolved.label).toBe(SOURCE_LABEL_EXACT);
    expect(resolved.props.fromLabel).toBe("Lantern Room (old name)");
    expect(resolved.props.brandHeaderImageUrl).toBe("https://cdn.example/then.jpg");
    expect(resolved.props.variables.first_name).toBe("[first name]");
    expect(resolved.props.variables.previous_event_name).toBe("[previous event]");
    expect(resolved.props.variables.event_name).toBe("Rooftop Night");
    expect(resolved.props.variables.brand_name).toBe("Lantern Room (old name)");
    expect(resolved.props.embeddedEvents.map((event) => event.title)).toEqual(["Rooftop Night"]);
    expect(resolved.props.brandSlug).toBe("lantern-room");
    expect(resolved.props.hasGuestWords).toBe(true);
  });

  it("a sent email with no snapshot is rebuilt from the saved message and says so (Q2)", () => {
    const resolved = previewSourceFor(member({ snapshot: null }), brand);
    expect(resolved.source).toBe("payload_live");
    expect(resolved.label).toBe(SOURCE_LABEL_REBUILT);
    expect(resolved.label).toBe("Rebuilt from your saved message. Brand details may have changed since.");
    if (resolved.channel !== "email") return;
    expect(resolved.props.bodyHtml).toBe("<p>Saved {first_name}</p>");
    expect(resolved.props.brandHeaderImageUrl).toBe("https://cdn.example/now.jpg");
    expect(resolved.props.embeddedEvents).toEqual([]);
    expect(resolved.props.variables.first_name).toBe("[first name]");
  });

  it("a draft or scheduled method shows what will go, with no label", () => {
    for (const status of ["draft", "scheduled", "cancelled"] as const) {
      const resolved = previewSourceFor(member({ status, sentAt: null }), brand);
      expect(resolved.source).toBe("draft");
      expect(resolved.label).toBeNull();
    }
  });

  it("an SMS snapshot prints the text as sent and its count line", () => {
    const resolved = previewSourceFor(member({
      channel: "sms",
      payload: { kind: "sms", body: "Doors at 9" },
      snapshot: parseSentSnapshot({
        v: 1, kind: "sms", captured_at: "x", brand: { name: "Lantern Room", slug: "lantern-room" },
        body_as_authored: "Doors at 9 https://tix.example",
        wire_text: "Doors at 9 https://usemingla.com/m/00000000-0000-4000-8000-000000000001\n\nReply STOP to opt out.",
        segments: 1, encoding: "GSM-7", media_urls: [], follow_included: false, links_shortened: true,
      }),
    }), brand);
    expect(resolved.channel).toBe("sms");
    if (resolved.channel !== "sms") return;
    expect(resolved.props.wireOverride).toContain("Reply STOP to opt out.");
    expect(resolved.props.countLineOverride).toBe("GSM-7 · 95 chars · 1 segment");
  });

  it("a push snapshot shows one push per reason with its caption", () => {
    const resolved = previewSourceFor(member({
      channel: "push",
      payload: { kind: "push", body: "Doors at 9" },
      snapshot: parseSentSnapshot({
        v: 1, kind: "push", captured_at: "x", brand: { name: "Lantern Room", slug: "lantern-room" },
        title: null, body_as_authored: "Doors at 9", deep_link: null,
        variants: [
          { reason: "follower", title: "Lantern Room", body: "Doors at 9 You follow Lantern Room." },
          { reason: "book", title: "Lantern Room", body: "Doors at 9 You're on Lantern Room's guest list." },
        ],
      }),
    }), brand);
    if (resolved.channel !== "push") throw new Error("push expected");
    expect(resolved.props.variants?.map((variant) => variant.caption)).toEqual(["To followers", "To your guest list"]);
    expect(resolved.props.fallback).toBeNull();
  });

  it("an unknown snapshot version falls back, never throws", () => {
    expect(parseSentSnapshot({ ...emailSnapshot, v: 2 })).toBeNull();
    expect(parseSentSnapshot({ v: 1, kind: "email" })).toBeNull();
    expect(parseSentSnapshot("nope")).toBeNull();
  });

  it("a send held for quiet hours after it started counts as started", () => {
    expect(sendStarted({ status: "scheduled", snapshot: parseSentSnapshot(emailSnapshot) })).toBe(true);
    expect(sendStarted({ status: "scheduled", snapshot: null })).toBe(false);
  });

  it("tab labels and one tab per method (the tapped one wins its method)", () => {
    expect(methodTabLabel({ channel: "sms", status: "sent" })).toBe("SMS · Sent");
    const failed = member({ campaignId: "f", channel: "sms", status: "failed", createdAt: "2026-11-07T09:01:00Z" });
    const again = member({ campaignId: "a", channel: "sms", status: "sent", createdAt: "2026-11-07T09:05:00Z" });
    const head = member({ campaignId: "h" });
    expect(tabMembers([head, failed, again], "h").map((row) => row.campaignId)).toEqual(["h", "a"]);
    expect(tabMembers([head, failed, again], "f").map((row) => row.campaignId)).toEqual(["h", "f"]);
  });
});

const row = (over: Partial<MarketingCampaignRow>): MarketingCampaignRow => ({
  id: "x",
  account_id: "a",
  brand_id: "b",
  audience_id: "au",
  template_id: null,
  name: "Rooftop",
  channel: "email",
  channel_payload: { kind: "email", subject: "s", body_html: "b", body_text: "b" },
  campaign_group_id: null,
  status: "sent",
  scheduled_for: null,
  sent_at: null,
  recipient_count: null,
  created_at: "2026-11-07T09:00:00Z",
  updated_at: "2026-11-07T09:00:00Z",
  ...over,
});

describe("#4273 T-15 one card per blast", () => {
  it("groups by COALESCE(campaign_group_id, id); the head is the primary; methods in order", () => {
    const groups = groupCampaignRows([
      row({ id: "p", channel: "push", campaign_group_id: "h", status: "failed", created_at: "2026-11-07T09:02:00Z" }),
      row({ id: "s", channel: "sms", campaign_group_id: "h", status: "sent", created_at: "2026-11-07T09:01:00Z" }),
      row({ id: "h", channel: "email", campaign_group_id: "h", status: "sent" }),
      row({ id: "solo", name: "Solo", status: "draft" }),
    ]);
    expect(groups.map((group) => group.groupId)).toEqual(["h", "solo"]);
    expect(groups[0].primary.id).toBe("h");
    expect(groups[0].channels).toEqual(["email", "sms", "push"]);
    expect(groups[0].status).toBe("sent");
  });

  it("the earliest member leads when the head is not listed", () => {
    const groups = groupCampaignRows([
      row({ id: "late", campaign_group_id: "gone", created_at: "2026-11-07T09:09:00Z" }),
      row({ id: "early", campaign_group_id: "gone", created_at: "2026-11-07T09:01:00Z" }),
    ]);
    expect(groups[0].primary.id).toBe("early");
  });

  it("rolls status up: sending > scheduled > all failed > any sent > all draft > cancelled", () => {
    expect(rollUpStatus(["sent", "sending"])).toBe("sending");
    expect(rollUpStatus(["sent", "scheduled"])).toBe("scheduled");
    expect(rollUpStatus(["failed", "failed"])).toBe("failed");
    expect(rollUpStatus(["failed", "sent"])).toBe("sent");
    expect(rollUpStatus(["draft", "draft"])).toBe("draft");
    expect(rollUpStatus(["cancelled"])).toBe("cancelled");
  });

  it("the filter applies after grouping: a blast shows if any method matches", () => {
    const groups = groupCampaignRows([
      row({ id: "h", campaign_group_id: "h", status: "sent" }),
      row({ id: "s", channel: "sms", campaign_group_id: "h", status: "failed" }),
      row({ id: "d", status: "draft" }),
    ]);
    expect(filterCampaignGroups(groups, "failed").map((group) => group.groupId)).toEqual(["h"]);
    expect(filterCampaignGroups(groups, "sent").map((group) => group.groupId)).toEqual(["h"]);
    expect(filterCampaignGroups(groups, "draft").map((group) => group.groupId)).toEqual(["d"]);
    expect(filterCampaignGroups(groups, undefined)).toHaveLength(2);
  });
});
