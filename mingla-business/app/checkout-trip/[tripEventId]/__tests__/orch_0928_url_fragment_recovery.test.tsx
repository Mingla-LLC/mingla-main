/**
 * ORCH-0928 [Buyer-web confirm page stuck on ORCH-0911 loading hero forever]
 * — trip confirm URL-fragment recovery happy-path regression test.
 *
 * Bug: when sessionStorage payload is missing (Safari cross-origin redirect
 * drops it, buyer opens URL in different tab, etc.), confirm.tsx silently
 * returns at `if (payload === null) return;` and never fires
 * confirmTicketCheckout — buyer stays on the loading hero forever even
 * though payment + tickets succeeded.
 *
 * Fix: ticket-checkout-create's success_url now includes a
 * `#csi=<internalSessionId>&bst=<buyerStatusToken>` fragment; confirm.tsx
 * parses the fragment when sessionStorage payload is null and synthesizes
 * a minimal payload so confirmTicketCheckout fires.
 *
 * Pattern: source-string assertion (matches orch_0911 sibling tests). The
 * repo does not install @testing-library/react-native so we pin the
 * recovery-path contract at source level.
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

describe("ORCH-0928 — trip confirm URL fragment recovery (happy path)", () => {
  it("HP-1: payload is `let`, not `const`, so the fragment-recovery branch can reassign it", () => {
    expect(activeSource).toMatch(
      /let\s+payload\s*=\s*readCheckoutResumePayload\(/,
    );
    // Negative: the pre-fix `const payload = readCheckoutResumePayload` shape
    // would prevent the fragment-recovery branch from reassigning. Assert the
    // OLD shape does not appear.
    expect(activeSource).not.toMatch(
      /const\s+payload\s*=\s*readCheckoutResumePayload\(/,
    );
  });

  it("HP-2: when payload is null, code reads `window.location.hash` and parses with URLSearchParams", () => {
    const recoveryWindow = activeSource.slice(
      activeSource.indexOf("let payload = readCheckoutResumePayload"),
      activeSource.indexOf("if (payload === null) return;"),
    );
    expect(recoveryWindow).toContain("if (payload === null)");
    expect(recoveryWindow).toContain("win.location?.hash");
    expect(recoveryWindow).toContain("new URLSearchParams(hash)");
    expect(recoveryWindow).toMatch(/params\.get\(["']csi["']\)/);
    expect(recoveryWindow).toMatch(/params\.get\(["']bst["']\)/);
  });

  it("HP-3: recovery synthesizes a minimal payload with empty lines + buyer when csi+bst are present", () => {
    const recoveryWindow = activeSource.slice(
      activeSource.indexOf("let payload = readCheckoutResumePayload"),
      activeSource.indexOf("if (payload === null) return;"),
    );
    // The minimal payload must include checkoutSessionId + buyerStatusToken
    // (both load-bearing for confirmTicketCheckout auth) and empty lines +
    // buyer (cart context not recoverable from URL fragment but not needed
    // for QR render — server returns order rows).
    expect(recoveryWindow).toMatch(/checkoutSessionId:\s*csi/);
    expect(recoveryWindow).toMatch(/buyerStatusToken:\s*bst/);
    expect(recoveryWindow).toMatch(/lines:\s*\[\]/);
    expect(recoveryWindow).toMatch(/marketingOptIn:\s*false/);
  });

  it("HP-4: both csi and bst must be non-empty strings to trigger recovery (defensive guard)", () => {
    const recoveryWindow = activeSource.slice(
      activeSource.indexOf("let payload = readCheckoutResumePayload"),
      activeSource.indexOf("if (payload === null) return;"),
    );
    expect(recoveryWindow).toMatch(
      /csi\s*!==\s*null\s*&&\s*csi\.length\s*>\s*0\s*&&\s*bst\s*!==\s*null\s*&&\s*bst\.length\s*>\s*0/,
    );
  });

  it("HP-5: the second `if (payload === null) return;` guard still exists after recovery (handles both-null case)", () => {
    // Both pre-recovery `if (payload === null)` (the recovery entry guard)
    // AND the post-recovery `if (payload === null) return;` (final bail-out
    // when neither sessionStorage NOR fragment yielded a payload) must be
    // present so the flow correctly short-circuits when there's nothing to
    // work with.
    const guardMatches = activeSource.match(/if\s*\(\s*payload\s*===\s*null\s*\)/g);
    expect(guardMatches).not.toBeNull();
    // 2+ occurrences expected: entry-into-recovery guard + final-bailout
    // guard. (Defensive lower bound — implementation may add more checks.)
    expect((guardMatches ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("HP-6: Defensive bounce useEffect ALSO recognises URL-fragment recovery (so it doesn't race-bounce before async confirmTicketCheckout resolves)", () => {
    // ORCH-0928 follow-up: the sync-confirm useEffect can recover from
    // missing sessionStorage via #csi=&bst= fragment, but the Defensive
    // Bounce useEffect at the bottom of the file fires synchronously on
    // the same render cycle. If the bounce checks ONLY sessionStorage
    // payload presence, it navigates away before recovery resolves —
    // producing a "blank dark screen" on the cart route. Live-fire
    // confirmed 2026-05-23 ~07:33 UTC on Costain test order. Bounce must
    // suppress navigation when fragment recovery is possible.
    // Use raw source (with comments) so the "Defensive bounce" landmark
    // survives — stripComments removes the section comments.
    const bounceWindow = source.slice(
      source.indexOf("Defensive bounce"),
      source.indexOf("Handlers", source.indexOf("Defensive bounce")),
    );
    expect(bounceWindow.length).toBeGreaterThan(0);
    // Bounce should now check for the hash + csi/bst regex literals before
    // firing router.replace.
    expect(bounceWindow).toMatch(/win\.location\?\.hash/);
    expect(bounceWindow).toMatch(/hasFragmentRecovery/);
    expect(bounceWindow).toMatch(/csi=\[\^&\]\+/);
    expect(bounceWindow).toMatch(/bst=\[\^&\]\+/);
    // The bounce-suppression conditional must be an OR between
    // readCheckoutResumePayload(...) !== null AND hasFragmentRecovery —
    // either one keeps us on /confirm.
    expect(bounceWindow).toMatch(
      /readCheckoutResumePayload\([^)]+\)\s*!==\s*null\s*\|\|[\s\S]{0,80}hasFragmentRecovery/,
    );
  });
});
