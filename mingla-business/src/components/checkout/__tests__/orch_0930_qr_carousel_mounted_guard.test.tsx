/**
 * ORCH-0930 [TicketQrCarousel React #418 hydration mismatch on Expo web
 * export] regression test — happy path.
 *
 * Bug: `react-native-qrcode-svg` produces SVG output that differs between
 * Expo SDK 54 web-export static HTML (build-time) and post-hydration
 * client render → React aborts the subtree with minified error #418
 * ("Hydration failed because the initial UI does not match what was
 * rendered on the server"). Playwright forensic harness 2026-05-23
 * confirmed: confirm.tsx flow works end-to-end, order data populates,
 * page chrome renders, but svgCount=1 not 4 (for 4-ticket order) and
 * pageerror surfaces React #418 — the carousel's <QRCode> subtree is
 * the one bailing.
 *
 * Fix: client-only-mount guard around every <QRCode> render. Defer the
 * mount until after the first client effect tick (mounted state flips
 * false → true in useEffect). Native (iOS/Android) is unaffected
 * because they don't SSR; mounted=false → useEffect fires synchronously
 * on first mount → mounted=true → render is identical to pre-fix
 * native behavior.
 *
 * Pattern: source-string assertion (matches the orch_0911 +
 * orch_0928 sibling tests under app/checkout-trip/[tripEventId]/
 * __tests__/). The repo does not install @testing-library/react-native
 * so component-tree assertions are not feasible; instead we pin the
 * mounted-guard contract at source level.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(__dirname, "../TicketQrCarousel.tsx"),
  "utf8",
);

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

describe("ORCH-0930 — TicketQrCarousel client-only-mount guard", () => {
  it("HP-1: imports useEffect (was previously only useCallback/useMemo/useState)", () => {
    expect(activeSource).toMatch(
      /import\s+React,\s*\{[^}]*\buseEffect\b[^}]*\}\s+from\s+["']react["']/,
    );
  });

  it("HP-2: declares `mounted` state initialized to false", () => {
    expect(activeSource).toMatch(
      /const\s+\[\s*mounted\s*,\s*setMounted\s*\]\s*=\s*useState<boolean>\(\s*false\s*\)/,
    );
  });

  it("HP-3: useEffect flips mounted to true (synchronous on client mount, never on SSR)", () => {
    // Match `useEffect(() => { setMounted(true); }, []);` with optional
    // whitespace + braces/no-braces single-expression styles.
    expect(activeSource).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*setMounted\(true\);?\s*\},\s*\[\s*\]\s*\)/,
    );
  });

  it("HP-4: both <QRCode> usages are wrapped in `mounted ? <QRCode .../> : <View>` ternary", () => {
    // Count the QRCode usages — should be exactly 2 (single-ticket + multi-ticket page).
    const qrUsages = activeSource.match(/<QRCode\b/g);
    expect(qrUsages).not.toBeNull();
    expect((qrUsages ?? []).length).toBe(2);

    // Count the mounted-guard wrappers — should also be exactly 2.
    const mountedGuards = activeSource.match(/mounted\s*\?\s*\(?\s*<QRCode/g);
    expect(mountedGuards).not.toBeNull();
    expect((mountedGuards ?? []).length).toBe(2);
  });

  it("HP-5: placeholder Views render explicit qrSize dimensions when not mounted (no layout shift)", () => {
    // Each mounted-guard ternary's false branch should be a <View> with
    // width: qrSize, height: qrSize so the layout doesn't shift when the
    // QR mounts. Match the View placeholder shape.
    const placeholders = activeSource.match(
      /<View\s+style=\{\{\s*width:\s*qrSize\s*,\s*height:\s*qrSize/g,
    );
    expect(placeholders).not.toBeNull();
    expect((placeholders ?? []).length).toBe(2);
  });
});

describe("ORCH-0930 v2 — parent-level hydration gate (confirm.tsx)", () => {
  // v1 (component-level mount guard inside TicketQrCarousel) was insufficient:
  // Playwright forensic 2026-05-23 with v1 deployed showed the carousel still
  // wipes (svgCount=1, hasCarousel=false, React error #418). The hydration
  // mismatch must fire BEFORE the component-level mount-guard runs. v2 adds
  // a PARENT-level hydration gate in each confirm.tsx route that defers
  // mounting the entire <TicketQrCarousel> until after first client effect.
  const tripConfirm = readFileSync(
    join(__dirname, "../../../../app/checkout-trip/[tripEventId]/confirm.tsx"),
    "utf8",
  );
  const eventConfirm = readFileSync(
    join(__dirname, "../../../../app/checkout/[eventId]/confirm.tsx"),
    "utf8",
  );

  function stripCommentsLocal(value: string): string {
    return value
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/[ \t]\/\/[^\n]*$/gm, "");
  }

  const tripActive = stripCommentsLocal(tripConfirm);
  const eventActive = stripCommentsLocal(eventConfirm);

  it("HP-6 (trip): confirm.tsx has a `hydrated` state that flips true on first useEffect", () => {
    expect(tripActive).toMatch(
      /const\s+\[\s*hydrated\s*,\s*setHydrated\s*\]\s*=\s*useState<boolean>\(\s*false\s*\)/,
    );
    expect(tripActive).toMatch(
      /useEffect\(\(\)\s*=>\s*\{\s*setHydrated\(true\);?\s*\},\s*\[\s*\]\s*\)/,
    );
  });

  it("HP-7 (trip): <TicketQrCarousel> mount is gated on `hydrated && totalTickets > 0`", () => {
    expect(tripActive).toMatch(
      /\{\s*hydrated\s*&&\s*totalTickets\s*>\s*0\s*\?\s*\(?\s*<TicketQrCarousel/,
    );
  });

  it("HP-8 (event): confirm.tsx mirrors the hydrated gate", () => {
    expect(eventActive).toMatch(
      /const\s+\[\s*hydrated\s*,\s*setHydrated\s*\]\s*=\s*useState<boolean>\(\s*false\s*\)/,
    );
    expect(eventActive).toMatch(
      /\{\s*hydrated\s*&&\s*totalTickets\s*>\s*0\s*\?\s*\(?\s*<TicketQrCarousel/,
    );
  });
});
