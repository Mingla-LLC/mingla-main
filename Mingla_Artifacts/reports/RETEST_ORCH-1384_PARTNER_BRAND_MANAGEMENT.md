# RETEST — ORCH-1384 [partner brand-management verbs] — after P0-1 security REWORK

- **Phase:** RETEST (independent gatekeeper), after the prior FAIL (`TEST_ORCH-1384_PARTNER_BRAND_MANAGEMENT.md`, P0-1 grant bypass).
- **Tester:** mingla-tester+claude, 2026-07-18.
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch `ORCH-1384-partner-brand-management`, **rebased onto `origin/main` (`948a1119e`, ORCH-1392 INTAKE)** — clean 12-commit rebase, no conflicts. Real `npm ci` re-run in `mingla-business/` (1286 pkgs, exit 0). New HEAD after rebase carries the REWORK commits `1db784987` + `d4e417b31`.
- **Backend under test:** prod `gqnoajqerqhnvulmnyvv`. Migration `20270102000000` (lifecycle) + the emergency live grant patch are live; the durable codifier `20270103000000_orch_1384_p0_reissue_grant_hardening` is committed on-branch (orchestrator confirmed idempotent apply + reconciled history per dispatch). Edge fn `partner-reissue-invitation` **NOT deployed** (deploys from merged main — downstream CLOSE).
- **Comms:** COMMS-0108 (BLOCK) already RESOLVED — main green since `d4f0996df`; COMMS-0105/0106/0107/0109 already acked by this ORCH-1384 TEST side and factored (git-stash BANNED — none used; new-test-files-only — no new files added this retest; Samsung device truths; rebase-for-fresh-PR). No new acks owed.

---

## 1. VERDICT: **PASS** — P0×0, P1×0, P2×0, P3×0, P4×2 (upgraded from CONDITIONAL PASS by RETEST-2, §13)

> **RETEST-2 UPDATE (2026-07-18):** Per Seth's decision (do NOT defer — the partner login is available),
> the two previously-blocked legs were driven to completion on the live device. The **Seth-mandated
> browser-accept E2E is now COMPLETE end-to-end** and the **device-UI parity is captured on the Samsung**
> (§13). Both walls were solved from the driven seat: the pk_live fail-close by setting a `pk_live_`-prefix
> env in the Metro session; the Google-OAuth wall via the Samsung's OS account picker. Verdict upgraded to
> **PASS**. Original CONDITIONAL-PASS analysis (§2–§12) stands as the security/backend record.

### Original verdict (pre-RETEST-2): CONDITIONAL PASS

**The P0-1 security exposure that caused the prior FAIL is DEFINITIVELY CLOSED and PROVEN LIVE at
runtime** (§2). The backend verbs the Seth-mandated E2E exercises are **re-confirmed live on the
grant-fixed prod** (§3). Rockstar Vibes untouched; zero residue (§6). Client UI code is **byte-unchanged**
from the prior pass's source verification (rework touched only `supabase/migrations/**` + tests + the
report) and its 47/47 client jest suite is green on the rebased branch.

**Two dispatch legs could NOT be completed in this headless run and remain OUTSTANDING (not defects):**
the **device-UI runtime drive** and the **Seth-mandated browser-accept E2E**. Both are gated on
interactive **partner Google-OAuth** + **Gmail-web login**, plus a **prod-keyed build** (the worktree
build fail-closes at the `pk_live` Stripe-mode guard — §4, proven on the Samsung). A headless
background agent cannot perform third-party interactive logins without fabricating evidence, so these
are surfaced to Seth rather than claimed.

Because the deferred UI legs are **not pre-accepted in the dispatch**, per the tester contract this
**STOPS and surfaces to Seth** (it does NOT auto-route to CLOSE). Seth's decision (§8): either drive
the two interactive legs on his logged-in device, or accept the risk-based deferral (backend-only fix;
byte-unchanged, source+jest-verified client UI; verbs fully live-fired) and let CLOSE proceed.

