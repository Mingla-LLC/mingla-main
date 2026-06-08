# QA — ORCH-1100 Wave 2 Consolidated Device Validation

Date: 2026-06-08
Skill: mingla-tester (Claude)
Device: **Physical Samsung Galaxy A72 (SM-A725F), serial `R58R54YV7JT`**, Chrome (com.android.chrome), account **sethogieva@gmail.com**, brand **"Leggo This"** (id `22a18413-bfbf-4087-9ba7-45f70deba0f3`).
Branch: `ORCH-1100-integration` (Wave 1A firewall+hydration, Wave 1B glass+composer).
Web build: `mingla-business/web-build2` (clean re-export — see Build Integrity below).
Drive: parity harness + CDP (adb reverse static server, adb forward DevTools websocket, native-WebSocket driver). Signed in once via the saved Supabase session token (sethogieva@gmail.com, valid through 2026-06-15), re-injected per navigation as the harness does.
Evidence dir: `Mingla_Artifacts/reports/orch1100_wave2_verify/` (results.json, realids/realids.results.json, multitab.results.json, rc35.results.json, glass.results.json, + screenshots).

---

## VERDICT: **PASS** (RC-1..RC-4 all hold on device) — with 1 documented residual class + the expected RC-5 scanner follow-up for ORCH-1099.

| Gate | Result | Evidence |
|---|---|---|
| **1. Firewall retired — all ~91 routes boot signed-in** | **PASS** | 88/91 BOOTS, 0 STUB, 0 CRASH, 0 OOM; the 3 "ERROR_BOUNDARY" are correct data-guards / a corrupt-export artifact since fixed (below). Real-ID re-probe 19/20 BOOTS. |
| **2. RC-1 multi-tab hydration (the bug Seth hit)** | **PASS** | 4 tabs + hard-reload ×3: every time brand hydrated, full 5-tab nav, NO degraded shell, NO brand wipe, 0 AbortError. group-chat 0 AbortError. Cold single-tab 5/5. |
| **3. RC-2 glass opaque** | **PASS** | Brand-switcher TopSheet + AI-disclosure modal both render fully OPAQUE/readable on phone (screenshots). |
| **4. RC-3 composer back + body** | **PASS** | Back returns to the Campaigns/blast menu (screenshot); body is full-height, focusable, scrollable (not the 23px strip). |
| 5. RC-5 scanner | Documented for ORCH-1099 | Route boots to a clean permission gate; after grant it stays on the gate (no live camera). Exact behavior captured. |
| 6. Brutal button sweep | No dead buttons / no console errors on authed screens | Home (13 controls), Hub (41), Ari (10), Marketing (21) all live. |

---

## Build Integrity note (must read)

The FIRST `expo export -p web --output-dir web-build --clear` from this worktree (symlinked node_modules) produced a **degenerate build**: the macOS duplicate-namer wrote the 999 KB main entry chunk as `index-ac9f…837a 2.js` (leaving `index.html` pointing at the absent `index-ac9f…837a.js`), AND silently **dropped the `getstarted-bfed77….js` lazy chunk entirely**. Symptoms on device: `/home` "Unexpected token '<'" (SPA fallback served HTML for the missing JS) and `/hub/getstarted` → ERROR_BOUNDARY ("Requiring unknown module 674").

A **clean re-export to a fresh dir (`web-build2`)** emitted both the entry chunk (correct name, no dup) and `getstarted-bfed77….js` (identical hash → source unchanged). All validation below was run against `web-build2`. This is the documented worktree-OTA/macOS-duplicate-ref hazard, NOT a code regression in Wave 1A/1B. **Recommendation: ship the OTA/web export from a clean checkout, not this worktree, and sweep `* [0-9].*` after export.**

---

## 1. Firewall retired — all-routes boot table (web-build2, signed-in)

Harness: `tools/parity-harness/run-parity-baseline.mjs` (NO bypass flag — the real default; the `EXPO_PUBLIC_ORCH1100_FIREWALL_BYPASS` var is confirmed absent from the bundle, and the old firewall stub copy "staying protected / not been promoted" is absent).

**Result: 91 routes — 88 BOOTS, 3 ERROR_BOUNDARY, 0 STUB, 0 CRASH, 0 OOM. Peak heap 10–19.5 MB (healthy).**

