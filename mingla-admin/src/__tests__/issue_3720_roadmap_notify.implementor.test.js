import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
const panel = read("components/community/RoadmapPanel.jsx");
const announcementPanel = read("components/community/AnnouncementsPanel.jsx");
const service = read("services/communityService.js");

describe("#3720 roadmap notification is one deliberate campaign action", () => {
  it("uses dedicated preview, send and status RPCs", () => {
    assert.match(service, /community_roadmap_notification_preview/);
    assert.match(service, /community_notify_roadmap_change/);
    assert.match(service, /community_get_roadmap_notification_status/);
  });

  it("shows an explicit confirmation with audience, channels and destination", () => {
    assert.match(panel, /Notify roadmap change/);
    assert.match(panel, /one push and one matching in-app notification/i);
    assert.match(panel, /No email is sent/);
    assert.match(panel, /Hosts will land on the Roadmap section/);
  });

  it("reuses one request key on an ambiguous retry and reports queued, not sent", () => {
    assert.match(panel, /setNotifyRequestKey\(crypto\.randomUUID\(\)\)/);
    assert.match(panel, /notifyRoadmapChange\(notifyRequestKey\)/);
    assert.match(panel, /Notification queued/);
    assert.doesNotMatch(panel, /Notification sent/);
  });
});

describe("#3720 announcement publishing reports delivery truth", () => {
  it("loads the durable announcement campaign status and renders every channel", () => {
    assert.match(service, /community_get_announcement_notification_status/);
    assert.match(announcementPanel, /Latest announcement notification/);
    assert.match(announcementPanel, /Bell delivered/);
    assert.match(announcementPanel, /Push accepted/);
    assert.match(announcementPanel, /Email accepted/);
    assert.match(announcementPanel, /Email suppressed/);
  });

  // #3988 — drafts can be archived (RPC already allows any status; UI was published-only).
  it("offers Archive for draft and published announcements", () => {
    assert.match(announcementPanel, /row\.status === "draft" \|\| row\.status === "published"/);
    assert.match(announcementPanel, /onArchive\(row\.id\)/);
    assert.match(service, /community_archive_announcement/);
  });
});