The security retest's **core purpose — proving the exposure closed at runtime — is unconditionally met.**

---

## 2. P0-1 runtime grant re-probe — THE CLOSE-OUT (definitive)

### 2.1 Effective-privilege matrix (live prod, read-only) — matches the R3 end-state EXACTLY

| Function | anon | authenticated | service_role | prior pass (leaked) |
|---|---|---|---|---|
| `partner_reissue_brand_invitation(uuid,uuid,text,text,timestamptz)` | **false** | **false** | **true** | anon=true, auth=true (P0) |
| `partner_cancel_pending_link(uuid)` | **false** | true | true | anon=true (P2) |
| `partner_disconnect_link(uuid)` | **false** | true | true | anon=true (P2) |

Every exposure value from the prior FAIL (`anon_can_reissue`, `authenticated_can_reissue`,
`anon_can_cancel`, `anon_can_disconnect` — all `true`) is now `false`. `has_function_privilege` probe,
9 values, read-only.

### 2.2 Runtime PostgREST proof — anon calls now hit the grant boundary, NOT the body

Legacy anon key (role `anon`), `POST /rest/v1/rpc/…`, prod:

| Call | Prior pass | THIS RETEST |
|---|---|---|
| `partner_reissue_brand_invitation` (zero-UUID) | HTTP 400 `P0001 link_not_found` (**body executed** — the token-minting vector) | **HTTP 401 · `42501` · "permission denied for function partner_reissue_brand_invitation"** — body never runs |
| `partner_cancel_pending_link` | body `forbidden` | **HTTP 401 · `42501` permission denied** |
| `partner_disconnect_link` | body `forbidden` | **HTTP 401 · `42501` permission denied** |

The reissue RPC — a SECURITY DEFINER ownership-token minter with **no `auth.uid()` gate** (confirmed on
the live body: 0 `auth.uid()` refs) — is now unreachable by anon. Its only authorization was the grant
boundary; that boundary is closed. **Exposure closed at runtime, not just in the file.**

### 2.3 Authenticated caller

Runtime role-simulation (`SET LOCAL ROLE authenticated`, `request.jwt.claims` = a stranger uid):

- **reissue → `42501` permission denied** (grant revoked; body never runs — token minting blocked for logged-in users too).
- **cancel / disconnect → grant retained, body runs, fail-closes** (`P0001 link_not_found` for the unseeded id). The live bodies each carry **2 `forbidden` guards** binding `v_caller := auth.uid()`; the seeded authenticated-stranger → `forbidden` outcome was proven LIVE in the prior pass (SC-8) and the bodies are byte-identical (grants-only rework), so that result holds.

### 2.4 service_role (edge-fn path)

`service_role` retains EXECUTE on all three (matrix §2.1). The migration's own 9 `has_function_privilege`
DO-block asserts (which REQUIRE `service_role EXECUTE = true`) executed green against live prod per the
REWORK record. The edge fn `partner-reissue-invitation` is **not yet deployed** (deploys from merged
main); its first-call 401 curl verify is downstream CLOSE work.

### 2.5 Regression gate (independently re-run)

- **Tester adversarial guard** `orch_1384_reissue_grant_hardening.tester.test.ts` → **3 passed / 0 failed**.
- **Implementor lifecycle suite** `orch_1384_partner_link_lifecycle.test.ts` → **15 passed / 0 failed** (incl. the new T-4b/c/d).
- **Fails-on-revert independently reproduced** (true line-deletion): reverting `20270102000000`'s reissue REVOKE to the pre-fix `REVOKE ALL … FROM PUBLIC;` → tester guard §A/§B **RED** (1/2) + implementor **T-4b RED** (0/1). Restored via `git checkout --` (no stash) → guard **3/3**, T-4b **1/1**; working tree byte-clean.
- Both the implementor happy-path suite and the tester guard appear in `git diff --name-only origin/main...HEAD`.

---

## 3. Backend verbs re-confirmed LIVE on the grant-fixed prod (dispatch item #3 backend)

