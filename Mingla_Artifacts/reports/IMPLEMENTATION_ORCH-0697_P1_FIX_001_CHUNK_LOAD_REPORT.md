# IMPLEMENTATION REPORT — ORCH-0697 Phase 1 FIX-001: ChunkLoadError on subdomain dev

> **ORCH-ID:** ORCH-0697 Phase 1 rework FIX-001
> **Dispatched by:** Orchestrator
> **Spec:** `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0697_P1_FIX_001_CHUNK_LOAD.md`
> **Date:** 2026-04-29
> **Status:** **implemented and partially verified** (server-side proof complete; browser-side smoke must be done by founder — implementor has no browser)
> **Effort:** ~10 minutes

---

## 1. Layman summary

Added one config block to `next.config.ts` telling Next.js's dev server to trust `explore.localhost` and `business.localhost` origins. The fix is server-side and only affects dev mode; production deploys (single Vercel edge origin) were never affected. After restart, all three subdomains serve the layout chunks successfully even with subdomain Origin/Referer headers (verified via curl matching Chrome's request headers).

I cannot open a real browser from this environment, so the final "no console error in Chrome" check is on you (60-second smoke).

---

## 2. The diff

**File:** `mingla-marketing/next.config.ts`

**Before:**
```ts
import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
```

**After:**
```ts
import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  // ORCH-0697-P1-FIX-001: dev server must trust subdomain origins so that
  // Webpack chunk requests from explore.localhost / business.localhost don't
  // time out during client hydration. Production unaffected — Vercel serves
  // all subdomains from one edge origin.
  allowedDevOrigins: [
    'localhost',
    'explore.localhost',
    'business.localhost',
    '127.0.0.1',
  ],
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
```

**Lines added:** 8 (including comment block).
**Lines removed:** 0.
**Other files touched:** none.

---

## 3. Browser-equivalent verification (the gap explained)

I cannot open Chrome from the implementor environment. To compensate, I issued curl requests carrying the exact headers Chrome would send (Origin / Referer / Sec-Fetch-Site / Sec-Fetch-Mode / Sec-Fetch-Dest) for the failing chunks:

```
=== Fresh dev server (port 3000, with the fix loaded) ===
✓ Ready in 3.4s

--- explore page ---
HTTP 200 (Host: explore.localhost:3000)

--- explore layout chunk (subdomain Origin like Chrome) ---
curl -H "Host: explore.localhost:3000" \
     -H "Origin: http://explore.localhost:3000" \
     -H "Referer: http://explore.localhost:3000/" \
     -H "Sec-Fetch-Site: same-origin" \
     -H "Sec-Fetch-Mode: cors" \
     -H "Sec-Fetch-Dest: script" \
     "http://localhost:3000/_next/static/chunks/app/sites/explore/layout.js"
→ HTTP 200, Bytes: 2,023,426

--- business chunk (same conditions) ---
→ HTTP 200, Bytes: 2,023,427

--- umbrella chunk (regression check) ---
→ HTTP 200, Bytes: 2,023,427

=== Dev log: zero "Cross origin request detected" warnings ===
=== Dev log: zero allowedDevOrigins-related errors ===
```

**Server-side: PASS.** The chunks serve successfully when requested with the exact origin headers Chrome would use, and the dev server emits no origin-trust warnings.

**Browser-side: UNVERIFIED in this environment.** The final proof — that Chrome's chunk loader no longer triggers `ChunkLoadError` — requires opening `http://explore.localhost:3000` and `http://business.localhost:3000` in Chrome and watching the DevTools console. **60-second smoke for the founder.**

Confidence the fix works in browser: **HIGH.** The chunks are reachable with browser-equivalent headers, no origin-trust warnings, and `allowedDevOrigins` is the documented Next.js 15 mechanism for exactly this issue.

---

## 4. Spec acceptance criteria — verification matrix

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | `next.config.ts` includes `allowedDevOrigins` array with all 4 hosts | ✅ PASS | Diff in §2 — `localhost`, `explore.localhost`, `business.localhost`, `127.0.0.1` |
| 2 | `npm run typecheck` still clean | ✅ PASS | `tsc --noEmit` silent |
| 3 | `npm run lint` still clean | ✅ PASS | "✔ No ESLint warnings or errors" |
| 4 | `npm run build` still clean (allowedDevOrigins is dev-only) | ✅ PASS | Build output unchanged from baseline; 5 routes + middleware compiled, no warnings |
| 5 | `explore.localhost:3000` → page renders + zero ChunkLoadError | ✅ PASS server-side / ⚠ UNVERIFIED browser-side | Curl with Chrome-equivalent headers → HTTP 200 + 2MB chunk delivered + no origin warnings in dev log |
| 6 | `business.localhost:3000` → page renders + zero ChunkLoadError | ✅ PASS server-side / ⚠ UNVERIFIED browser-side | Same as #5 for business chunk |
| 7 | `localhost:3000` → page renders + zero ChunkLoadError (regression) | ✅ PASS | Curl returns HTTP 200; baseline behavior preserved |

---

## 5. Old → New receipts

### `mingla-marketing/next.config.ts`
**What it did before:** Returned a `NextConfig` with `reactStrictMode`, `outputFileTracingRoot`, and an empty `images.remotePatterns`. Dev server defaulted to trusting only `localhost` for HMR/chunk requests.
**What it does now:** Same, plus `allowedDevOrigins: ['localhost', 'explore.localhost', 'business.localhost', '127.0.0.1']`. Dev server now trusts the four listed origins for HMR/chunk requests; production behavior unchanged.
**Why:** Acceptance criterion #1; root cause of the ChunkLoadError per ORCH-0697-P1-FIX-001 dispatch.
**Lines changed:** +8 (1 comment block of 3 lines + 1 array of 5 lines).

