/**
 * #3431 (RSVP tutorial recording, 2026-09-17) — a number pad shows ONE Done.
 *
 * SYMPTOM: focusing RSVP Step 5's "Max guests" showed two Done controls at
 * once: the app's full-width Done bar (KeyboardToolbarRoot) and a separate
 * floating "Done" pill at the bottom right.
 *
 * CAUSE: React Native iOS adds its own UIToolbar "Done" accessory to any
 * number-pad / decimal-pad / phone-pad TextInput that sets a `returnKeyType`
 * (RCTTextInputComponentView setDefaultInputAccessoryView). NumberStepper set
 * `returnKeyType="done"`. The app-root bar already dismisses every field.
 *
 * GUARD: no Business TextInput pairs a pad keyboard with a returnKeyType unless
 * it brings its own accessory (`inputAccessoryViewID`, which suppresses
 * React Native's). Source-level, because the accessory is native-only.
 *
 * FAILS ON REVERT: put `returnKeyType="done"` back on NumberStepper's field.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(name) ? [full] : [];
  });

/** Each `<TextInput …>` opening element, attributes included. */
const textInputElements = (src: string): string[] => {
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = src.indexOf("<TextInput", from);
    if (start === -1) return found;
    const next = src[start + "<TextInput".length];
    if (next !== undefined && /[A-Za-z0-9_.]/.test(next)) {
      from = start + 1;
      continue;
    }
    let depth = 0;
    let end = start;
    for (; end < src.length; end += 1) {
      const ch = src[end];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      else if (ch === ">" && depth === 0) break;
    }
    found.push(src.slice(start, end + 1));
    from = end + 1;
  }
};

const PAD_KEYBOARD = /keyboardType=(?:"(?:number-pad|decimal-pad|phone-pad)"|\{[^}]*(?:number-pad|decimal-pad|phone-pad)[^}]*\})/;

describe("number pads get exactly one Done control", () => {
  it("NumberStepper's typed field sets no returnKeyType", () => {
    const src = readFileSync(join(SRC_ROOT, "components", "ui", "NumberStepper.tsx"), "utf8");
    const fields = textInputElements(src);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field).toMatch(PAD_KEYBOARD);
      expect(field).not.toMatch(/returnKeyType=/);
    }
  });

  it("no Business pad-keyboard TextInput sets a returnKeyType without its own accessory", () => {
    const offenders: string[] = [];
    let padFields = 0;
    for (const file of sourceFiles(SRC_ROOT)) {
      for (const field of textInputElements(readFileSync(file, "utf8"))) {
        if (!PAD_KEYBOARD.test(field)) continue;
        padFields += 1;
        if (/returnKeyType=/.test(field) && !/inputAccessoryViewID=/.test(field)) {
          offenders.push(relative(SRC_ROOT, file));
        }
      }
    }
    // The scan must actually see pad fields, or a green result proves nothing.
    expect(padFields).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});
