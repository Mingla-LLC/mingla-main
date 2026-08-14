import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

const businessRoot = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(businessRoot, relative), "utf8");

describe("#1972 canonical event lifecycle Business surfaces", () => {
  test("event drafts create and autosave through canonical RPC owners while RSVP stays isolated", () => {
    const source = read("src/services/eventDrafts.ts");
    expect(source).toContain('supabase.rpc("business_create_event_draft"');
    expect(source).toContain('supabase.rpc("business_update_event_draft"');
    expect(source).toContain('eventTypeForInsert === "rsvp"');
    expect(source).toContain("draft.isRsvp === true");
  });

  test("published lifecycle services expose live edit, duplicate, unpublish, and durable cancellation", () => {
    const source = read("src/services/businessEvents.ts");
    expect(source).toContain('"business_update_live_event_atomic"');
    expect(source).toContain('"business_duplicate_event_as_draft"');
    expect(source).toContain('"business_unpublish_event_to_draft"');
    expect(source).toContain('"business_cancel_event"');
  });

  test("Hub and event detail wire real duplicate and unpublish handlers on the shared surface", () => {
    const hub = read("app/(tabs)/hub/events.tsx");
    const detail = read("app/event/[id]/index.tsx");
    const menu = read("src/components/event/EventManageMenu.tsx");
    for (const source of [hub, detail]) {
      expect(source).toContain("duplicateBusinessEventAsDraft");
      expect(source).toContain("unpublishBusinessEventToDraft");
      expect(source).toContain("onDuplicate=");
      expect(source).toContain("onUnpublish=");
    }
    expect(menu).not.toContain("Duplicate lands a future polish dispatch");
    expect(menu).toContain('label: "Unpublish to draft"');
  });

  test("published editor sends all core fields and the required audit reason to the server", () => {
    const source = read("src/components/event/EditPublishedScreen.tsx");
    expect(source).toContain("ISSUE_1972_CORE_PATCH_KEYS");
    expect(source).toContain("await patchPublishedEventAtomically(");
    expect(source).not.toContain("await patchPublishedEventCore(");
    expect(source).not.toContain("await patchPublishedEventWhen(");
    expect(source).toContain("validation.trimmedReason");
    expect(source).toContain("(liveEvent.clientRevision ?? 0) + 1");
  });

  test("cover selections use trusted Edge attestation before the atomic owner", () => {
    const source = read("src/services/eventCoverMediaService.ts");
    expect(source).toContain('"event-cover-attest-selection"');
    expect(source).toContain("export const attestEventCoverSelection");
    expect(source).not.toContain(
      'supabase.rpc("business_register_event_cover_selection"',
    );
  });
});
