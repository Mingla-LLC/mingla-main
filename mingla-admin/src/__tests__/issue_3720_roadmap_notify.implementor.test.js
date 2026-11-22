import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
// [TEST-MOD #4420] the Roadmap screen (components/community/RoadmapPanel.jsx) is
// retired, so its two UI checks left with it. The roadmap RPCs stay in the
// service (Host apps on current builds still read the roadmap) and the
// announcement campaign checks still apply.
const announcementPanel = read("components/community/AnnouncementsPanel.jsx");
const service = read("services/communityService.js");

describe("#3720 roadmap notification is one deliberate campaign action", () => {
  it("uses dedicated preview, send and status RPCs", () => {
    assert.match(service, /community_roadmap_notification_preview/);
    assert.match(service, /community_notify_roadmap_change/);
    assert.match(service, /community_get_roadmap_notification_status/);
  });

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
