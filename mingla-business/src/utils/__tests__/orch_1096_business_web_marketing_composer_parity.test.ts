import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// [TEST-MOD-APPROVED ORCH-1098] ORCH-1096 shipped a hand-rolled browser
// "Marketing Composer" runtime injected into the static phone shell as a
// lightweight stand-in for /marketing/campaigns/compose. ORCH-1098 Stage 3
// fixed the BottomNav reanimated OOM, so the REAL Expo composer route boots on
// phones and the stand-in runtime + its CI gate were RETIRED. This file is
// preserved (append-only policy forbids test deletion) and rewritten to assert
// the OPPOSITE invariant: the stand-in composer runtime is GONE, while the real
// ComposerV2 web/native split (the genuinely-kept work) stays intact.

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");
const exists = (relativePath: string): boolean =>
  existsSync(join(REPO_ROOT, "mingla-business", relativePath));
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

describe("ORCH-1096 stand-in composer runtime is retired (ORCH-1098 Stage 3)", () => {
  test("the hand-rolled browser composer runtime file is deleted", () => {
    expect(exists("scripts/mobile-web-marketing-composer-runtime.js")).toBe(false);
  });

  test("the inject script no longer references the stand-in composer runtime", () => {
    const inject = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));
    expect(inject).not.toContain("mobile-web-marketing-composer-runtime");
    expect(inject).not.toContain("COMPOSER_RUNTIME_SOURCE");
    expect(inject).not.toContain("renderMarketingComposerRoute");
  });

  test("the real ComposerV2 compose route + web/native editor split stays intact", () => {
    const composeRoute = repoFile("app/(tabs)/marketing/campaigns/compose.tsx");
    expect(composeRoute).toContain("ComposerV2Editor");
    expect(composeRoute).toContain("SchedulePickerSheet");
    expect(composeRoute).not.toContain("redirectMobileBusinessWebToStaticHome");

    const webEditor = repoFile("src/components/marketing/ComposerV2/richEditor.tsx");
    const nativeEditor = repoFile("src/components/marketing/ComposerV2/richEditor.native.ts");
    expect(webEditor).toContain("@tiptap/react");
    expect(nativeEditor).toContain("react-native-pell-rich-editor");
    expect(nativeEditor).not.toContain("@tiptap/react");
  });
});
