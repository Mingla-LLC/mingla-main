/**
 * #3645 handoff item 4 — adversarial: an RSVP manage row must never offer
 * "Cancel event", and the RSVP cancel label must be gated on isRsvp
 * (not a global string swap that would break ticketed events).
 */

import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

const businessRoot = path.resolve(__dirname, "../../../..");
const menuSource = fs.readFileSync(
  path.join(businessRoot, "src/components/event/EventManageMenu.tsx"),
  "utf8",
);
const helperSource = fs.readFileSync(
  path.join(businessRoot, "src/components/event/rsvpManageTarget.ts"),
  "utf8",
);

describe("#3645 — EventManageMenu RSVP copy (tester adversarial)", () => {
  test("Cancel RSVP is only pushed inside an isRsvp branch", () => {
    const cancelRsvpIdx = menuSource.indexOf('label: "Cancel RSVP"');
    expect(cancelRsvpIdx).toBeGreaterThan(-1);
    const windowStart = Math.max(0, cancelRsvpIdx - 280);
    const before = menuSource.slice(windowStart, cancelRsvpIdx);
    expect(before).toMatch(/if\s*\(\s*isRsvp\s*\)/);
  });

  test("Cancel event remains for the non-RSVP branch", () => {
    const cancelEventIdx = menuSource.indexOf('label: "Cancel event"');
    expect(cancelEventIdx).toBeGreaterThan(-1);
    const windowStart = Math.max(0, cancelEventIdx - 200);
    const before = menuSource.slice(windowStart, cancelEventIdx);
    // Ticketed path lives in the else of the isRsvp cancel fork.
    expect(before).toMatch(/\}\s*else\s*\{/);
  });

  test("isRsvpManageTarget is the single RSVP detector used by the menu", () => {
    expect(helperSource).toContain("export function isRsvpManageTarget");
    expect(helperSource).toContain('event.event_type === "rsvp"');
    expect(helperSource).toContain("event.isRsvp === true");
    expect(menuSource).toContain('from "./rsvpManageTarget"');
    expect(menuSource).toContain("const isRsvp = isRsvpManageTarget(event)");
  });

  test("RSVP dashboard already says Cancel RSVP — Hub menu must match", () => {
    const rsvpDash = fs.readFileSync(
      path.join(businessRoot, "app/rsvp/[id]/index.tsx"),
      "utf8",
    );
    expect(rsvpDash).toContain('label="Cancel RSVP"');
    expect(rsvpDash).toContain('label="Return RSVP to draft"');
    expect(menuSource).toContain('label: "Cancel RSVP"');
    expect(menuSource).toContain('label: "Return RSVP to draft"');
  });
});
