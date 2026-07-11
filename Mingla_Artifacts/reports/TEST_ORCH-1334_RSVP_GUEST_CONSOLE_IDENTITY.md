# TEST — ORCH-1334 [rsvp-guest-console-identity-gap]

**Phase:** TEST (adversarial verification). No product-code edits, no merge, no CLOSE.
**Worktree:** `~/Desktop/mingla-orchs/1334-[rsvp-guest-identity]/` on branch `1334-rsvp-guest-identity`
**Impl commit under test:** `3d58fa6ec` (branch HEAD `1febf54bf`, docs on top).
**Migration:** `20261224000000_orch_1334_rsvp_guest_identity.sql` — **APPLIED to prod** (`gqnoajqerqhnvulmnyvv`), version recorded in `schema_migrations`. Live-fired directly; NOT re-applied.
**Date:** 2026-07-10
**Comms:** read `COMMS_LEDGER.md` on entry — no BLOCK addressed to mingla-tester / ORCH-1334 / ALL. Open rows are WARN/FYI to ALL for other ORCHs (COMMS-0084/0086 sheet/media; COMMS-0087 CI-pin already RESOLVED). No ack required.

---

## 1. Verdict

**CONDITIONAL PASS** — P0: 0 · P1: 0 · P2: 1 · P3: 0 · P4: 2

The backend security + identity core is **live-fire PROVEN on production** (guard rejects non-hosts, admits real hosts; DEFINER whitelist closed; consumer leaks no contact; admin gated; zero fabrication). One real defect remains: the **"On Mingla" badge text fails WCAG AA contrast** (P2, measured below). The business-app UI layer (press-isolation, detail sheet, Android opaque fallback) is **source-verified only** — the authed business RSVP console runtime is unreachable per standing constraint, so those UI success-criteria are capped at **suspected**, not device-proven.

**Conditions (UNACCEPTED — surfaced to Seth/orchestrator; do NOT auto-route to CLOSE):**
1. Fix the "On Mingla" badge color to ≥4.5:1 (P2-1 below). One-line change in two already-touched files.
2. Device-verify SC-5/SC-6/SC-7 (row press-isolation, sheet, Android opaque) on a business build before go-live, OR Seth accepts the source-suspected evidence.

Regression gate: **SATISFIED** — implementor happy-path `orch_1334_rsvp_guest_identity.test.ts` (11/11, fails-on-revert re-proven by me) + tester adversarial `orch_1334_rsvp_identity_adversarial.test.ts` (5/5, different angle, fails-on-revert), both in `git diff origin/main...HEAD`.

---

## 2. SC-by-SC matrix

