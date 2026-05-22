/**
 * ORCH-0911 [Buyer-web checkout confirm black screen] — ADVERSARIAL
 * regression tests. Tester-authored 2026-05-22. Attack DIFFERENT angles
 * than the implementor's happy-path file
 * `orch_0911_confirm_loading_state.test.tsx`:
 *   - happy-path proves the hero branches exist
 *   - adversarial proves (a) the hasCs gate reads ONLY the URL (NOT
 *     sessionStorage), (b) the new hasCs hero is nested INSIDE
 *     `Platform.OS === "web"` so non-web preserves the bare host shell,
 *     (c) the deleted ORCH-0852 realtimePending+event-gated hero is GONE
 *     (subtract-before-adding), and (d) no retry/help-link/dead-end UI
 *     was introduced (ORCH-0852 architectural ban preserved).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "../confirm.tsx"), "utf8");

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

function sliceResultNullBranch(): string {
  const startIndex = activeSource.indexOf("if (result === null)");
  const endIndex = activeSource.indexOf("if (event === null)", startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return activeSource.slice(startIndex, endIndex);
}

describe("ORCH-0911 — event confirm adversarial gates", () => {
  it("TA-EV-01: hasCs hero gate reads ONLY the URL search string, NOT sessionStorage", () => {
    // The new branch must show the hero whenever `?cs=` is in the URL —
    // independent of whether the resume sessionStorage payload survived.
    // If a future engineer gates the hero on `readCheckoutResumePayload`
    // returning non-null, cross-browser arrivals (private mode, cleared
    // storage) would regress to the black-screen state RC-2 was meant to
    // eliminate.
    const branch = sliceResultNullBranch();
    expect(branch).toContain("globalThis as unknown as");
    expect(branch).toContain("location?: { search?: string }");
    expect(branch).toContain("const hasCs = /[?&]cs=/.test");
    // hasCs branch must NOT read sessionStorage as a gate
    const hasCsBlock = branch.slice(branch.indexOf("if (hasCs)"));
    expect(hasCsBlock).not.toMatch(/sessionStorage/);
    expect(hasCsBlock).not.toMatch(/readCheckoutResumePayload/);
  });

  it("TA-EV-02: hasCs hero is nested INSIDE Platform.OS==='web' — non-web platforms preserve bare host shell on result===null", () => {
    // Native (iOS/Android) hits this confirm route only via expo-router
    // path resolution; the redirect should always come from PaymentSheet
    // native flow + custom-scheme deep link, NOT the web hero. If the
    // hasCs branch fired on native, it would race with the native
    // resolution logic. Adversarial guard: the new hero MUST be inside
    // the `if (Platform.OS === "web")` block.
    const branch = sliceResultNullBranch();
    const webBlockStart = branch.indexOf('Platform.OS === "web"');
    const hasCsBlockStart = branch.indexOf("const hasCs =");
    const heroLiteralStart = branch.indexOf("Confirming your tickets…");
    expect(webBlockStart).toBeGreaterThanOrEqual(0);
    expect(hasCsBlockStart).toBeGreaterThan(webBlockStart);
    expect(heroLiteralStart).toBeGreaterThan(hasCsBlockStart);
    // The bare-host fall-through must appear AFTER the hasCs hero
    // (so non-web + no-?cs= paths hit it) — proves no-?cs= and native
    // platforms both reach the bare host shell without hitting the hero.
    const bareReturnIdx = branch.lastIndexOf(
      "return <View style={styles.host} />;",
    );
    expect(bareReturnIdx).toBeGreaterThan(hasCsBlockStart);
  });

  it("TA-EV-03: deleted pre-fix realtimePending+event-gated hero block is GONE (subtract-before-adding)", () => {
    // The pre-ORCH-0911 hero block at lines 359-378 required BOTH
    // realtimePending===true AND event !== null. The SPEC explicitly
    // demands its removal. Constitution #8: do not layer the new hero
    // on top of the old hero. Adversarial guard: prove the old gating
    // is no longer present anywhere in the active source.
    expect(activeSource).not.toMatch(
      /result === null\s*&&\s*realtimePending\s*&&\s*event !== null/,
    );
    expect(activeSource).not.toMatch(
      /Platform\.OS === "web"\s*&&\s*result === null\s*&&\s*realtimePending\s*&&\s*event !== null/,
    );
  });

  it("TA-EV-04: no retry button, help link, or dead-end fallback was introduced (ORCH-0852 architectural ban preserved)", () => {
    // ORCH-0852 explicitly forbids retry/help/dead-end UI on the confirm
    // screen. The pending hero is the calm state; auto-resolution via
    // sync confirm + Realtime is the recovery mechanism. Adversarial:
    // prove no new copy or controls were added that violate the ban.
    const branch = sliceResultNullBranch();
    expect(branch).not.toMatch(/\bRetry\b/i);
    expect(branch).not.toMatch(/Try again/i);
    expect(branch).not.toMatch(/\bRefresh\b/i);
    expect(branch).not.toMatch(/help@usemingla\.com/i);
    expect(branch).not.toMatch(/contact (?:us|support)/i);
    expect(branch).not.toMatch(/something went wrong/i);
    expect(branch).not.toMatch(/onPress=\{/);
    expect(branch).not.toMatch(/<Button\b/);
    expect(branch).not.toMatch(/Pressable/);
    expect(branch).not.toMatch(/TouchableOpacity/);
  });
});
