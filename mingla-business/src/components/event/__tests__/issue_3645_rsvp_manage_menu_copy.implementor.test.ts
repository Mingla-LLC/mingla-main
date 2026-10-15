/**
 * #3645 handoff item 4 — Hub / shared EventManageMenu must say RSVP, not
 * "event", when the row is an RSVP. Ticketed event labels stay unchanged.
 *
 * Fails-on-revert: drop the RSVP cancel branch and "Cancel RSVP" vanishes;
 * hardcode "Cancel event" for every row and the adversarial gate fails.
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

import { isRsvpManageTarget } from "../rsvpManageTarget";

const businessRoot = path.resolve(__dirname, "../../../..");
const menuSource = fs.readFileSync(
  path.join(businessRoot, "src/components/event/EventManageMenu.tsx"),
  "utf8",
);

describe("#3645 — EventManageMenu RSVP copy (implementor)", () => {
  test("isRsvpManageTarget: live event_type=rsvp and draft isRsvp", () => {
    expect(isRsvpManageTarget({ event_type: "rsvp" })).toBe(true);
    expect(isRsvpManageTarget({ isRsvp: true })).toBe(true);
    expect(isRsvpManageTarget({ event_type: "event" })).toBe(false);
    expect(isRsvpManageTarget({ isRsvp: false })).toBe(false);
    expect(isRsvpManageTarget({})).toBe(false);
  });

  test("menu source keeps ticketed cancel/share/unpublish labels byte-identical", () => {
    expect(menuSource).toContain('label: "Cancel event"');
    expect(menuSource).toContain('label: "Share event"');
    expect(menuSource).toContain('label: "Unpublish to draft"');
    expect(menuSource).toContain('label: "Publish event"');
    expect(menuSource).toContain('"Manage event"');
  });

  test("menu source adds RSVP cancel / share / return-to-draft / publish / title", () => {
    expect(menuSource).toContain('label: "Cancel RSVP"');
    expect(menuSource).toContain('label: "Share RSVP"');
    expect(menuSource).toContain('label: "Return RSVP to draft"');
    expect(menuSource).toContain('label: "Publish RSVP"');
    expect(menuSource).toContain('"Manage RSVP"');
  });

  test("Hub still mounts EventManageMenu for the shared manage sheet", () => {
    const hub = fs.readFileSync(
      path.join(businessRoot, "app/(tabs)/hub/events.tsx"),
      "utf8",
    );
    expect(hub).toContain("LazyEventManageMenu");
    expect(hub).toContain("EventManageMenu");
    // Dialog already knew RSVP; menu must catch up.
    expect(hub).toContain(
      'confirmLabel={cancellingRsvp ? "Cancel RSVP" : "Cancel event"}',
    );
  });
});
