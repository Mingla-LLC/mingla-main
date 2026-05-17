/* eslint-disable import/first */
/**
 * ORCH-0862 / F-6 — implementor regression test for the ACTUAL Symptom A
 * root cause: dual-RN-Modal presentation conflict.
 *
 * The freeze captured live on 2026-05-17 15:03:25 contained this UIKit
 * warning verbatim in /tmp/orch0862-rework-symptomA-uikit.txt:
 *
 *   "Attempt to present <RCTFabricModalHostViewController: 0x13f9ff200>
 *    on <UIViewController: 0x105231800> (from <RNSScreen: 0x138ef3700>)
 *    which is already presenting <RCTFabricModalHostViewController:
 *    0x13f9fe800>."
 *
 * Two native iOS modals fought on the same parent: EventManageMenu Sheet
 * primitive (still mounted with visible=false, its underlying RN Modal
 * mid-dismiss) collided with ConfirmDialog Modal (trying to present in
 * the same React commit after the user tapped Cancel event in the manage
 * menu). iOS UIKit rejects the second presentation, JS bridge stalls
 * waiting for the dismiss callback, app freezes.
 *
 * Hub-list cancel works because hub-list mounts EventManageMenu inside
 * `{manageCtx !== null ? <EventManageMenu .../> : null}` — when the user
 * taps Cancel, manageCtx flips to null, EventManageMenu UNMOUNTS entirely,
 * its native Modal is removed from the tree, ConfirmDialog can present
 * cleanly on the now-bare parent.
 *
 * F-6 mirrors the hub-list pattern on event-detail: gate the mount on
 * `brand !== null && manageMenuVisible`. When manageMenuVisible flips
 * false (in the same handler that sets cancelDialogVisible=true),
 * EventManageMenu unmounts before the ConfirmDialog Modal tries to mount.
 *
 * Fails-on-revert: if EventManageMenu is mounted unconditionally with
 * visible={manageMenuVisible} (the pre-fix shape), this test fails on the
 * structural assertion below.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_SOURCE_PATH = join(__dirname, "..", "index.tsx");

describe("ORCH-0862 F-6 — EventManageMenu unmounts fully when closed (dual-modal conflict fix)", () => {
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");

  test("source loads", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toContain("EventManageMenu");
  });

  test("EventManageMenu mount is gated on BOTH brand !== null AND manageMenuVisible", () => {
    // The fix's load-bearing assertion: the conditional render INCLUDES
    // manageMenuVisible (so EventManageMenu unmounts when closed). The
    // pre-fix shape was `{brand !== null ? <EventManageMenu .../> : null}`
    // which left it mounted with visible=false.
    //
    // Strip comments first so the protective comment block (which cites
    // the pre-fix shape) doesn't satisfy the grep.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const gatePattern =
      /brand\s*!==\s*null\s*&&\s*manageMenuVisible\s*\?\s*\(\s*<EventManageMenu/;
    expect(gatePattern.test(stripped)).toBe(true);
  });

  test("EventManageMenu mount is NOT gated on brand alone (pre-fix shape forbidden)", () => {
    // Defensive: ensure the pre-fix `{brand !== null ? <EventManageMenu visible={manageMenuVisible}/>}`
    // shape does NOT survive.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    // The pre-fix pattern: `brand !== null ? (` immediately followed by `<EventManageMenu`
    // (no `&&` between them). The fix introduces `&& manageMenuVisible`.
    const preFixPattern =
      /brand\s*!==\s*null\s*\?\s*\(\s*<EventManageMenu/;
    expect(preFixPattern.test(stripped)).toBe(false);
  });

  test("manage-menu still receives onClose handler", () => {
    // F-6 must not break the normal close path. The handleManageClose
    // callback still needs to wire to onClose so backdrop-tap dismisses
    // work.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(stripped).toMatch(/<EventManageMenu[\s\S]*?onClose=\{handleManageClose\}/);
  });

  test("F-6 protective comment present (ORCH-0862 reference)", () => {
    expect(source).toMatch(/ORCH-0862[\s\S]*F-6[\s\S]*unmount/);
  });

  test("Hub-list parity comment cited in the protective block", () => {
    // The fix mirrors the hub-list pattern; the comment cites that source
    // so future authors see WHY this structure exists.
    expect(source).toMatch(/hub.?list|hub\/events\.tsx/);
  });
});
