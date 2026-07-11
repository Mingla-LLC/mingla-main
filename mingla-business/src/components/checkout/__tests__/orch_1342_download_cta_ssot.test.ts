/**
 * ORCH-1342 [web-see-whos-going-funnel] — F-12 store-links SSOT regression
 * (SPEC §4.1 / §7 T-14 grep half + SC-5; META-ORCH-1337 Leg 5).
 *
 * The post-checkout DownloadMinglaCta shipped a DEAD iOS App Store URL
 * (`apps.apple.com/app/mingla` — the live listing is id6760440898). This suite
 * pins the fix: the CTA imports the drift-gated SSOT
 * (src/constants/storeLinks.ts) whose values BYTE-EQUAL the marketing SSOT
 * (mingla-marketing/lib/store-links.ts), and the stale literal is GONE.
 *
 * FAILS-ON-REVERT: re-hardcoding `apps.apple.com/app/mingla` (or ANY store
 * literal) in DownloadMinglaCta, deleting the SSOT import, or drifting the
 * SSOT values from marketing makes a named assertion FAIL (alongside the
 * orch-1342-store-links-ssot strict-grep gate, T-A9).
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  APP_STORE_URL,
  DOWNLOAD_PAGE_URL,
  GUEST_FUNNEL_ONELINK_URL,
  PLAY_STORE_URL,
} from "../../../constants/storeLinks";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8");
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const cta = strip(read("../DownloadMinglaCta.tsx"));
const marketing = read("../../../../../mingla-marketing/lib/store-links.ts");

const parseConst = (src: string, name: string): string | null => {
  const m = new RegExp(
    `export\\s+const\\s+${name}\\s*(?::[^=]+)?=\\s*\\n?\\s*['"]([^'"]+)['"]`,
  ).exec(src);
  return m ? m[1] : null;
};

describe("ORCH-1342 SC-5 / F-12 — DownloadMinglaCta rides the SSOT", () => {
  test("the stale dead literal is GONE and no store literal remains inline", () => {
    expect(cta).not.toContain("apps.apple.com/app/mingla");
    expect(cta).not.toContain("apps.apple.com");
    expect(cta).not.toContain("play.google.com");
  });
  test("the CTA imports APP_STORE_URL / PLAY_STORE_URL from the SSOT", () => {
    expect(cta).toContain(
      'import { APP_STORE_URL, PLAY_STORE_URL } from "../../constants/storeLinks";',
    );
    // the platform branches still consume both constants (no dead import).
    expect(cta).toContain("APP_STORE_URL");
    expect(cta).toContain("PLAY_STORE_URL");
    // the universal-link fallback behavior is unchanged.
    expect(cta).toContain("usemingla.com/orders/");
  });
});

describe("ORCH-1342 §4.1 — SSOT values byte-equal the marketing SSOT", () => {
  test("APP_STORE_URL matches mingla-marketing/lib/store-links.ts", () => {
    expect(APP_STORE_URL).toBe(parseConst(marketing, "APP_STORE_URL"));
    expect(APP_STORE_URL).toBe("https://apps.apple.com/app/id6760440898");
  });
  test("PLAY_STORE_URL matches mingla-marketing/lib/store-links.ts", () => {
    expect(PLAY_STORE_URL).toBe(parseConst(marketing, "PLAY_STORE_URL"));
    expect(PLAY_STORE_URL).toBe(
      "https://play.google.com/store/apps/details?id=com.mingla.app.v2",
    );
  });
  test("the smart-download page target (ORCH-1319 route)", () => {
    expect(DOWNLOAD_PAGE_URL).toBe("https://usemingla.com/download");
  });
  test("the guest-funnel OneLink flip constant ships DARK on this branch (SPEC §4.1)", () => {
    expect(GUEST_FUNNEL_ONELINK_URL).toBeNull();
  });
});
