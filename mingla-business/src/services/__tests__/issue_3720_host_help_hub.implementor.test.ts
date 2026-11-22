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
 *
 * [TEST-MOD #4420] Help & Support became Announcements and Support (Guides,
 * Roadmap, Ideas and Questions left the Host app). The tab-resolver tests
 * moved to support/__tests__/issue_4420_help_support_entry; the roadmap read
 * left with the roadmap; the wiring pins below follow the new files.
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
  markAnnouncementRead,
  setCommunityEmailPref,
} from "../communityService";
import { HELP_CENTRE_URL } from "../../constants/supportHostFacing";

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

  test("hub route mounts Announcements · Support", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "app/account/support.tsx"),
      "utf8",
    );
    expect(src).toMatch(/HelpSupportHubTabs/);
    expect(src).toMatch(/AnnouncementsPanel/);
    expect(src).toMatch(/SupportColumn/);
    expect(src).toMatch(/useCommunityUnreadCount/);
    expect(src).toMatch(/resolveHelpSupportEntry/);
  });

  test("hub tabs component labels Announcements · Support", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/HelpSupportHubTabs.tsx"),
      "utf8",
    );
    expect(src).toContain('hubCopy("tabs.announcements")');
    expect(src).toContain('hubCopy("tabs.support")');
    expect(src).not.toContain("Guides");
  });

  test("Support column links to the growing Help Centre video catalogue", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/SupportColumn.tsx"),
      "utf8",
    );
    expect(src).toContain("openHelpCentre(HELP_CENTRE_URL)");
    expect(src).toContain('hubCopy("support.browse_videos")');
    expect(HELP_CENTRE_URL).toBe("https://usemingla.com/help");
  });

  // [TEST-MOD-APPROVED #3720] Wave 2 uses real Support sender names.
  // #4382: "Start a chat" became "New request"; the copy now lives in hostSupport.json.
  test("Support tab keeps the neutral Support fallback + online banner + new request", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/SupportTabPanel.tsx"),
      "utf8",
    );
    expect(src).toMatch(/SUPPORT_HOST_FACING_AGENT/);
    expect(src).toMatch(/useSupportIsOnline/);
    expect(src).toContain('supportCopy("panel.new_request")');
    expect(src).toContain('supportCopy("panel.online")');
    const copy = fs.readFileSync(path.join(SRC, "i18n/locales/en/hostSupport.json"), "utf8");
    expect(copy).toContain('"online": "Support is online"');
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

  test("Announcements wires email pref + mark read", () => {
    const src = fs.readFileSync(
      path.join(SRC, "components/support/AnnouncementsPanel.tsx"),
      "utf8",
    );
    expect(src).toMatch(/useCommunityEmailPref/);
    expect(src).toMatch(/useMarkAnnouncementRead/);
    expect(src).toContain('hubCopy("announcements.email_title")');
  });
});