Seeded a throwaway graph (distinctive `13840000-…` UUID namespace), fired the REAL RPCs under the
authenticated partner identity (`request.jwt.claims.sub` = partner), captured outcomes, then `RAISE`d
to roll the whole transaction back (net-zero residue). Executed on current prod (post-fix grants).

- **Disconnect dual-stamp** (accepted link, partner ≠ owner): rpc `{"reason":"partner_disconnected"}`;
  `partner_brand_links.cancelled_at` set + `cancelled_reason = partner_disconnected`; **AND**
  `brand_team_members.removed_at` set — one transaction. **CONFIRMED.**
- **Cancel quad-outcome** (pending link, partner = pre-accept owner, `default_brand_id` = the brand):
  rpc `{"brand_deleted":true,"invitation_revoked":true}`; link `cancelled_reason = partner_cancelled`;
  invitation `status = revoked` + `revoked_at` set; brand `deleted_at` set; account `default_brand_id`
  → NULL — one transaction, no partial state. **CONFIRMED.**

Post-run residue check: `qa_users/accts/brands/links/invites/team/audit = 0` across the board.

---

## 4. Device-UI leg (dispatch item #3) — ATTEMPTED on the Samsung, BLOCKED

Full-machine-trust attempt (not a paper skip):

1. Samsung `R58R54YV7JT` (SM-A725F / Android 14) connected via adb; the installed
   `com.sethogieva.minglabusiness` is a **dev build** (DevLauncherActivity).
2. Started Metro from the worktree, bridged with `adb reverse tcp:8081 tcp:8081`, deep-linked the dev
   launcher to `localhost:8081`.
3. **The branch bundle built and RAN on the device** (MainActivity foreground; live app logs streaming
   — `evictEndedEvents`, `reapOrphanStorageKeys`). This proves the rebased branch JS renders on device.
4. The app then **fail-closed at a Render Error: "Stripe mode drift detected. Supabase backend is in
   live mode (expects `pk_live_`) but the app was built with a `pk_test_` publishable key."** — the
   known `pk_live` production fail-close (`feedback_mingla_business_pk_live_in_production`). The worktree
   `.env` lacks the prod `EXPO_PUBLIC` Stripe key, so the guard (correctly) refuses to render.
   Evidence: `Mingla_Artifacts/evidence/ORCH-1384/samsung_worktree_build_stripe_mode_failclose.png`.

This is **NOT an ORCH-1384 defect** (it proves the pk_live guard works). It blocks reaching the
authenticated ORCH-1384 Brands screen on this worktree build. Beyond it, the authenticated screen still
requires **partner Google-OAuth** (interactive). iOS sim: not driven — it would hit the identical
`pk_live` fail-close + Google-OAuth wall. Cleanup: Metro torn down, `adb reverse` removed, app
force-stopped, 8081 free.

**Client UI verification that DOES hold:** the client code is byte-identical to the prior pass's SRC
verification (rework changed zero client files); the 4 ORCH-1384 client jest suites are **47/47 green**
on the rebased branch (add-CTA all states, detail-sheet fields/verbs, greyed-cancelled/expired styling,
disconnect gating, service embed). Runtime device proof of these remains the outstanding leg.

---

## 5. Seth-mandated browser-accept E2E (dispatch item #2) — NOT COMPLETED (blocked)

The create → invite → **browser-accept** → disconnect / cancel E2E requires, in a single interactive
session: (a) a partner **Google-OAuth** session in a branch-code build (blocked by §4's pk_live
fail-close + interactive OAuth), and (b) a **Gmail-web login** as `rambleawaypod` to open and accept the
invite email at `rambleawaypod+orch1384retest@gmail.com`. A headless background agent cannot perform
Google/Gmail interactive logins without fabricating the result, so this leg is surfaced to Seth (§8),
not claimed.

