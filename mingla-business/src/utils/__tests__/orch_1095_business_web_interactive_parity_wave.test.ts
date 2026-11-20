import { describe, expect, test } from "@jest/globals";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// [TEST-MOD-APPROVED ORCH-1098] ORCH-1095 shipped a per-route "interactive
// parity" firewall + lightweight hand-rolled route entries injected into the
// static phone shell. ORCH-1098 Stage 3 fixed the underlying BottomNav
// reanimated OOM, so the REAL Expo routes boot on phones and that entire
// firewall/light-route layer (and the static /home it lived in) was RETIRED.
// This file is preserved (append-only policy forbids test deletion) and
// rewritten to assert the OPPOSITE invariant: the ORCH-1095 firewall is GONE.

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");
const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");

describe("ORCH-1095 interactive parity firewall is retired (ORCH-1098 Stage 3)", () => {
  test("the static /home stand-in the firewall lived in is gone", () => {
    expect(existsSync(join(REPO_ROOT, "mingla-business", "public/home.html"))).toBe(false);
  });

  test("the inject script no longer ships the light-route firewall/deferral loader", () => {
    const inject = stripComments(repoFile("scripts/inject-mobile-blur-css.mjs"));
    expect(inject).not.toContain("orch1093-mobile-route-script-deferral");
    expect(inject).not.toContain("isLightRoute");
    expect(inject).not.toContain("data-orch-1095-light-route-entry");
    expect(inject).not.toContain("renderMarketingComposerRoute");
    // but the genuinely-orthogonal perf helpers remain
    expect(inject).toContain("mingla-mobile-web-no-blur");
    expect(inject).toContain("mingla-mobile-web-chunk-recovery");
  });

  test("the static-home redirect util is deleted", () => {
    expect(
      existsSync(join(REPO_ROOT, "mingla-business", "src/utils/mobileWebStaticHomeRedirect.ts")),
    ).toBe(false);
  });

  test("the schedule picker is one Mingla calendar sheet on web and native, with no OS picker (#4523 replaced ORCH-1095's browser/native split)", () => {
    const picker = stripComments(
      repoFile("src/components/marketing/ComposerV2/SchedulePickerSheet.tsx"),
    );
    expect(picker).toContain("HostDateTimeField");
    expect(picker).not.toContain("@react-native-community/datetimepicker");
    expect(picker).not.toContain('type="date"');
    expect(existsSync(join(REPO_ROOT, "mingla-business", "src/components/marketing/ComposerV2/SchedulePickerSheet.native.tsx"))).toBe(false);
  });
});
