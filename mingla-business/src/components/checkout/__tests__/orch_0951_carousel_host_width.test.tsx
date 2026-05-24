/**
 * ORCH-0951 — Multi-ticket QR carousel host must have explicit width on RNW.
 *
 * Bug: `TicketQrCarousel.tsx`'s multi-ticket render path has an early-return
 * at `if (pageWidth === 0) return <View style={styles.host} onLayout={...}/>`
 * (ORCH-0852-era). The empty bare host inherits `alignSelf: "stretch"` from
 * `styles.host` but mounts inside a parent (`qrCard`) that uses `alignItems:
 * "center"` — on RNW the empty View collapses to ~0 width because no children
 * define its width and the center-aligned parent doesn't stretch it.
 * `onLayout` fires with width=0; `pageWidth` stays 0; the early-return loops
 * forever; user sees only the bare empty host (with `minHeight: 320`) as a
 * thin vertical strip — no QR codes ever render.
 *
 * Single-ticket case is unaffected — it uses `styles.singleWrap` which has
 * no `alignSelf: "stretch"` and sizes to its child QR image.
 *
 * Surfaced only after ORCH-0932 [Server-side QR PNG] landed — previously the
 * #418 hydration errors and ORCH-0930 v1/v2/v3 wrappers prevented us from
 * even getting this far in the multi-ticket pipeline. ORCH-0932 server-side
 * QR generation unblocked the rest, exposing this latent layout bug.
 *
 * Fix: add `width: "100%"` to `styles.host` so the empty bare host has a
 * definite width on first paint regardless of parent alignment. Native
 * (iOS/Android) ignores `width: "100%"` when no width constraint is present
 * — behavior identical to pre-fix.
 *
 * Live-fire evidence: operator screenshot 2026-05-24 of order
 * `d99081c3-c77d-462e-a0ff-1e0345222af5` (3× DC Adventure Standard).
 * DB confirms 3 valid tickets with qr_code populated; buyer-web carousel
 * renders only the thin strip.
 *
 * Pattern: source-string assertion (matches the orch_0930 sibling test in
 * this same directory).
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

describe("ORCH-0951 — TicketQrCarousel host width fix", () => {
  it("HP-1: styles.host declares `width: \"100%\"` so the empty bare host has a definite width on first paint (breaks the pageWidth chicken-and-egg)", () => {
    // Match the host stylesheet block specifically — we want the rule to
    // appear INSIDE `host: { ... }` so we don't accept stray `width: "100%"`
    // elsewhere as satisfying the contract.
    const hostBlockMatch = activeSource.match(
      /host:\s*\{[\s\S]*?\}/,
    );
    expect(hostBlockMatch).not.toBeNull();
    const hostBlock = hostBlockMatch?.[0] ?? "";
    expect(hostBlock).toMatch(/width:\s*["']100%["']/);
  });

  it("HP-2 (adversarial): the `pageWidth === 0` early-return path is preserved (defense vs. a future 'simplification' that would break the native paging contract)", () => {
    // The early-return exists for a reason — ORCH-0852 documented that
    // native paging needs a measured width before each Page can size
    // correctly to fill the horizontal pagingEnabled ScrollView. Removing
    // the gate to "fix" the strip bug would re-introduce the original
    // ORCH-0852 bug (oversized pages clipped by overflow-y: hidden) on
    // mobile native. ORCH-0951's correct fix is to give the bare host an
    // explicit width so the early-return resolves quickly, NOT to remove
    // the gate.
    expect(activeSource).toMatch(
      /if\s*\(\s*pageWidth\s*===\s*0\s*\)\s*\{\s*return\s+<View\s+style=\{styles\.host\}\s+onLayout=\{handleLayout\}\s*\/>/,
    );
  });

  it("HP-3 (adversarial): styles.host preserves `alignSelf: \"stretch\"` AND `alignItems: \"center\"` (the layout contract the fix complements, not replaces)", () => {
    const hostBlockMatch = activeSource.match(/host:\s*\{[\s\S]*?\}/);
    expect(hostBlockMatch).not.toBeNull();
    const hostBlock = hostBlockMatch?.[0] ?? "";
    expect(hostBlock).toMatch(/alignSelf:\s*["']stretch["']/);
    expect(hostBlock).toMatch(/alignItems:\s*["']center["']/);
  });

  it("HP-4 (adversarial): styles.singleWrap is NOT given width:\"100%\" (single-ticket path has no chicken-and-egg; this fix is scoped to the multi-ticket host)", () => {
    // The single-ticket case uses `styles.singleWrap` which sizes to its
    // child QR image and does NOT have the alignSelf:"stretch" inside a
    // center-aligned parent problem. Adding width:"100%" to singleWrap
    // would over-stretch the single-QR layout. This negative assertion
    // catches a copy-paste regression.
    const singleWrapBlockMatch = activeSource.match(
      /singleWrap:\s*\{[\s\S]*?\}/,
    );
    expect(singleWrapBlockMatch).not.toBeNull();
    const singleWrapBlock = singleWrapBlockMatch?.[0] ?? "";
    expect(singleWrapBlock).not.toMatch(/width:\s*["']100%["']/);
  });
});