| SC | Criterion | Evidence | Result |
|----|-----------|----------|--------|
| SC-1 | Host RPC resolves app identity (display_name≠'Guest', source='app', email non-null, avatar/username) | **Live-fire prod** as real brand owner `6c61590c…` on event `8b84539d…`: 3 rows stored `guest_name='Guest'` → `display_name`="sethogievabelgium Gotham"/"rambleawaypod U"/"Seth O", usernames + emails + phones, `source='app'` | **PASS (proven)** |
| SC-2 | Host RPC honest null phone (NULL, never fabricated) | Live: exact expr `COALESCE(NULLIF(btrim(NULL),''),NULLIF(btrim(NULL),''))`→NULL; whitespace→NULL; web-only→web value. Deno assert + T-2 fixture | **PASS (proven)** |
| SC-3 | Host RPC web parity (typed values, source='web') | Live: web row user_id NULL → display_name="Arifat", typed email/phone, `source='web'` | **PASS (proven)** |
| SC-4 | Host guard rejects rank < event_manager | **Live-fire prod**: stranger uid → `insufficient_event_permission` (P0001, RAISE line 9, 0 rows); empty uid → same | **PASS (proven)** |
| SC-5-iOS/Android | Console row: avatar + real name + source badge; whole body tappable → sheet; iOS glass / Android opaque | Source-traced `RsvpGuestConsole.tsx` (GuestAvatar, SourceBadge, `ROW_BG` Platform.select #23262b Android, rowBody Pressable). **Business authed runtime NOT driven** | **SUSPECTED** (source-verified; not device-proven) |
| SC-6 | Actions intact, no dead taps; action tap ≠ sheet, row tap ≠ action | Source: `rowBody` Pressable is a **sibling** of `{trailing}` action cluster (not nested); each action has own `onPress`; RN sibling Pressables don't cross-fire. **Not device-driven** | **SUSPECTED** (source-structural; runtime unverified) |
| SC-7 | Detail sheet: identity + time + plus-ones + status + contact (email always, phone when present, omit null) | Source `RsvpGuestDetailSheet.tsx`: WHO/WHERE-FROM/STATUS/PLUS-ONES/CONTACT blocks; `guest.phone!==null` gate omits phone row; email always for app. **Not device-driven** | **SUSPECTED** (source-verified) |
| SC-8 | Admin attendee list: real name + source badge, resolved email, actions/counts unchanged | **Live-fire prod** as active admin `63835860…`: rows show display_name "Seth O"/"rambleawaypod U"/"sethogievabelgium Gotham" + `source` + resolved email, total=4; `OfferingDetailView.jsx` diff verified | **PASS (proven, backend); UI source-verified** |
| SC-9 | Consumer twin self-identity (own real name, NO email/phone columns) | **Live prod** `pg_get_functiondef(fetch_user_going_rsvps)`: both profile joins present, self-scopes present, `email`/`phone` **absent from body**; live return signature has no email/phone col | **PASS (proven)** |
| SC-10 | Write path untouched | `git diff origin/main…HEAD --name-only` = allowlist only; no `submit_event_rsvp`/`public-submit-rsvp`/`rsvpDeckService`/`rsvpEvents`; Deno asserts `submit_event_rsvp` absent | **PASS (proven)** |
| SC-11 | Append-only maybe test stays green | `rsvpMaybeMigration.orch1150r2.test.ts` → **7/7 PASS** (Jest); immutable `20261012` file untouched | **PASS (proven)** |

---

## 3. Findings

### P2-1 — "On Mingla" badge text fails WCAG AA contrast (normal-size text)

- **Evidence (measured with real `designSystem.ts` tokens, alpha-composited over the row surface):**
  - Badge text `accent.warm` `#eb7825` on fill `accent.tint` `rgba(235,120,37,0.28)`:
    - iOS (glass tint `rgba(255,255,255,0.04)` over `canvas.discover` `#0c0e12`): **3.94:1**
    - Android (opaque `#23262b`): **3.38:1**
    - bare canvas: 4.36:1
  - Badge text is `typography.micro` = **11px, weight 600** → NOT large-scale (large = ≥18pt/24px or ≥14pt/18.66px bold) → **AA threshold is 4.5:1**. All three composited surfaces are **below 4.5:1**.
- **Adjudication:** the SPEC §4E-4 "Badge AA rule" requires the implementor to verify each badge ≥4.5:1 and lighten if it fails. This was done for the **web** badge (`#3b82f6`→`#7ab0ff`; I measured `#7ab0ff` = **6.43 iOS / 5.45 Android** → **PASS**), but the **"On Mingla"** badge shipped with the failing brand token. Violates SPEC §6 invariant "WCAG AA kit (I-38/I-39)" and memory `feedback_wcag_aa_kit_invariants` (non-negotiable).
- **Impact:** the source-badge word (which carries the meaning, not color-only) is legible but sub-AA; low-vision users on Android see the worst case (3.38:1). Not a functional break; not release-blocking by itself, but it breaks a stated non-negotiable accessibility invariant.
- **Required fix:** lighten the "On Mingla" text, exactly parallel to the web-badge fix. Recommended **`#ffa94d`** (measured **6.00 iOS / 5.15 Android**, comfortable margin, still clearly brand-orange). Existing token **`semantic.warning` `#f59e0b`** also clears AA (5.32 iOS / 4.56 Android) if a token reuse is preferred. Change the `accent.warm` literal in the two `SourceBadge` components:
  - `mingla-business/src/components/rsvp/RsvpGuestConsole.tsx` (`SourceBadge`, `color: isApp ? accent.warm : WEB_BADGE_TEXT`)
  - `mingla-business/src/components/rsvp/RsvpGuestDetailSheet.tsx` (same)
  - Admin `OfferingDetailView.jsx` uses a `<Badge variant="info">` component — verify that variant's own contrast separately (its tokens are outside this diff; not measured here).
- **Retest:** recompute both badges ≥4.5:1 with the composited fills; confirm on a business Android build.

### P4-1 — Guard mirrors the shipped write-path predicate exactly (praise)
The host guard is the byte-identical predicate used by `host_set_rsvp_status` / `host_bulk_approve_rsvps` / RLS `event_rsvps_host_read`, and I proved the real brand owner still succeeds live — so no host who can approve loses read access, and the DEFINER swap introduced no over-exposure (fail-closed on NULL brand). This was the #1 regression risk and it is clean.

### P4-2 — Honest defensive mapper (praise)
`rowToGuest` falls back `display_name→guest_name`, `source→user_id`-derived so pre-migration cached rows never crash the mapper; no fabrication introduced.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out the fix state at branch HEAD (impl commit `3d58fa6ec`), ran the implementor's `orch_1334_rsvp_guest_identity.test.ts`:
- **Baseline:** `deno test` → **11 passed / 0 failed**.
- **Reverted** (true line deletion of `RAISE EXCEPTION 'insufficient_event_permission';` AND the host `display_name` COALESCE line): → **9 passed / 2 failed** — exactly `host RPC guards FIRST on event-manager brand rank` and `host RPC resolves identity from profiles at read time`. Matches the implementor's claim (2 RED).
- **Restored** from byte backup → `git status --porcelain` clean → **11 passed / 0 failed**.
- **`fails-on-revert re-verified at 3d58fa6ec`.**

---

## 5. Adversarial test added (tester-owned, different angle)

- **Path:** `supabase/migrations/__tests__/orch_1334_rsvp_identity_adversarial.test.ts` (NEW, append-only).
- **Different angle from the implementor's presence-of-string contract:** asserts **guard-FIRST ORDERING** (RAISE index strictly precedes `RETURN QUERY` / first `FROM event_rsvps` in BOTH host and admin — a DEFINER that produced rows before the guard would pass every presence test yet leak the list); a **closed sensitive-column blocklist** (`p.visibility_mode`/`p.bio`/`p.birthday`/`p.gender`/`profile_*`… absent); and the **consumer RETURNS-TABLE signature** declares no email/phone OUTPUT column.
- **Result:** **5/5 PASS.**
- **fails-on-revert:** deleting the host guard `RAISE` → `adversarial: host guard RAISE precedes ALL row production` goes **RED** (4 passed / 1 failed); restored → 5/5. Also self-caught a test-authoring false positive (bare `is_admin` collided with the legitimate `is_admin_user()` call) and tightened to alias-projection form before finalizing.
- Both test files appear in `git diff origin/main...HEAD --name-only`.

---

## 6. Live-fire evidence log (prod `gqnoajqerqhnvulmnyvv`, read-only)

1. `pg_proc`: all 3 RPCs live as **SECURITY DEFINER, STABLE, `search_path=public`**, correct args.
2. `schema_migrations`: `20261224000000` recorded (frontier).
3. `host_list_rsvp_guests` live OUT columns = exactly the 18 (12 original + display_name/username/avatar_url/email/phone/source), correct order.
4. Live host body (`pg_get_functiondef`): guard predicate ✓, RAISE ✓, `LEFT JOIN public.profiles` ✓, `maybe` bucket ✓; **no `SELECT p.*`, no `visibility_mode`, no `bio`** → DEFINER whitelist closed (matches source, no drift).
5. Live consumer body: both profile joins + both self-scopes present; **`email`/`phone` absent** → identity-only confirmed.
6. **SC-1/3 host-positive:** as owner `6c61590c…` → 3 app rows resolved from 'Guest' + 1 web row typed; guard PASSED.
7. **SC-4 host-negative:** stranger uid → `insufficient_event_permission`; empty uid → same.
8. **T-8 admin-negative:** non-admin → `not_authorized` (RAISE line 11).
9. **SC-8/T-7 admin-positive:** admin `63835860…` → resolved names + source + email, total=4.
10. **SC-2:** null/whitespace phone COALESCE → NULL (no fabrication).
11. **T-6 blocked-pair:** `blocked_users` table exists + `profiles` RLS enabled; host RPC is DEFINER → bypasses the "viewable except by blocked users" policy → identity resolves deterministically regardless of any block. All 4 rows resolved fully in the host-positive run (proof by construction + live).

Note: no null-phone **app** row exists on the live event, so SC-2's app-row path is proven via the deterministic COALESCE probe + T-2 fixture rather than an organic live row.

---

## 7. Constitution 14-rule matrix

| # | Rule | Result | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | PASS (source-structural); runtime SUSPECTED | rowBody Pressable is a sibling of the action cluster; each action keeps its own onPress. Not device-driven (biz authed unreachable) |
| 2 | One owner per truth | PASS | read-time resolution; write path untouched; single guest source |
| 3 | No silent failures | PASS | per-action toasts; sheet stays open on error |
| 4 | One query key per entity | N/A | `useRsvpGuestList` key unchanged |
| 5 | Server state server-side | PASS | `selectedGuest` is ephemeral UI state; no server data in Zustand |
| 6 | Logout clears everything | N/A | no auth/persistence added |
| 7 | Label `[TRANSITIONAL]` | N/A | none shipped |
| 8 | Subtract before adding | PASS | reused shared `Sheet`; no duplicate primitives |
| 9 | No fabricated data | PASS (proven) | null phone → NULL live; display_name honest COALESCE |
| 10 | Currency-aware | N/A | no currency |
| 11 | One auth instance | N/A | none added |
| 12 | Validate at right time | N/A | no datetime validation |
| 13 | Exclusion consistency | N/A | — |
| 14 | Persisted-state startup | N/A | no persisted store added |

---

## 8. Device / parity matrix

| Surface | State | Evidence |
|---------|-------|----------|
| Backend SQL RPCs (host/admin/consumer) | **PROVEN** | live-fire on prod (§6) |
| Business iOS | SUSPECTED | source-verified; authed RSVP console runtime unreachable — NOT driven |
| Business Android | SUSPECTED | same + opaque `#23262b` fallback source-verified; **P2-1 badge contrast worst on Android** |
| Business Web preview | SUSPECTED | shared RN component; not driven |
| Admin Web | PROVEN (RPC) / source (JSX) | admin-positive RPC live-fired; `OfferingDetailView.jsx` diff read; page not driven |
| Consumer iOS/Android (twin) | PROVEN (RPC) | no-contact-leak live-verified; client `calendarService.ts` unchanged |
| Buyer/anon Web | N/A | host console is authed host-only |

**Physical iPhone HITL:** not requested this run — the gating limitation is the authed business console being unreachable, which a physical iPhone does not resolve without a signed-in event_manager brand + RSVP event. Flagged as a CONDITIONAL-PASS condition rather than a HITL step.

**Sim-gate exemption note:** the security/identity core (the substance of this ORCH) is backend SQL — source-only + live-fire is the correct evidence tier and is fully met. The UI redesign is genuinely UI/runtime; it is honestly capped at SUSPECTED per Phase 0.A because the business authed runtime is unreachable (memory `feedback_biz_web_authed_runtime_unreachable_cap_claims`).

---

## 9. Discoveries for Orchestrator

1. **P2-1 badge AA** (above) — fix `#eb7825`→`#ffa94d` (or `#f59e0b`) in the two `SourceBadge` components; also independently verify the admin `<Badge variant="info">` contrast (its tokens are outside this diff).
2. **Migration `.test.ts` files under `supabase/migrations/__tests__/` are NOT auto-globbed by CI** (implementor Discovery #4). Neither the implementor's nor this tester's Deno source-contract runs in CI unless registered in `DENO_TEST_FILES` in `.github/workflows/supabase-migrations-and-stripe-deno.yml`. If the invariants are to be CI-enforced, register both `orch_1334_rsvp_guest_identity.test.ts` and `orch_1334_rsvp_identity_adversarial.test.ts`.
3. **No admin rows in `profiles`** (`is_admin` all false) — `is_admin_user()` keys off the separate `admin_users` table by email; harmless, noted so future testers use `admin_users`, not `profiles.is_admin`.
4. **Profiles effectively world-readable** (standing privacy posture, carried from investigation) — not an ORCH-1334 defect; the DEFINER fix doesn't depend on it.
5. **`fetch_user_going_rsvps` self-guard (OQ-2)** — still no server-side `p_user_id = auth.uid()` enforcement (pre-existing; deferred by SPEC). Candidate hardening ORCH.

---

## 10. Accepted conditions (CONDITIONAL PASS)

These are **not yet accepted** — surfaced to Seth/orchestrator for decision (do NOT route to CLOSE until resolved):
- **C-1:** fix P2-1 badge contrast (trivial, within the existing allowlist files) — recommended before CLOSE.
- **C-2:** either device-verify SC-5/SC-6/SC-7 on a business build, or Seth accepts source-suspected UI evidence given the authed-console-unreachable constraint.

Backend/security/identity core requires **no rework** — it is production-proven.
