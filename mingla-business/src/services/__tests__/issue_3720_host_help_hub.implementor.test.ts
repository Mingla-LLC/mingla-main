/* eslint-disable import/first */
/**
 * #3720 Slice G — Host Help & Support hub (implementor).
 *
 * Pins:
 *   - Hub tabs Community · Support · Guides
 *   - Unread opens Community; otherwise last tab / Support
 *   - communityService uses published RLS reads + mark-read / email pref RPCs
 *   - Settings Help & Support row carries unread badge wiring
 *   - Guides still expose Help Centre → usemingla.com/help
 *   - Support tab still shows Veronica + ticket start path
 *
 * Fails-on-revert: dropping the hub tabs or Help Centre row turns these red.
 */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

type DbResult = Promise<{ data: unknown; error: unknown }>;
const fromMock = jest.fn();
const rpcMock = jest.fn<(...args: unknown[]) => DbResult>();

jest.mock("../supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import {
  countUnreadAnnouncements,
  fetchSupportIsOnline,
  getCommunityEmailPrefEnabled,
  listPublishedAnnouncements,
  listPublicRoadmap,
  markAnnouncementRead,
  setCommunityEmailPref,
} from "../communityService";
import { HELP_CENTRE_URL } from "../../constants/supportHostFacing";
import {
  isHelpSupportTabId,
  resolveInitialHelpSupportTab,
} from "../../utils/helpSupportLastTab";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function chain(result: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  const self = (): typeof q => q;
  q.select = jest.fn(self);
  q.eq = jest.fn(self);
  q.order = jest.fn(self);
  q.maybeSingle = jest.fn(async () => result);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  // Make awaitable as thenable for list queries
  Object.defineProperty(q, Symbol.toStringTag, { value: "Promise" });
  return q;
}

