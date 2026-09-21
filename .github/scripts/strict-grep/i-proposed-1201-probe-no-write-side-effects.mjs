#!/usr/bin/env node
/**
 * I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS (DRAFT) — ORCH-1201.
 *
 * Synthetic probes are read-only against vendors. The ONLY non-GET vendor HTTP
 * calls allowed in api-health-probe are:
 *   - the Serper liveness search (POST google.serper.dev/search — read-only),
 *   - the Gemini liveness generation (POST …:generateContent — issue #3526), and
 *   - the Stripe/Paystack SDK reads (createStripeClientForRole / resolvePaystackSecretKey).
 *
 * issue #3526 — WHY :generateContent joins the allowlist. The invariant means
 * "creates no vendor-side STATE", which is why the Serper search — also a POST,
 * also metered — has always been allowed. A Gemini inference call is the same
 * shape: it writes nothing at the vendor and can be repeated without effect.
 * It had to become a POST because the old GET ListModels probe was
 * STRUCTURALLY BLIND to the failure it existed to catch: it reported
 * healthy/200 at 16:00:10Z on 2026-09-21, twenty minutes before a real
 * generation call returned 404 "this model is no longer available to new
 * users", and four days of outage looked green. The allowance is narrow — the
 * URL must end in `:generateContent`; any other POST to any other Gemini path
 * still fails.
 *
 * Gate: any `fetch(... { method: "POST" ...})` to a non-serper vendor host in
 * api-health-probe/index.ts fails. (Supabase service-client writes are NOT
 * fetch() and are exempt.) Also asserts recordApiCall is wired into _shared
 * fire-and-forget (`void recordApiCall`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const failures = [];

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const indexPath = join(root, "supabase/functions/api-health-probe/index.ts");
if (!existsSync(indexPath)) {
  console.error("I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS: index.ts missing");
  process.exit(1);
}
const code = stripComments(readFileSync(indexPath, "utf8"));

// Find fetch(...) call args that include method: "POST" and a vendor URL that
// is NOT google.serper.dev. We scan each `timedFetch(` / `fetch(` invocation.
const callRe = /\b(?:timedFetch|fetch)\s*\(\s*([^,]+),([\s\S]*?)\)\s*;/g;
let m;
while ((m = callRe.exec(code)) !== null) {
  const urlArg = m[1];
  const optsArg = m[2] || "";
  const isPost = /method\s*:\s*["']POST["']/.test(optsArg);
  if (!isPost) continue;
  // allowed: serper search
  if (/serper\.dev/.test(urlArg)) continue;
  // allowed (issue #3526): the Gemini liveness generation. NARROW — the URL
  // must name :generateContent. Any other Gemini POST still fails.
  if (/:generateContent/.test(urlArg)) continue;
  // allowed: cloudinary destroy lives in _shared, not here; supabase writes are not fetch.
  failures.push(
    `api-health-probe/index.ts: POST vendor fetch to ${urlArg.trim()} — synthetic probes must be read-only (only Serper search + Stripe/Paystack SDK reads allowed).`,
  );
}

// recordApiCall must be fire-and-forget everywhere it is wired.
const wrapFiles = [
  "supabase/functions/_shared/paystack.ts",
  "supabase/functions/_shared/mapboxGeocode.ts",
  // #966 (SPEC AMENDMENT 1): the cover-video vendor call moved from
  // eventCoverVideo.ts (Cloudinary destroy fetch, removed) to bunnyStream.ts, which
  // now owns `void recordApiCall("bunny", …)` at 3 sites; eventCoverVideo.ts no
  // longer makes any vendor fetch. Coverage-preserving swap — the fire-and-forget
  // wrap stays under gate protection on the file that now makes the vendor call.
  "supabase/functions/_shared/bunnyStream.ts",
  "supabase/functions/_shared/agentGemini.ts",
  "supabase/functions/_shared/geminiMenuParser.ts",
  // issue #3526 M-4: this Ari path made a vendor fetch and recorded NOTHING, so
  // a provider refusal on it never reached the health tables. Now under the
  // same fire-and-forget wrap discipline as its two siblings.
  "supabase/functions/_shared/geminiActivitiesParser.ts",
  "supabase/functions/_shared/appsFlyerS2S.ts",
];
for (const rel of wrapFiles) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    failures.push(`${rel}: expected Layer-C wrap file missing.`);
    continue;
  }
  const src = stripComments(readFileSync(p, "utf8"));
  if (!/recordApiCall\(/.test(src)) {
    failures.push(`${rel}: must call recordApiCall (Layer-C passive wrap).`);
    continue;
  }
  // Every recordApiCall call must be fire-and-forget (`void recordApiCall(` or `await`-free).
  // We forbid `await recordApiCall(` (blocking the host path).
  if (/await\s+recordApiCall\(/.test(src)) {
    failures.push(`${rel}: recordApiCall must be fire-and-forget (void ...), not awaited on the host path.`);
  }
  if (!/void\s+recordApiCall\(/.test(src)) {
    failures.push(`${rel}: recordApiCall must be invoked as \`void recordApiCall(...)\`.`);
  }
}

if (failures.length > 0) {
  console.error("I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS gate failed:");
  for (const f of failures) console.error(`- ${f}`);
  process.exit(1);
}
console.log("I-PROPOSED-1201-PROBE-NO-WRITE-SIDE-EFFECTS gate passed.");