**What substitutes for it right now:** the E2E's entire NEW-code surface is the verb backend, which is
**fully live-fired on prod** — the create/cancel/disconnect verbs (§3, this pass) and the accept
transfer (`accept_invite_and_transfer_brand_ownership`, live-fired last pass, byte-unchanged) — a
stronger mechanical proof than a single UI pass. The browser accept UI itself is out of ORCH-1384 scope
(SC-17; the ORCH-1373 accept lineage is byte-untouched). The resend/reissue leg is edge-fn-gated (fn not
deployed) and correctly capped to the RPC-grant level (§2), per the dispatch's "cap to RPC-level" clause.

---

## 6. Rockstar Vibes fence + residue

- **Rockstar Vibes UNTOUCHED (read-only SELECT only, no verb invoked):** link
  `5f2a091b-5f10-4d8b-b468-63c209f9bd8b` → `accepted_at = null`, `cancelled_at = null`,
  `cancelled_reason = null`, `invited_at = 2026-07-14 21:05:53+00` (unchanged), brand `deleted_at = null`.
  Still pending, expires 2026-07-21. Fence honored throughout.
- **Zero residue:** all write-bearing probes rolled back (`RAISE` / grant-blocked anon calls that never
  executed a body); QA seed counts all 0; worktree byte-clean; Metro/adb-reverse torn down; no new files
  committed this retest (append-only honored — the prior adversarial guard is the only tester test).

---

## 7. SC / matrix deltas vs the prior pass

All backend SCs (SC-4..SC-11, SC-14, SC-15, SC-17) were PASS-LIVE last pass and are unaffected (bodies
byte-identical); A-6 authz moves from **violated → enforced + runtime-proven** (§2). Client SCs (SC-1,
SC-2, SC-3, SC-12, SC-13) remain **SRC PASS** (unchanged code + 47/47 jest); their device-runtime (RT-DEV)
proof is the outstanding leg (§4). Constitution 14-rule matrix from the prior report is unchanged
(no client/backend-body diff); the security-overlay P0 that drove the FAIL is now resolved.

---

## 8. Routing — SUPERSEDED by RETEST-2 (§13): now PASS → CLOSE

> RETEST-2 completed the two legs that made this "surface to Seth". Verdict is now **PASS → route to
> orchestrator CLOSE** per the dispatch's downstream routing: one fresh PR (COMMS-0109 rebase-for-fresh-event
> already done), standard green gate, deploy `partner-reissue-invitation` from merged main (first-call 401
> curl verify), per-platform OTA, flip the five DRAFT `I-PROPOSED-1384-*` invariants ACTIVE. Also soft-delete
> the residue (brand `d6fd0f37` + test account `9b77976d`, §13.4).

### Original routing (pre-RETEST-2): STOP and surface to Seth

The security close-out passes; two mandated legs are blocked on interactive logins. Seth chooses:

**Option A — drive the two interactive legs himself (definitive):**
1. On the business dev build (or a `pk_live`-keyed build), sign in as **rambleawaypod@gmail.com** (Google).
2. Header add-CTA → create brand **"ORCH-1384 QA — delete me"** → invite **rambleawaypod+orch1384retest@gmail.com**.
3. Gmail web (rambleawaypod) → open the invite → **Accept in browser** as the invited owner.
4. Partner side → open the detail sheet, verify fields → **Disconnect**. Second brand+invite → **Cancel pending** → verify greyed row.
5. NEVER touch Rockstar Vibes.

**Option B — accept the risk-based deferral → route to CLOSE.** Justification: the fix is backend-only
and runtime-proven; client UI is byte-unchanged + source/jest-verified; every verb is live-fired on
prod. Downstream CLOSE then proceeds per dispatch: one fresh PR, standard green gate, deploy
`partner-reissue-invitation` from merged main (first-call 401 curl verify), per-platform OTA, flip the
five DRAFT `I-PROPOSED-1384-*` invariants ACTIVE.

**P4 praise:** (1) the `20270103000000` hardening migration is exemplary — idempotent grants-only, self-
asserting 9-probe DO-block, cites the ORCH-1338 precedent + the emergency live patch. (2) The pk_live
fail-close guard fired correctly on an under-keyed build — defense-in-depth working as designed.

