/**
 * ORCH-1124 [cover-video Sound/Mute pill unreachable under floating chrome]
 * — TESTER ADVERSARIAL TEST (different angle than the implementor's).
 *
 * The implementor's happy-path tests (in eventCoverMedia.test.ts) assert the
 * POSITION contract only: PublicEventPage must not pin the pill to a top
 * position, and EventCoverMedia's default is "bottomRight" at right:14/bottom:14.
 *
 * Those tests would still pass if a future regression moved the pill correctly
 * to the bottom-right but BROKE OR REMOVED the tap handler, or buried the pill
 * under cover children — i.e. the pill renders in the right place yet is a DEAD
 * TAP. Moving a control without keeping it FIRING is the exact class of bug
 * ORCH-1124 exists to kill ([[feedback_interactive_elements_must_fire_runtime_proof]]).
 *
 * Runtime proof for this ORCH was captured in Chromium against the live
 * /e/leggothis/a-life-in-vegas video-cover page: dispatching a click on the
 * bottom-right pill toggled aria-label "Turn on cover video audio" ->
 * "Mute cover video audio" and the <video>.muted property true -> false -> true.
 * This source-level adversarial test locks the FIRING WIRING + STACKING so the
 * runtime-proven behaviour cannot silently regress in CI (the repo Jest harness
 * runs in a Node env without react-test-renderer, so render-mount is not
 * available — see PublicBrandPage.closeButton.test.tsx harness note).
 *
 * Append-only; targets a DIFFERENT angle (handler firing + stacking) than the
 * implementor's position-only assertions.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const coverMediaSource = (): string =>
  readFileSync(
    path.join(process.cwd(), "../packages/offering-rendering/EventCoverMedia.tsx"),
    "utf8",
  );

describe("ORCH-1124 adversarial — bottom-right cover audio pill must FIRE, not just sit there", () => {
  // ANGLE 1 — the pill is a Pressable whose onPress TOGGLES mute state and
  // notifies the parent. A regression that keeps bottomRight but drops this
  // wiring (turning the relocated pill into a dead tap) MUST fail here.
  test("audio pill onPress toggles isMuted and calls onMutedChange (the tap fires)", () => {
    const src = coverMediaSource();
    // Isolate the audio-control Pressable block.
    const pressableIdx = src.indexOf("setIsMuted((prev) =>");
    expect(pressableIdx).toBeGreaterThan(-1);
    const block = src.slice(pressableIdx, pressableIdx + 320);
    // It flips the boolean...
    expect(block).toContain("const next = !prev;");
    // ...notifies the parent (the audio actually changes upstream)...
    expect(block).toContain("onMutedChange?.(next);");
    // ...and persists the new value.
    expect(block).toContain("return next;");
  });

  // ANGLE 2 — a button that renders behind other content is also a dead tap.
  // The audio control carries a positive zIndex so the bottom-right pill stacks
  // ABOVE the cover media/overlay. A regression that drops the zIndex would let
  // the (correctly positioned) pill be swallowed — must fail here.
  test("audio control is stacked above the cover (positive zIndex) so it stays tappable", () => {
    const src = coverMediaSource();
    const styleIdx = src.indexOf("audioControl: {");
    expect(styleIdx).toBeGreaterThan(-1);
    const styleBlock = src.slice(styleIdx, styleIdx + 320);
    expect(styleBlock).toContain("position: \"absolute\"");
    const zMatch = styleBlock.match(/zIndex:\s*(\d+)/);
    expect(zMatch).not.toBeNull();
    expect(Number(zMatch![1])).toBeGreaterThanOrEqual(1);
  });

  // ANGLE 3 — the "bottomRight" default must actually route to the
  // audioControlBottomRight style in the style-selection chain (not just exist
  // as a dead style). Position default + style branch must be connected, else
  // the default falls back to the unpositioned base and overlaps the chrome
  // again. The implementor tests check the default value and the style's
  // coordinates separately; this asserts the WIRING between them.
  test("the bottomRight position is wired to its style branch in the Pressable", () => {
    const src = coverMediaSource();
    expect(src).toContain('audioControlPosition = "bottomRight"');
    expect(src).toMatch(
      /audioControlPosition === "bottomRight"[\s\S]{0,60}styles\.audioControlBottomRight/,
    );
  });
});
