/**
 * ORCH-0884 [IntakeTypePickerSheet height + sibling-Modal race] — hotfix
 * regression test (implementor + tester combined since both fixes ship in
 * the same hotfix bundle per ORCH-0840 narrow-exception for tightly-coupled
 * regressions).
 *
 * Covers BOTH fixes in the ORCH-0884 hotfix:
 *
 * Fix A — sibling-Modal race in IntakeSchemaBuilder.handleTypePickerSelect:
 *   When the type picker fires onSelect, the picker's Sheet starts closing
 *   (UNMOUNT_DELAY_MS=280ms). If the editor's Sheet is mounted with
 *   visible=true immediately, both Modals are competing at the OS root
 *   layer and the newer (editor) Modal gets visually blocked → app appears
 *   frozen → buyer never sees the editor.
 *
 *   Initial Fix A used setTimeout(300ms). Operator live-fire on iPhone 17
 *   Pro dev build proved 300ms insufficient: iOS UIKit's UIViewController
 *   dismiss takes 150-200ms of additional native frames AFTER React's
 *   280ms unmount → editor presented while picker still mid-dismiss →
 *   editor silently dropped from presentation queue → invisible scrim
 *   intercepted next "+ Add question" tap → app appeared frozen.
 *
 *   Final fix bumps delay to 500ms (well past iOS UIKit dismiss
 *   completion). The test enforces the 500ms floor so a future revert to
 *   300ms (which compiles + passes type-check + passes the old
 *   ">=280ms" assertion) fails this gate.
 *
 * Fix B — IntakeTypePickerSheet snap height:
 *   The numeric snapPoint=520 measured short of actual content height
 *   (~556pt: 4 rows × 110pt cards + gaps + header + handle + body padding).
 *   The 36pt overflow clipped the File upload card's bottom half off-screen
 *   on iPhone 17 Pro. Fix bumps snapPoint to 640pt (≥600pt safety floor).
 *
 * Source-pattern presence test (read the file + assert the fix patterns
 * exist). Fails-on-revert anchor: removing the setTimeout wrap OR reducing
 * the height < 600 causes the test to FAIL.
 */

/* eslint-disable import/first */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

const SCHEMA_BUILDER_PATH = path.join(
  __dirname,
  "..",
  "IntakeSchemaBuilder.tsx",
);
const TYPE_PICKER_PATH = path.join(
  __dirname,
  "..",
  "IntakeTypePickerSheet.tsx",
);

describe("ORCH-0884 Fix A — sibling-Modal race in handleTypePickerSelect", () => {
  test("IntakeSchemaBuilder.handleTypePickerSelect wraps setEditorState in setTimeout >= 500ms", () => {
    const src = readFileSync(SCHEMA_BUILDER_PATH, "utf8");
    // Locate the handleTypePickerSelect callback DECLARATION (not a
    // comment mention). The leading "const " anchor skips JSDoc / inline
    // comment references to the handler name.
    const handlerIdx = src.indexOf("const handleTypePickerSelect");
    expect(handlerIdx).toBeGreaterThan(0);
    // Scan ~1500 chars after the handler start for the fix pattern
    const window = src.slice(handlerIdx, handlerIdx + 1500);
    // The fix MUST close the picker AND defer the editor mount via setTimeout
    expect(window).toMatch(/setTypePickerOpen\(false\)/);
    expect(window).toMatch(/setTimeout\s*\(/);
    expect(window).toMatch(/setEditorState\s*\(\s*\{[\s\S]*visible:\s*true/);
    // The delay must reference the EDITOR_OPEN_DELAY_MS module constant
    // (or be a numeric literal >= 500). Resolve EDITOR_OPEN_DELAY_MS by
    // scanning the file for its declaration.
    const constMatch = src.match(
      /const\s+EDITOR_OPEN_DELAY_MS\s*=\s*(\d+)/,
    );
    expect(constMatch).not.toBeNull();
    const delayMs = parseInt(constMatch![1], 10);
    // Operator live-fire on iPhone 17 Pro proved 300ms insufficient: iOS
    // UIKit dismiss takes additional frames past Sheet's 280ms unmount.
    // 500ms floor enforced so a revert to the original 300ms fails here.
    expect(delayMs).toBeGreaterThanOrEqual(500);
    // And the setTimeout call site must use the constant (so a future
    // edit to the constant cascades correctly). The arrow function body
    // contains setEditorState({ ... }) with its own commas/braces, so we
    // match non-greedy across the multi-line callback.
    expect(window).toMatch(
      /setTimeout\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?setEditorState[\s\S]*?\}\s*,\s*EDITOR_OPEN_DELAY_MS\s*\)/,
    );
  });
});

describe("ORCH-0884 Fix B — IntakeTypePickerSheet snap height", () => {
  test("TYPE_PICKER_SHEET_HEIGHT >= 600 so all 7 type cards fit on iPhone", () => {
    const src = readFileSync(TYPE_PICKER_PATH, "utf8");
    const heightMatch = src.match(
      /const\s+TYPE_PICKER_SHEET_HEIGHT\s*=\s*(\d+)/,
    );
    expect(heightMatch).not.toBeNull();
    const height = parseInt(heightMatch![1], 10);
    // Measured content height ≈ 556pt; 600pt safety floor gives ≥ 44pt
    // headroom above the actual rendered content.
    expect(height).toBeGreaterThanOrEqual(600);
  });

  test("IntakeTypePickerSheet wraps the grid in ScrollView for defense in depth", () => {
    const src = readFileSync(TYPE_PICKER_PATH, "utf8");
    // The grid MUST be inside a ScrollView so iPhone SE / small devices that
    // clamp 640pt down to 95%-screen still expose every card via scroll.
    expect(src).toMatch(/import.*ScrollView.*from\s*["']react-native["']/);
    // ScrollView element wraps the grid
    expect(src).toMatch(/<ScrollView[\s\S]*?contentContainerStyle=\{styles\.grid\}/);
    // Closing </ScrollView> tag present
    expect(src).toMatch(/<\/ScrollView>/);
  });
});
