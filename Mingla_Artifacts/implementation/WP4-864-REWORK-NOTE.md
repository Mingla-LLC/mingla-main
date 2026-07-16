# WP4 — ISSUE-864 Campaign Builder UI — REWORK Note

**Trigger:** `Mingla_Artifacts/reports/QA_ISSUE-864_WP4.md` (FAIL — 1×P1 · 1×P2 · 1×P3 · 3×P4) at `9db040324`.
**Scope discipline:** ONLY the QA findings were touched — no scope expansion.
**Worktree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui` on branch `issue-864-campaign-builder-ui`.

## Per-finding status

### P1-1 — builder-displayed destination URLs 404 (host diverges from the server of record) — FIXED
- `adDestinationsService.js`: `PUBLIC_WEB_ORIGIN` → `"https://business.usemingla.com"` — a literal
  mirror of `PRODUCTION_BUSINESS_WEB_ORIGIN` (`supabase/functions/_shared/businessWebOrigin.ts`),
  which is what the deployed create fn builds `dest_url`/`finalUrls` from. The false
  "matches the server" comment is replaced with the real contract: the value MUST stay a
  literal equal to the server constant because BOTH parity guards (the tester's pin + the
  new happy-suite guard) regex the two source literals and fail on drift. A literal (not an
  import) is required: the Deno-side module can't enter the Vite/node-test import graph,
  and the tester's pin explicitly matches `PUBLIC_WEB_ORIGIN = "<literal>"`.
- Blast radius covered: destination step, launch summary, and preview rail all derive from
  this one constant (`eventUrl`/`brandUrl` → `destination.dest_url`); `AdPreview`'s
  placeholder host now DERIVES from `PUBLIC_WEB_ORIGIN` (old hardcoded `"USEMINGLA.COM"`
  fallback deleted); a new suite check scans every wizard/service/lib file and fails on
  any non-business `usemingla.com` literal (erratum-citing comments excepted).
- **Tester's red pin now GREEN** — their suite `issue864_campaign_builder_tester_adversarial.test.js`
  runs **47/47** (was 46 + 1 intentionally-RED). Their test was NOT modified — the code fix
  alone flipped it (append-only honored; their CI job `issue-864-campaign-builder-tester-adversarial`
  turns green with it).

### P2-1 — NG/Reddit market exclusion not encoded — FIXED (encoded now, live the day Reddit's create branch lands)
- `channelPlan.js`: `MARKET_GAPS.reddit = { unavailable: ["NG"], reason: "Reddit can't bill in
  naira (its funding-currency enum has no NGN) — Nigeria campaigns don't route to Reddit." }`
  (blueprint §1.3 "Don't route the Nigeria lane to Reddit").
- To keep the rule provable rather than dead code behind `CREATE_WIRED`, `planChannels`
  gained a TEST-INJECTION-ONLY `createWired` parameter (defaults to `CREATE_WIRED`; no
  behavior change). Unit tests prove: NG-plan × wired-Reddit → excluded with the no-NGN
  reason; US-plan × wired-Reddit → eligible; default precedence unchanged (endpoint gap
  still excludes Reddit first today).

### Spec erratum (dispatch item 3) — FILED, spec not edited
- Appended §14 to `WP4-864-IMPLEMENTATION-REPORT.md`: A4.0(3)/blueprint §1.2's
  `https://usemingla.com/e/…` literal carries the wrong host (live 404); production
  reality is `business.usemingla.com`. Correction rides the next amendment.

### P3-1 — shared `Input` label association — NOT FIXED HERE (per dispatch)
- Pre-existing admin-wide primitive pattern, outside the WP4 allowlist; stays registered
  for the hygiene ORCH (QA D-5).

### P4-a/b/c — praise/notes, no action.

## Verification (real output)

- Happy suite (grown by 7 appended rework tests, zero existing tests modified):
  `# tests 56 / # pass 56 / # fail 0`.
- Tester adversarial suite (untouched): `# tests 47 / # pass 47 / # fail 0` — **the P1 pin is green**.
- **fails-on-revert (host fix):** reverting the constant to `"https://usemingla.com"` →
  happy `54 pass / 2 fail` (parity guard + literal scan) AND tester `46 pass / 1 fail`
  (their pin) — the regression is caught from two independent suites; restored → 56/56 + 47/47.
- Vite build: green (`✓ built in 3.50s`).
- Gates: `issue-862-ad-token-env-server-only` PASS · `issue-866-creative-guards` PASS ·
  `npm --prefix mingla-admin test` 19/19.
- Hard guards: no deploys, no prod writes, no pushes, tester's test file untouched,
  no `[deploy]` tag.

## Files changed in the rework

- `mingla-admin/src/services/adDestinationsService.js` (+25/−10: constant + honest comments)
- `mingla-admin/src/components/campaign-builder/AdPreview.jsx` (+9/−2: derived fallback host)
- `mingla-admin/src/components/campaign-builder/StepDestination.jsx` (comment host fixed)
- `mingla-admin/src/lib/adBuilder/reviewDetailMap.js` (user-facing copy host-neutral)
- `mingla-admin/src/lib/adBuilder/channelPlan.js` (+16/−3: NG/Reddit gap + injectable createWired)
- `mingla-admin/src/__tests__/issue864_campaign_builder_happy.test.js` (+93 appended: P1-1 parity guard ×3 + P2-1 ×4)
- `Mingla_Artifacts/implementation/WP4-864-IMPLEMENTATION-REPORT.md` (§14 erratum appended)

## Route back

→ orchestrator for REVIEW → mingla-tester RETEST (their pin is the retest contract:
re-drive the destination step and confirm the displayed URL 200s; NG×wired-Reddit unit
angle now covered).