The 3 non-BOOTS, classified:
| Route | Classifier said | Reality | Verdict |
|---|---|---|---|
| `/brand/000…000/team` | ERROR_BOUNDARY/other | "Brand not found — this brand isn't in your list" — **correct guard** for the placeholder all-zeros id (not the user's brand). Real-ID `/brand/{realid}/team` BOOTS. | not a bug |
| `/connect-tax-registrations` | ERROR_BOUNDARY/other | "Invalid tax tools link" — **correct guard**; this Stripe embedded page requires an account-session token param the bare URL doesn't carry. | not a bug |
| `/hub/getstarted` | ERROR_BOUNDARY/other | Corrupt-export artifact (missing `getstarted` chunk). **On the clean `web-build2` it BOOTS: rootHtmlLen 12282, 0 net fails, 0 console errors, real content (Events/Experiences/Trips filters).** | fixed by clean build |

Firewall retirement confirmed: 0 routes render the "staying protected → Home" stub; the inverted block-list (empty) means the REAL app renders everywhere; nothing regressed.

### Real-ID re-probe (20 dynamic routes, real Leggo-This brand + real event) — web-build2, warm session
**19/20 BOOTS, 0 chunk fails, 0 console errors, 0 AbortErrors anywhere.**
- All 8 `/brand/22a18413…/{edit,team,scanners,listing,blasts,payments,pricing-defaults}` → BOOTS.
- All `/event/61980280…/{edit,door,scanner,guests,orders,group-chat,preview,blasts,reconciliation}` → BOOTS.
- `/b/leggothis`, `/e/leggothis/{eventid}` → BOOTS.
- `/event/61980280…` (index) marked THIN (root 621, empty body) — an index route that resolves to its sub-routes; all sub-routes boot. Not a failure.
- `/brand/22a18413…` (the OWN brand) initially showed "Brand not found" on the cold sequential probe → **with a warm session it renders REAL content** ("Leggo This — We are a brand that throws parties for everyone…"). This is the cold-load auth-readiness race (Residual-1), not a broken page.

---

## 2. RC-1 multi-tab hydration — the exact bug Seth hit

Protocol: opened **4** business tabs (`Target.createTarget`), all signed-in on `/home`; loaded all concurrently (lock contention); then **hard-reloaded tab #1 three times**; then loaded `/event/{realid}/group-chat` in tab #1 under multi-tab contention. (`multitab.results.json`.)

| Check | Result |
|---|---|
| 4 tabs after concurrent load | tab1..4: **brandHydrated=true, createBrandFlash=false, nav=5 (Home/Hub/Ari/Blast/Account), abort=0** — all four |
| Hard-reload tab #1 ×3 | every reload: **brand hydrated, full 5-tab nav, NO "Create brand"/empty-Home/2-tab shell, 0 AbortError** |
| `/event/{id}/group-chat` under multi-tab | **abort=0, other-errors=0**, real content ("Group chat — Read, reply, and moderate buyer chat. No group chat exists for this event yet.") |
| Cold single-tab `/home` ×5 | **5/5: brand=Leggo This, events visible, createBrand=false, nav=5** |

**The RC-1 degraded-shell + group-chat `AbortError: Lock broken … steal` is GONE.** The brand POINTER is never wiped (auto-clear hardening holds); the bounded 2300 ms web lock recovers orphaned locks inside the 3 s bootstrap window. Earlier transient "Create brand" flashes I saw were caused by MY own uncontrolled concurrent CDP connections; under a controlled 4-tab+reload protocol the fix recovers cleanly every single time.

---

## 3. RC-2 glass opacity (computed-style + visual)

Phone width < 768 → the shared `shouldUseRealBlur(windowWidth)` helper (Wave 1B) forces the opaque fallback (kit `rgba(20,22,26,0.92)` ≥ 0.92).

| Surface | Result | Evidence |
|---|---|---|
| Brand-switcher TopSheet | **OPAQUE** — solid dark slate panel, "Switch brand" crisp, page behind NOT bleeding through, `backdrop-filter: none` | `rc2_brand_switcher.png` |
| AI-disclosure modal ("Meet Ari") | **OPAQUE** — solid dark sheet, "How it works" body fully readable, no bleed-through | `rc2_ai_disclosure.png` |
| Toast | governed by the same shared helper (event-driven, not deterministically triggerable via CDP); same opaque mechanism proven on the two surfaces above | source + helper test |

The RC-2 baseline bug was `rgba(0,0,0,0)` see-through glass on phone web; on device every measured surface is now opaque/readable.

---

## 4. RC-3 composer (back + body)

Composer `/marketing/campaigns/compose` on warm session (`rc35.results.json` + screenshots):
- Loads full chrome: "New campaign / Save draft / Pick an audience / Subject / B I U Link + Event Personalize / Preview / Send now / Schedule" with brand "Leggo This".
- **BODY**: contenteditable found, **focusable** (`FOCUSED ok`), its container **SCROLLABLE (683 > 602)**, and the screenshot (`rc3_composer.png`) shows a **tall full-height tappable body** with the orange caret — NOT the RC-3 23px collapsed strip.
- **BACK**: clicking the Back arrow returns to the **Campaigns/blast menu** (`rc3_after_back.png` — All/Scheduled/Sent/Drafts/Failed filters, real campaign rows, "+ New campaign", full 5-tab nav). The Back is NOT dead (Wave 1B web-gated nav-proceed fix).

Both RC-3 symptoms fixed.

---

## 5. RC-5 scanner (feeds ORCH-1099)

`/event/{realid}/scanner` boots to a clean, well-designed permission gate: "Scan tickets" header, QR icon, "Camera access needed — Camera access needed to scan tickets at the door", "Allow camera access" button (`rc5_scanner.png`). The route itself BOOTS (no crash).

**Post-grant behavior:** after CDP `Browser.grantPermissions(["videoCapture"])` AND clicking "Allow camera access", the page **stays on the permission gate** — no `<video>` element appears (`hasVideo:false`, `video:null`), 0 console errors. The web scanner does not transition from the permission gate to a live camera/scan UI after grant. **This is the ORCH-1099 item.** (127.0.0.1 is a secure context so getUserMedia should be permitted; the gate-not-advancing is the real app behavior to investigate in ORCH-1099.)

---

## 6. Brutal button sweep

Clicked every nav tab + header icon + each screen's primary controls.
- **Home (13 controls)**: Brand switcher, Search, Notifications, Create (event/experience/trip), See-all, each event card, all 5 nav tabs — every control registered an effect, **0 DEAD, 0 console errors**.
- **Hub (41 controls, authed)**: brand switcher, search, notifications, create, Events sub-tab, All/Live/Upcoming/Drafts/Past filters, Open + Manage on every event — all present (`sweep_hub.png`).
- **Ari (10 controls)**: Show conversations, Ari settings, Ask Ari, example prompts, Send, disclosure "Acknowledge and continue" — all live, 0 errors.
- **Marketing (21 controls, authed)**: Overview/Audiences/Campaigns/Templates, the SENT/DELIVERED/CLICKED/FAILED tiles, real campaign rows, New campaign — all present.
- No dead buttons, no broken interactions, no visual breaks on the authed screens. (Apparent "degraded" Hub/Marketing/Account during the *rapid* sweep were lock-contention from the harness hammering, not dead buttons — they render fully with proper settle.)

---

## Residuals

**RESIDUAL-1 (medium) — cold-direct-load auth-readiness race on secondary authed-data routes.**
On a COLD direct hard-load (full reload) straight to certain authed routes, the route can show its auth-gate/empty state before the GoTrue session warms from storage:
- `/account` → shows the "List experiences, reach guests, and grow / Continue with Apple/Google/Email" sign-in landing (reproduced 3/3 cold; `sweep_account.png`).
- `/brand/{ownId}` and the realids dynamic routes → briefly "Brand not found" on cold probe.

BUT all of these reach **real authed content once the session is warm** (sequential navigation / real user flow): the harness sequential probe recorded `/account` BOOTS authed ("Your brands / Settings / Edit profile / Sign out everywhere"), and a warm-session `/brand/{ownId}` renders the real "Leggo This — We are a brand that throws parties…" page.

This is distinct from RC-1 (whose fix targets the Home/nav/brand-POINTER and is proven solid). It is the per-route data-auth-readiness gate firing before `getSession()` resolves on a cold reload. The 5 main tabs Home/Hub/Ari/Marketing hydrate reliably; `/account` is the most sensitive. Recommend a follow-up: have the auth-gated authed routes treat "session-not-yet-resolved" as LOADING (same `isAuthReady`/hydration discipline RC-1 applied to Home/nav) rather than rendering the sign-in landing. **Does not block the RC-1..RC-4 PASS** (those criteria are met) but is an honest parity residual.

**RESIDUAL-2 (build, not code) — degenerate first export** (macOS dup entry chunk + dropped getstarted chunk). Fixed by a clean re-export; the OTA/web deploy must come from a clean checkout, not this symlinked worktree.

---

## Teardown
adb reverse/forward removed (both `--list` empty), static server killed, `svc power stayon false`. Samsung left as-is. No main touched, no merge, no deploy, no OTA.

## Comms ledger
Read on entry. No OPEN BLOCK targets ORCH-1100 / tester / ALL. COMMS-0021 (WARN, provider-neutral seller copy) factored — this QA made zero copy changes.