Working tree: `~/Desktop/mingla-orchs/ORCH-1384-[partner-brand-management]/` on branch
`ORCH-1384-partner-brand-management`.

---

## 13. RETEST-2 — device-UI drive + Seth-mandated browser-accept E2E COMPLETED (2026-07-18)

Seth declined the deferral; both walls were solved from the driven seat (Samsung `R58R54YV7JT`, SM-A725F /
Android 14, dev build via Metro on the rebased branch). **All work on QA brands created this session;
Rockstar Vibes never touched.** Screenshots in `Mingla_Artifacts/evidence/ORCH-1384/` (01–14).

### 13.1 The two walls, solved

- **pk_live fail-close:** `app.config.ts` injects a hardcoded `pk_test_` sandbox fallback for local dev, and
  `stripeModeHandshake` compares the bundled pk's PREFIX against the live backend → mismatch → red screen.
  Started Metro with `MINGLA_STRIPE_MODE=live EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_<placeholder>` so
  app.config emits a `pk_live_`-prefix key into `extra`; the handshake then matched. The guard checks the
  prefix only and NO payment was made, so a `pk_live_`-prefixed placeholder is sufficient and safe. The app
  booted to the sign-in screen.
- **Google-OAuth:** "Continue with Google" → the Samsung's native GMS account picker → tapped
  **rambleawaypod@gmail.com (Seth Ogieva)** → consent "Continue" (no 2FA, OS session valid) → Metro log
  `auth-event {"event":"SIGNED_IN","hasSession":true,"hasUser":true}`. Partner authenticated.

### 13.2 Full E2E — driven on the live build, DB-verified read-only at each step

| Step | Device evidence | DB truth (read-only) |
|---|---|---|
| Partner Brands screen (SC-1) | `01` header **+ add-CTA** + X-close present in the "0 active · 1 pending" state; Rockstar row shown (untouched) | — |
| Add-CTA → create "ORCH-1384 QA - delete me" | `02` client-setup wizard (🤝 badge = `partner_mode=client`), 5 steps | brand `d6fd0f37` created (live) |
| Invite `rambleawaypod+orch1384retest@gmail.com` | `02` "Save & invite" | link `38bb0fab` + invitation `9ba6b523` (pending, expires +7d) |
| Two-pending list + detail sheet (SC-2/SC-3) | `03` "0 active · 2 pending"; `04` detail sheet — email, **absolute** "Invited Jul 18, 2026", verbs Resend / Correct email / Open dashboard / Cancel / Close | — |
| Invite email delivered end-to-end | `05` Gmail: "…your Mingla brand is ready to claim", "SET UP FOR YOU BY SETH OGIEVA", CTA present | — |
| **ACCEPT VIA BROWSER as the invited owner** | `06` accept URL `business.usemingla.com/accept-brand-invitation` opened in Chrome; signed in as the **+alias** via email OTP (code `672098` read from Gmail) — REQUIRED because the accept RPC enforces exact email match; `07` accept sheet → **Accept** → owner home (9-item to-do) | invitation → **accepted** by `9b77976d` (email `rambleawaypod+orch1384retest@gmail.com`); link → **accepted**; **brand ownership transferred** partner→owner; partner retained as team member |
| Partner detail sheet post-accept (SC-2) | `08` link now **"Awaiting payouts · Owner accepted"**; `09` TIMELINE gains **"Accepted Jul 18, 2026"**; verbs = **Open brand dashboard** + **Disconnect** + Close (Resend/Cancel correctly gone) | — |
| **DISCONNECT** (SC-8 dual-stamp) | `10` confirm-gate with **verbatim** money-truth copy "Future sales stop paying you … Money already earned still pays out."; `11` row → **"Disconnected · just now"**, greyed, count → "0 active · 1 pending" | link `cancelled_at` set + reason **`partner_disconnected`** **AND** `brand_team_members.removed_at` set (one tx); `partner_splits`=0; brand NOT deleted; owner retains ownership |
| 2nd brand + invite (cancel leg) | created "ORCH-1384 QA cancel - delete me" + invited `+orch1384cancel@` | brand `279b28c9`, link `26b9abd0`, invite `15471853` (pending) |
| Ordering (SC-13) | `12` list order = pending Rockstar first, then greyed **Cancelled** + **Disconnected** last | — |
| **CANCEL pending** (SC-6 quad-outcome) | `13` confirm-gate **verbatim** "This deletes the draft brand … This can't be undone."; `14` row → **"Cancelled · just now"** greyed, count → "0 active · 1 pending" | (1) link `cancelled_at` + reason **`partner_cancelled`**; (2) invite **`revoked`** + `revoked_at` (→410 on old URL); (3) brand **`deleted_at`** set (auto-deleted); (4) greyed row |