describe("#3720 Host Help & Support hub (implementor)", () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  test("resolveInitialHelpSupportTab: unread wins over last tab", () => {
    expect(
      resolveInitialHelpSupportTab({
        queryTab: null,
        unreadCount: 2,
        lastTab: "support",
      }),
    ).toBe("community");
  });

  test("resolveInitialHelpSupportTab: query tab wins over unread", () => {
    expect(
      resolveInitialHelpSupportTab({
        queryTab: "guides",
        unreadCount: 5,
        lastTab: "community",
      }),
    ).toBe("guides");
  });

  test("resolveInitialHelpSupportTab: last tab when no unread", () => {
    expect(
      resolveInitialHelpSupportTab({
        queryTab: undefined,
        unreadCount: 0,
        lastTab: "guides",
      }),
    ).toBe("guides");
  });

  test("resolveInitialHelpSupportTab: defaults to support", () => {
    expect(
      resolveInitialHelpSupportTab({
        queryTab: "nope",
        unreadCount: 0,
        lastTab: null,
      }),
    ).toBe("support");
  });

  test("isHelpSupportTabId accepts only hub ids", () => {
    expect(isHelpSupportTabId("community")).toBe(true);
    expect(isHelpSupportTabId("support")).toBe(true);
    expect(isHelpSupportTabId("guides")).toBe(true);
    expect(isHelpSupportTabId("email")).toBe(false);
  });

  test("listPublishedAnnouncements joins read receipts", async () => {
    fromMock.mockImplementation((table: unknown) => {
      if (table === "community_announcements") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({
                data: [
                  {
                    id: "a1",
                    title: "Hello",
                    body_md: "Body",
                    published_at: "2026-10-01T00:00:00Z",
                  },
                  {
                    id: "a2",
                    title: "Unread",
                    body_md: "More",
                    published_at: "2026-10-02T00:00:00Z",
                  },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "community_read_receipts") {
        return {
          select: async () => ({
            data: [{ announcement_id: "a1", read_at: "2026-10-01T12:00:00Z" }],
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${String(table)}`);
    });

    const rows = await listPublishedAnnouncements();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "a1")?.read_at).toBe(
      "2026-10-01T12:00:00Z",
    );
    expect(rows.find((r) => r.id === "a2")?.read_at).toBeNull();
    expect(await countUnreadAnnouncements()).toBe(1);
  });

  test("listPublicRoadmap reads community_roadmap_public only", async () => {
    fromMock.mockImplementation((table: unknown) => {
      expect(table).toBe("community_roadmap_public");
      return {
        select: () => ({
          order: () => ({
            order: async () => ({
              data: [
                {
                  id: "r1",
                  public_title: "Soon",
                  public_body: "Desc",
                  lane: "now",
                  sort_order: 0,
                },
              ],
              error: null,
            }),
          }),
        }),
      };
    });
    const cards = await listPublicRoadmap();
    expect(cards[0]?.public_title).toBe("Soon");
    expect(cards[0]?.lane).toBe("now");
  });

  test("email pref defaults ON when no row; RPC sets pref", async () => {
    fromMock.mockReturnValue(
      chain({ data: null, error: null }),
    );
    expect(await getCommunityEmailPrefEnabled()).toBe(true);

    rpcMock.mockResolvedValue({ data: null, error: null });
    await setCommunityEmailPref(false);
    expect(rpcMock).toHaveBeenCalledWith("community_set_email_pref", {
      p_enabled: false,
    });

    await markAnnouncementRead("ann-1");
    expect(rpcMock).toHaveBeenCalledWith("community_mark_announcement_read", {
      p_announcement_id: "ann-1",
    });
  });

  test("fetchSupportIsOnline calls support_is_online RPC", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await fetchSupportIsOnline()).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("support_is_online");
  });

  test("hub route mounts Community · Support · Guides", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "app/account/support.tsx"),
      "utf8",
    );
    expect(src).toMatch(/HelpSupportHubTabs/);
    expect(src).toMatch(/CommunityTabPanel/);
    expect(src).toMatch(/SupportTabPanel/);
    expect(src).toMatch(/GuidesTabPanel/);
    expect(src).toMatch(/useCommunityUnreadCount/);
    expect(src).toMatch(/resolveInitialHelpSupportTab/);
  });

  test("hub tabs component labels Community · Support · Guides", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/HelpSupportHubTabs.tsx"),
      "utf8",
    );
    expect(src).toContain('label: "Community"');
    expect(src).toContain('label: "Support"');
    expect(src).toContain('label: "Guides"');
  });

  test("Guides tab exposes Help Centre videos link", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/GuidesTabPanel.tsx"),
      "utf8",
    );
    expect(src).toContain("Help Centre videos");
    expect(src).toContain("HELP_CENTRE_URL");
    expect(HELP_CENTRE_URL).toBe("https://usemingla.com/help");
  });

  // [TEST-MOD-APPROVED #3720] Wave 2 uses real Support sender names.
  test("Support tab keeps the neutral Support fallback + online banner + start chat", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/SupportTabPanel.tsx"),
      "utf8",
    );
    expect(src).toMatch(/SUPPORT_HOST_FACING_AGENT/);
    expect(src).toMatch(/useSupportIsOnline/);
    expect(src).toContain("Start a chat");
    expect(src).toContain("Support is online");
  });

  test("Settings Help & Support row wires unread badge", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "app/(tabs)/account.tsx"),
      "utf8",
    );
    expect(src).toMatch(/useCommunityUnreadCount/);
    expect(src).toMatch(/badgeCount=\{communityUnread\}/);
    expect(src).toContain("Help & Support");
  });

  test("Community tab wires email pref + roadmap + mark read", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/CommunityTabPanel.tsx"),
      "utf8",
    );
    expect(src).toMatch(/useCommunityEmailPref/);
    expect(src).toMatch(/useCommunityRoadmap/);
    expect(src).toMatch(/useMarkAnnouncementRead/);
    expect(src).toContain("Email me announcements");
  });
});
