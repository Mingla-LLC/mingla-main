# QA RETEST 1 — ISSUE-864 WP4 [Campaign Builder UI] — mingla-tester

**Previous verdict:** FAIL (QA_ISSUE-864_WP4.md — 1×P1, 1×P2) at `2ee6404f7`, QA commit `9db040324`
**Rework under retest:** `12418a2a3` (P1-1) + `c885b36ce` (P2-1) + `779f6b367` (tests + note), per `Mingla_Artifacts/implementation/WP4-864-REWORK-NOTE.md`
**Suite integrity:** `issue864_campaign_builder_tester_adversarial.test.js` **byte-untouched since `9db040324`** (git-diff-verified across the rework range) — the P1 pin went green via CODE change only.

---

## 1. Verdict

## **PASS — 0 × P0 · 0 × P1 · 0 × P2 · 0 × P3 (new) · 2 × P4**

Both findings are fixed and independently re-proven at runtime and by revert-derivation. No regression anywhere in the battery (103/103 combined, admin suites, build, all six strict-grep gates). No new issues found in the rework diff (pure-append tests — 0 deleted lines; no product caller passes the test-injection param; the sweep test structurally bans future divergent host literals).

Routing: **PASS → CLOSE (orchestrator)** — carry the standing CLOSE-sequencing items (D-1: prod bucket migration + per-platform connect; D-3: A4.0(3) spec erratum, now also documented in the implementation report §14).

---

## 2. Per-leg evidence

### Leg 1 — P1-1 runtime (local stack + real meta/google credentials, real 2FA login, CDP drive)
Full wizard re-driven to Review (meta amber / google green live preflight; NO create performed — retest scope):
- **Surface 1 — destination step:** displayed URL = `https://business.usemingla.com/e/smokerhythm/fifa-grill-night` (shot `r1-destination-selected.png`).
- **Surface 2 — launch summary:** `Destination — FIFA Grill Night — https://business.usemingla.com/e/smokerhythm/fifa-grill-night` (shot `r2-review-summary.png`).
- **Surface 3 — preview rail:** host chip renders `BUSINESS.USEMINGLA.COM`; the fallback host now derives from `PUBLIC_WEB_ORIGIN` (`new URL(...).hostname`), so no divergent literal can resurface there.
- **Live check:** the displayed URL returns **HTTP 200**; the old host still 404s (regression reference).
- **fails-on-revert independently re-derived:** flipped `PUBLIC_WEB_ORIGIN` back to `https://usemingla.com` in the working tree → **my pin RED** (46/47) **AND the implementor's new guard describe RED** (54/56); restored → **103/103**. Two independent suites now pin the host.

### Leg 2 — P2-1 (module, direct re-derivation beyond the implementor's tests)
- `MARKET_GAPS.reddit = { unavailable: ["NG"], reason: "Reddit can't bill in naira (its funding-currency enum has no NGN) — Nigeria campaigns don't route to Reddit." }`
- **NG plan × injected create-wired Reddit → excluded** with exactly that reason (`Not available: …no NGN…`); **US plan × wired Reddit → eligible** (the gate is the market, nothing else); **default precedence unchanged** — today Reddit is still excluded by the endpoint gap first; GB/TikTok gate intact; `CREATE_WIRED` still `["meta","google"]`; a Lagos-only plan with all three wired routes **meta+google only**.
- Reason RENDERING: exclusion reasons render verbatim from `excludedReason` in the budget-split panel and §1.8 summary — runtime-proven generically in the original QA (shots 14/29); the NG reason flows through the same single path.
- `createWired` injection param: defaults to `CREATE_WIRED`, **no product caller passes it** (grep-verified — StepPreflight's local `createWired` const is a read of the same constant, not the param), zero behavior change.
- **fails-on-revert:** deleted the `reddit: { unavailable: ["NG"] … }` line → happy suite **54/56** (the P2-1 describe fails); restored → **56/56**.

### Leg 3 — full battery at `779f6b367`
| Check | Result |
|---|---|
| Happy suite (49 + 7 appended — pure append, 0 deletions) | **56/56** |
| Tester adversarial (byte-untouched) | **47/47 — the P1 pin is GREEN** |
| Combined | **103/103** |
| `npm --prefix mingla-admin test` | 19/19 |
| 1271/1277 gated admin suites | 168/168 |
| `npm run build` (Vite) | green (3.48s) |
| Strict-grep gates (862-token / 866-creative / 862-reddit-status / admin-single-gate / gate-first-statement / 1272-identity) | 6/6 PASS |

### P4 notes
- **P4-a (praise):** the rework hardened beyond the findings — the "no divergent public-host literal survives anywhere in the wizard trees" sweep test structurally prevents the P1-1 class from recurring, and the AdPreview fallback derives from the constant rather than duplicating it.
- **P4-b (note):** the `createWired` injection param is cleanly scoped (JSDoc'd TEST-INJECTION ONLY, default preserves production behavior) — the market gate is now provable instead of dead code.

## 3. Hygiene
Local stack re-built for the drive and fully torn down (`supabase stop --no-backup`; duplicate-prefix temp renames restored byte-identical — git clean); credentials re-extracted from master keys and shredded at session end; `.env` removed; **no prod writes, no deploys, nothing pushed from this session; no platform objects created in this retest** (drive stopped at Review).

---

**Routing:** PASS → **CLOSE (orchestrator)**. Standing CLOSE items: apply `20270101000864` to prod + run `admin-ad-connect` per platform (D-1); A4.0(3) host erratum → forensics amendment (D-3); NG/Reddit AC folded into the Reddit-create-branch follow-up (now pre-satisfied by `MARKET_GAPS.reddit`).
**Working tree:** `~/Desktop/mingla-orchs/issue-864-campaign-builder-ui` on branch `issue-864-campaign-builder-ui`.
