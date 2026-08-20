import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const packageRoot = resolve(__dirname, "..");
const builder = join(packageRoot, "scripts/build-invite-critical-entry.mjs");

function fixture(): { dir: string; source: string } {
  const dir = mkdtempSync(join(tmpdir(), "issue922-happy-"));
  const jsDir = join(dir, "_expo/static/js/web");
  mkdirSync(jsDir, { recursive: true });
  const tags = [
    '<script nonce="nonce-a" src="/_expo/static/js/web/runtime-a.js?v=orch1091" defer data-orch1091-js-cache-bust="true"></script>',
    '<script src="/_expo/static/js/web/common-b.js?v=orch1091" crossorigin="anonymous" integrity="sha256-test" defer></script>',
    '<script referrerpolicy="no-referrer" src="/_expo/static/js/web/index-c.js?v=orch1091" defer></script>',
  ];
  for (const name of ["runtime-a.js", "common-b.js", "index-c.js"]) writeFileSync(join(jsDir, name), "// fixture");
  const source = `<!doctype html><html><head></head><body><div id="root"></div>${tags.join("")}</body></html>`;
  writeFileSync(join(dir, "index.html"), source);
  return { dir, source };
}

describe("issue #922 dedicated invitation entry", () => {
  test("removes only the three eager tags, preserves their metadata, and never mutates index.html", () => {
    const { dir, source } = fixture();
    execFileSync(process.execPath, [builder, "--build-dir", dir], {
      env: { ...process.env, NODE_ENV: "test" },
    });
    const output = readFileSync(join(dir, "accept-brand-invitation-entry.html"), "utf8");
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(source);
    expect(output.match(/<script[^>]+src=/g)).toBeNull();
    for (const pin of ["nonce-a", "crossorigin", "sha256-test", "referrerpolicy", "data-orch1091-js-cache-bust"]) {
      expect(output).toContain(pin);
    }
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(20_000);
    expect(gzipSync(output).byteLength).toBeLessThanOrEqual(6_000);
    expect(output.match(/id="issue-922-critical-entry"/g)).toHaveLength(1);
    expect(output).toContain(".i922-host{transform:translateZ(0)}");
  });

  test("pins the copied UI, storage, consent, routing, and owner contracts", () => {
    const inviteRoute = readFileSync(join(packageRoot, "app/accept-brand-invitation.tsx"), "utf8");
    const consent = readFileSync(join(packageRoot, "src/analytics/ConsentBanner.web.tsx"), "utf8");
    const analytics = readFileSync(join(packageRoot, "src/analytics/webAnalytics.web.ts"), "utf8");
    const button = readFileSync(join(packageRoot, "src/components/ui/Button.tsx"), "utf8");
    const tokens = readFileSync(join(packageRoot, "src/constants/designSystem.ts"), "utf8");
    const builderSource = readFileSync(builder, "utf8");
    for (const copy of ["You're invited", "Sign in to accept this invitation. We'll bring you right back.", "Sign in"]) {
      expect(inviteRoute).toContain(copy);
      expect(builderSource).toContain(copy.replace(/'/g, "\\'"));
    }
    for (const copy of ["Cookies &amp; analytics", "Accept all", "Reject", "Manage analytics preferences", "https://usemingla.com/privacy-policy"]) {
      expect(consent).toContain(copy);
      expect(builderSource).toContain(copy);
    }
    expect(analytics.indexOf("__minglaPrebootConsentChoice")).toBeLessThan(analytics.indexOf("window.localStorage.getItem(CONSENT_STORAGE_KEY)"));
    expect(analytics).not.toContain("delete window.__minglaPrebootConsentChoice");
    expect(analytics).toContain('JSON.stringify({ choice, ts: Date.now() })');
    expect(button).toContain("const SIZE_HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 }");
    expect(tokens).toContain('warm: "#eb7825"');
    expect(tokens).toContain('discover: "#0c0e12"');
  });

  test.each(["granted", "denied"] as const)(
    "keeps a %s preboot choice visible to sequential production readers when storage writes fail",
    (choice) => {
      jest.resetModules();
      jest.doMock("expo-constants", () => ({
        __esModule: true,
        default: { expoConfig: { extra: {} } },
      }));
      const setItem = jest.fn(() => {
        throw new Error("readable storage rejected the consent write");
      });
      const fakeWindow = {
        __minglaPrebootConsentChoice: choice,
        localStorage: {
          getItem: jest.fn(() => null),
          setItem,
        },
      };
      (globalThis as unknown as { window: unknown }).window = fakeWindow;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const analytics = require("../src/analytics/webAnalytics.web") as typeof import("../src/analytics/webAnalytics.web");

      if (choice === "granted") analytics.grantConsent();
      else analytics.denyConsent();

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(analytics.readStoredConsent()).toBe(choice);
      expect(analytics.readStoredConsent()).toBe(choice);
      expect(fakeWindow.__minglaPrebootConsentChoice).toBe(choice);

      delete (globalThis as unknown as { window?: unknown }).window;
      jest.resetModules();
    },
  );
});
