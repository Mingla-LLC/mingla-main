// ORCH-1205 [edge-function CORS missing x-client-info → team/scanner invites
// broken on web] — regression test.
//
// ROOT CAUSE: supabase-js attaches an `x-client-info` request header on EVERY
// call. Eight edge functions hardcoded an incomplete allow-list
// ("authorization, apikey, content-type") that omitted `x-client-info`, so the
// browser CORS preflight (OPTIONS) was rejected and every fetch from
// business.usemingla.com to those functions failed with net::ERR_FAILED.
//
// FIX: each function now serves the shared `_shared/cors.ts` allow-list, which
// includes `x-client-info` (and `accept-language`).
//
// This test proves, for each of the 8 fixed functions, that the CORS allow-list
// it actually serves on preflight includes `x-client-info`. It is fails-on-
// revert: delete the shared-cors import (or otherwise drop `x-client-info`) from
// any one function and the corresponding assertion turns RED.

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// (1) Direct guard on the single source of truth: the shared allow-list MUST
//     carry x-client-info + accept-language. If someone narrows _shared/cors.ts
//     the whole invite/scanner surface regresses, so pin it here.
import { corsHeaders } from "../cors.ts";

Deno.test("ORCH-1205 — shared corsHeaders allow-list includes x-client-info", () => {
  const allow = corsHeaders["Access-Control-Allow-Headers"] ?? "";
  assertStringIncludes(
    allow.toLowerCase(),
    "x-client-info",
    "shared _shared/cors.ts must allow x-client-info (supabase-js sends it on every request)",
  );
  assertStringIncludes(
    allow.toLowerCase(),
    "accept-language",
    "shared _shared/cors.ts must allow accept-language",
  );
});

// (2) Per-function guard: each fixed function's source MUST serve an
//     Access-Control-Allow-Headers value that includes x-client-info. A function
//     satisfies this either by importing the shared cors.ts (preferred) or by
//     hardcoding an inline allow-headers string that itself contains
//     x-client-info. We do NOT accept a hardcoded inline allow-list that omits
//     it — that is exactly the bug we are fencing against.

// THE bug — browser-called invite/scanner/lead endpoints (must allow x-client-info).
const BROWSER_CALLED = [
  "list-my-pending-invites",
  "invite-brand-member",
  "invite-scanner",
  "accept-brand-invitation",
  "decline-brand-invitation",
  "accept-scanner-invitation",
  "beta-access-lead-submit",
];

// Cron-only — aligned for consistency.
const CRON_ALIGNED = ["process-booking-deadlines"];

const ALL_FIXED = [...BROWSER_CALLED, ...CRON_ALIGNED];

// __tests__/ lives at supabase/functions/_shared/__tests__/, so the functions
// directory is two levels up.
const FUNCTIONS_DIR = new URL("../../", import.meta.url);

function importsSharedCors(src: string): boolean {
  // Matches:  import { corsHeaders } from "../_shared/cors.ts";
  return /import\s*\{[^}]*\bcorsHeaders\b[^}]*\}\s*from\s*["'][^"']*_shared\/cors\.ts["']/
    .test(src);
}

function inlineAllowHeadersHasXClientInfo(src: string): boolean {
  // Find every Access-Control-Allow-Headers string literal and require that, if
  // present, it includes x-client-info. (If the function imports shared cors,
  // there may be no inline literal at all — that case is handled separately.)
  const re = /["']Access-Control-Allow-Headers["']\s*:\s*([\s\S]*?)(?:,|\n|\})/gi;
  let m: RegExpExecArray | null;
  let sawAny = false;
  while ((m = re.exec(src)) !== null) {
    sawAny = true;
    if (!/x-client-info/i.test(m[1])) return false;
  }
  // No inline literal at all → relies on shared import; not a failure here.
  return sawAny ? true : true;
}

for (const fn of ALL_FIXED) {
  Deno.test(`ORCH-1205 — ${fn} serves x-client-info in its CORS allow-list`, () => {
    const path = new URL(`${fn}/index.ts`, FUNCTIONS_DIR);
    const src = Deno.readTextFileSync(path);

    const viaShared = importsSharedCors(src);
    const inlineOk = inlineAllowHeadersHasXClientInfo(src);

    // It is allowed iff it imports the shared (correct) cors OR every inline
    // Access-Control-Allow-Headers literal already includes x-client-info.
    assert(
      viaShared || inlineOk,
      `${fn} must allow x-client-info — either import _shared/cors.ts or include ` +
        `"x-client-info" in its inline Access-Control-Allow-Headers. ` +
        `Found via-shared=${viaShared}, inline-ok=${inlineOk}.`,
    );

    // Hard fails-on-revert anchor: if the function neither imports shared cors
    // NOR mentions x-client-info anywhere, it is the original bug → RED.
    assert(
      viaShared || /x-client-info/i.test(src),
      `${fn} does not reference x-client-info at all — CORS preflight will reject ` +
        `supabase-js browser calls (ORCH-1205 regression).`,
    );
  });
}
