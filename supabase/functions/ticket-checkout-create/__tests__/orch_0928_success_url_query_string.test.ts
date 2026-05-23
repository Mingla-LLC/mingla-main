// ORCH-0928 v2 [Buyer-web confirm page stuck on loading hero —
// sessionStorage payload missing on Safari cross-origin redirect]
// edge-fn regression test for the success_url shape.
//
// Bug: v1 success_url used URL fragment `#csi=<id>&bst=<token>` for
// confirm-page recovery params. Live-fire Playwright forensics
// 2026-05-23 PROVED Expo Router web hydration reformats fragment URLs
// such that the entire `?cs=…` portion ends up INSIDE the fragment,
// leaving `window.location.search` empty + breaking the `?cs=` regex
// guard at confirm.tsx line ~158 → recovery never fires → buyer sits
// on loading hero forever.
//
// Fix: query-string-only success_url (`?cs=…&csi=…&bst=…` — no
// fragment). Query string survives Expo Router hydration intact.
//
// This test locks the success_url shape so a future regression
// (someone re-introducing the fragment) is caught at CI time.
//
// Pattern: source-string assertion (matches orch-0843 +
// orch_0911_success_url_branching test style).

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const indexSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(indexSource);

Deno.test(
  "ORCH-0928 v2 HP-1 — successUrl appends &csi=<id>&bst=<token> as QUERY-STRING params (not URL fragment)",
  () => {
    // The fixed template literal must include the query-string params.
    // Match: `confirm?cs={CHECKOUT_SESSION_ID}&csi=${checkoutSessionId}&bst=${buyerStatusToken}`
    const successUrlRe =
      /confirm\?cs=\{CHECKOUT_SESSION_ID\}&csi=\$\{checkoutSessionId\}&bst=\$\{buyerStatusToken\}/;
    assert(
      successUrlRe.test(activeSource),
      "Expected successUrl template to include `?cs={CHECKOUT_SESSION_ID}&csi=${checkoutSessionId}&bst=${buyerStatusToken}` query-string shape.",
    );
  },
);

Deno.test(
  "ORCH-0928 v2 HP-2 — successUrl does NOT contain `#csi=` URL fragment (v1-broken shape forbidden)",
  () => {
    // The fragment form (v1 / v3) is forbidden — it triggers Expo Router
    // URL mangling that defeats recovery. Test for ANY occurrence of
    // `#csi=` in source (active code only, comments stripped).
    assert(
      !/#csi=/.test(activeSource),
      "Forbidden: successUrl must NOT contain `#csi=` URL fragment (Expo Router web hydration reformats fragments — see ORCH-0928 v2 Playwright forensic report 2026-05-23).",
    );
  },
);

Deno.test(
  "ORCH-0928 v2 HP-3 — exactly one successUrl assignment in the web/mobile-web branch",
  () => {
    // Defensive guard against drift where someone introduces a second
    // successUrl assignment with a different shape. The
    // checkout-trip + checkout (single-event) branches share the same
    // `successUrl` variable — the variable is assigned once in the
    // `if (surface === "web")` branch and once in the `else` branch
    // (mobile-web custom-scheme deep link).
    const assignments = activeSource.match(/^\s*successUrl\s*=/gm);
    assert(assignments !== null, "Expected successUrl assignment(s) in source.");
    // 2 expected: web (line ~433) + mobile-web (line ~448 mingla-business://).
    // Mobile-web's deep link shape is different (custom scheme); not
    // affected by ORCH-0928.
    assertEquals(
      assignments?.length,
      2,
      `Expected exactly 2 successUrl assignments (web + mobile-web), got ${assignments?.length}. If you've added a new surface, ensure it follows the query-string contract.`,
    );
  },
);
