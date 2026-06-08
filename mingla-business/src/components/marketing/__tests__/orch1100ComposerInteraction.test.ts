import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

/**
 * ORCH-1100 RC-3 — composer Back-button + body-tappability web fixes.
 *
 * Device-proven (phone web only, pre-existing):
 *
 *  (1) BACK dead: `compose.tsx` `navigation.addListener("beforeRemove")` called
 *      `preventDefault()` then `Alert.alert(...)`. `Alert.alert` is a NO-OP on
 *      react-native-web, so the navigation stayed cancelled forever and Back
 *      looked dead. Fix (web only): rely on the existing debounced autosave —
 *      fire one final flush and let the navigation proceed (no preventDefault,
 *      no no-op dialog). Native keeps the `Alert.alert` Save/Discard guard.
 *
 *  (2) BODY untappable: `ComposerV2Editor` used a fixed numeric `bodyHeight`
 *      (`CHROME_CONTENT_PX=376`, iPhone-pell tuned) with NO ScrollView. On phone
 *      web the extra TopBar + MarketingSubNav + URL bar overflow the budget and
 *      the contenteditable collapsed to a ~23px strip. Fix (web only): give
 *      phone web a robust min body height + wrap the narrow-web editor column in
 *      a ScrollView (`ComposerCanvas.web.tsx`) so the whole body is tappable and
 *      scrollable. Native iOS pell fixed-height / no-ScrollView layout unchanged.
 *
 * jest.config.cjs uses `testEnvironment: node` (no jsdom) — source/structural
 * assertions are the established business CI pattern. The fails-on-revert anchor:
 * if the web back-guard reverts to preventDefault+Alert on web, or the narrow-web
 * scroll wrapper / phone-web body floor is removed, these tests FAIL.
 */

// __dirname = mingla-business/src/components/marketing/__tests__ → 4 up = mingla-business/
const BIZ_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(BIZ_ROOT, rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const COMPOSE = "app/(tabs)/marketing/campaigns/compose.tsx";
const EDITOR = "src/components/marketing/ComposerV2/ComposerV2Editor.tsx";
const CANVAS_WEB = "src/components/marketing/ComposerV2/ComposerCanvas.web.tsx";
const CANVAS_NATIVE = "src/components/marketing/ComposerV2/ComposerCanvas.tsx";

describe("ORCH-1100 RC-3 (1) — Back guard is web-gated", () => {
  const code = stripComments(read(COMPOSE));

  test("the beforeRemove listener has a web branch that does NOT preventDefault", () => {
    // On web we early-return before ev.preventDefault?.() + Alert.alert.
    expect(code).toMatch(
      /Platform\.OS\s*===\s*["']web["'][\s\S]{0,200}flushDraft\(\)[\s\S]{0,60}return;/,
    );
  });

  test("the web branch fires a final autosave flush so the draft is preserved", () => {
    // After the dirty check, the web path calls flushDraft() (autosave) and
    // returns — relying on autosave instead of a no-op Alert dialog.
    expect(code).toMatch(/if\s*\(\s*Platform\.OS\s*===\s*["']web["']\s*\)\s*\{[\s\S]{0,160}flushDraft\(\)/);
  });

  test("native path still preventDefaults + shows the Alert Save/Discard guard", () => {
    // The Alert.alert dirty-guard must remain for native; the web early-return
    // sits ABOVE it so native still reaches it.
    expect(code).toMatch(/ev\.preventDefault\?\.\(\)/);
    expect(code).toMatch(/Alert\.alert\(\s*\n?\s*["']Save your draft\?["']/);
  });

  test("the web early-return precedes the preventDefault (so web never cancels nav)", () => {
    const webIdx = code.search(/Platform\.OS\s*===\s*["']web["']/);
    const preventIdx = code.search(/ev\.preventDefault\?\.\(\)/);
    expect(webIdx).toBeGreaterThan(-1);
    expect(preventIdx).toBeGreaterThan(-1);
    expect(webIdx).toBeLessThan(preventIdx);
  });
});

describe("ORCH-1100 RC-3 (2) — body height + scroll are web-gated", () => {
  const editor = stripComments(read(EDITOR));
  const canvasWeb = stripComments(read(CANVAS_WEB));
  const canvasNative = stripComments(read(CANVAS_NATIVE));

  test("editor computes an isPhoneWeb flag (web AND not wide-desktop)", () => {
    expect(editor).toMatch(/isPhoneWeb\s*=\s*isWeb\s*&&\s*!isWideDesktop/);
  });

  test("phone web gets a robust minimum body height (no 23px strip collapse)", () => {
    // A floor of at least a few hundred px so the contenteditable is always
    // tappable; the original 120px keyboard-up floor would still be too small
    // for the phone-web no-keyboard case.
    expect(editor).toMatch(/PHONE_WEB_BODY_MIN_PX\s*=\s*3[0-9]{2}/);
    expect(editor).toMatch(
      /isPhoneWeb[\s\S]{0,120}Math\.max\(\s*PHONE_WEB_BODY_MIN_PX/,
    );
  });

  test("narrow-web editor column is wrapped in a ScrollView (body reachable)", () => {
    expect(canvasWeb).toMatch(/import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*["']react-native["']/);
    // The !isWideDesktop fall-through now returns a ScrollView, not a bare <>.
    expect(canvasWeb).toMatch(
      /!\s*isWideDesktop[\s\S]{0,400}<ScrollView[\s\S]{0,400}\{editor\}[\s\S]{0,120}<\/ScrollView>/,
    );
  });

  test("native ComposerCanvas stays a Fragment passthrough (no web ScrollView)", () => {
    // The native pell "NO ScrollView around the editor" constraint is untouched.
    expect(canvasNative).toMatch(/return\s*<>\{editor\}<\/>/);
    expect(canvasNative).not.toMatch(/<ScrollView/);
  });
});