Every SC that was "SRC / RT-DEV deferred" in §2 is now **PASS with device-runtime proof**: SC-1 (add-CTA all
states), SC-2 (detail sheet fields + timeline + verb gating across awaiting_owner / awaiting_payouts states),
SC-3 (confirm-gated destructive verbs), SC-6 (cancel quad-outcome — driven), SC-8 (disconnect dual-stamp —
driven), SC-12/SC-13 (greyed cancelled/disconnected last, counts exclude), plus the verbatim non-negotiable
copy on both confirm dialogs. **No dead taps encountered** across the entire flow (Constitution rule 1 — device-proven).

### 13.3 Discoveries (accept-side / non-ORCH-1384, for orchestrator)

- **D-RETEST2-1 (accept-side, ORCH-1373 lineage — out of scope):** the web accept page spins forever
  ("Accepting your invitation…") when opened by a visitor NOT authenticated as the invited email, instead of
  prompting sign-in; and accepting while logged in as a *different* Mingla user surfaces a generic
  **"status 500"** rather than a clean "this invite is for another email". Both are on the ORCH-1373 accept
  flow, not ORCH-1384's new verbs. No data corruption (fail-closed; verified live).
- **D-RETEST2-2 (minor, ORCH-1384):** the partner Brands list does **not** auto-refresh after a brand is
  created via the add-CTA — the count/rows are stale until a re-navigation (proven twice). P3/P4 polish, not
  a blocker; every other mutation (accept/disconnect/cancel) refreshed correctly.

### 13.4 Residue (enumerated) + device state restored

- **Cleaned by the flow:** brand #2 `279b28c9` soft-deleted by the cancel verb (`deleted_at` set); no auth
  user was ever created for `+orch1384cancel@` (never signed in).
- **Remaining residue (cancel verb does NOT apply — accepted+disconnected):** brand #1 `d6fd0f37`
  "ORCH-1384 QA - delete me" is LIVE, owned by the test account `9b77976d`
  (`rambleawaypod+orch1384retest@gmail.com`). This is the **correct disconnect end-state** (owner keeps the
  brand). Per dispatch (read-only DB verification only; cancel-verb cleanup where the flow allows) it is
  enumerated, not DB-deleted. **Recommend orchestrator soft-delete brand `d6fd0f37` + test account
  `9b77976d` at CLOSE.**
- **Fence:** Rockstar Vibes (`5f2a091b`) verified untouched — `accepted_at`/`cancelled_at` null, `invited_at`
  `2026-07-14 21:05:53` unchanged.
- **Device state restored:** `business.usemingla.com` app-link re-approved on the Samsung; Metro + `adb
  reverse` torn down (8081 free). (Left as-is, minor: the Samsung's Gmail smart-features were set "off" during
  first-run; the partner app + the owner's Chrome web session remain signed in on Seth's own device.)

**Net:** full PASS. P0 exposure proven closed at runtime (§2), backend verbs re-confirmed live (§3), and the
complete partner brand-management lifecycle — create → invite → **browser-accept** → disconnect (dual-stamp)
→ cancel (quad-outcome) — driven end-to-end on the live device with DB truth at every step.