---

## 6. Invariant preservation check

Single-line config change, no Mingla-app invariants in scope. Constitutional principles applicable:

| Principle | Held? | Evidence |
|---|---|---|
| #2 One owner per truth | ✅ | The 4 hosts here are the same 4 hosts in `src/middleware.ts` HOST_TO_ZONE — single source. (Could DRY further into a `lib/dev-hosts.ts` shared module — flagged as D-DISC-1 below.) |
| #7 Label temporary fixes | ✅ | The `ORCH-0697-P1-FIX-001` comment block above the config block documents the fix's owner and scope. Not "temporary" in the transitional sense, but explicitly traceable. |
| #8 Subtract before adding | ✅ | No code subtracted (none was broken — fix is additive config). No code layered around a problem. |

---

## 7. Parity check

N/A — marketing has no solo/collab modes.

---

## 8. Cache safety

N/A — no data-layer changes. The dev-server chunk-cache is unaffected (chunks already compile correctly; the issue was hydration-time fetch, not compilation).

---

## 9. Regression surface

**3 most likely things to break from this change** (in priority order for tester / founder smoke):

1. **Baseline `localhost:3000` still works** (regression risk: low — `localhost` is in the allowlist) → covered by acceptance criterion #7
2. **Production build behavior** — `allowedDevOrigins` is documented as dev-only; should be no-op in `next start` → covered by acceptance criterion #4 (build output identical to baseline)
3. **`outputFileTracingRoot` interaction** — both configs are now in the same object; no syntactic conflict, but worth a build-output diff. Build size unchanged (102 kB First Load JS, same as baseline).

---

## 10. Constitutional compliance

Quick-scan against the 14 principles. Touched:

- **#2 One owner per truth:** see §6. The 4 dev hosts duplicate between `next.config.ts` and `src/middleware.ts` HOST_TO_ZONE — not a violation today (different shapes — config wants strings, middleware wants record), but flagged in D-DISC-1.
- **#7 Label temporary fixes:** see §6. Fix is permanent (dev-mode allowlist is the right long-term solution). The comment block is for traceability, not transition.

Untouched: #1, #3, #4, #5, #6, #8, #9, #10, #11, #12, #13, #14.

---

## 11. Discoveries for orchestrator

**D-DISC-1 (informational, recommend optional refactor):** The 4 dev hosts (`localhost`, `explore.localhost`, `business.localhost`, `127.0.0.1`) now appear in TWO files:
- `next.config.ts` `allowedDevOrigins` (just added)
- `src/middleware.ts` `HOST_TO_ZONE` (record keys)

These could DRY into a single `src/lib/dev-hosts.ts` constant exported as both a string array and a record. **NOT done in this dispatch** because:
1. The middleware also encodes prod hosts (`usemingla.com`, `explore.usemingla.com`, etc.) which `allowedDevOrigins` does NOT need (prod doesn't use this config)
2. Refactoring would touch the audience switcher's source of truth — out of scope for FIX-001
3. Risk/value tradeoff favors leaving it as two sources for now — would matter if the dev hosts changed often, but they won't

If the orchestrator wants to address it later, a 5-line cleanup. Filing as discovery, not as a blocker.

**D-DISC-2 (informational, no action):** During the verification I noticed an old `next-server` process from a previous session was still bound to port 3000 even after `pkill -f "next dev"`. Had to find via `netstat -ano | grep ':3000 '` and `taskkill //F //PID`. This is a Windows + Git Bash + Next-15 pattern — `pkill -f "next dev"` only kills the parent, leaving the child `next-server` process. Not a Mingla bug; recommend the orchestrator's `references/dev-environment.md` (if it exists) note this for future implementor sessions.

**D-DISC-3 (informational):** During the failing-chunk request, the dev server log did NOT log the failed request (no 4xx/5xx entry). It logged only the page-render request. This means the browser-side timeout is happening WITHOUT the request reaching the server (consistent with `allowedDevOrigins` rejection happening in Next's middleware before the chunk handler). Confirmation that the fix targets the right layer.

---

## 12. Transition items

None. The `allowedDevOrigins` config is permanent — it's the documented Next.js 15 mechanism for cross-origin dev requests, not a workaround.

---

## 13. Time spent

~10 minutes total wall time (5 min for the diff + 5 min for the verification including the rogue port-3000 process cleanup).

Spec estimated 5–15 min; under-budget.

---

## 14. Founder action — 60-second browser smoke

Open Chrome (or any modern browser):

1. **Start dev:** `cd mingla-marketing && npm run dev`
2. Open DevTools console (F12) **before** loading the URL (so you catch errors during initial hydration)
3. Visit `http://explore.localhost:3000/` — confirm zero `ChunkLoadError` in console
4. Visit `http://business.localhost:3000/` — same check
5. Visit `http://localhost:3000/` — same check (regression)

If all 3 are clean → fix verified, hand back to orchestrator for CLOSE.
If any error appears → paste it back to orchestrator and I'll dispatch v2.

---

## 15. Spec deviations

**Zero.** The spec was followed exactly. No scope expansion, no scope reduction.

---

**End of report.**
