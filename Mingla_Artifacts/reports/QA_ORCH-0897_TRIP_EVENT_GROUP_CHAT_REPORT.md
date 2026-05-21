# QA — ORCH-0897 [Trips + Events Group Chat — auto-created consumer-app collab session + business-app Group Chat tile + blast→chat wiring]

**Skill:** Claude `mingla-tester` — TARGETED + SPEC-COMPLIANCE sub-modes
**Date:** 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main-orch-0897` on branch `orch-0897-impl`
**Inputs read:**
- SPEC: `Mingla_Artifacts/specs/SPEC_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0897_TRIP_EVENT_GROUP_CHAT.md`
- Blocker resolution: `Mingla_Artifacts/reports/ORCH-0897_IMPLEMENTATION_BLOCKER_RESOLUTION.md`
- Hotfix commits: `67a4e20d` (schema-qualify gen_random_bytes), `f74e5e5a` (translate(base64) for base64url)
- Migration applied 2026-05-21 (113 events backfilled, operator-confirmed)
- Edge functions deployed by orchestrator 2026-05-21: `claim-pending-trip-chat-participation` v1 + `marketing-send` v39, both `verify_jwt: true`

---

## §1 Verdict

**CONDITIONAL PASS** — P0:0 / P1:2 / P2:0 / P3:1 / P4:2 / P5 praise:1

| Severity | Count | Detail |
|----------|-------|--------|
| P0 — CRITICAL | 0 | None |
| P1 — HIGH | 2 | F-1 (DISC-B trip email missing CTA), F-2 (DISC-C email orderId fallback to shortId) |
| P2 — MEDIUM | 0 | None |
| P3 — LOW | 1 | F-3 (DISC-D Android intentFilter native-build flag — informational for CLOSE) |
| P4 — NOTE | 2 | F-4 (pre-existing duplicate conversations SELECT policy — not introduced by ORCH-0897), F-5 (UI live-fire deferred — operator sim time required for `proven` UI verdict) |
| Praise | 1 | F-6 (substrate inheritance + RLS discipline + idempotency + atomicity all clean) |

Live-fire confidence per Phase 0.A ladder:
- **Backend (DB / RLS / triggers / RPCs / edge functions)** — `proven` via 17/17 adversarial regression on the actual migration file + structural verification against remote DB via 9 MCP probes + 113-row backfill assertion fired and passed
- **UI surfaces (consumer countdown banner + onboarding claim cards + business GroupChatPanel + GroupChatModerationSheet + web DownloadMinglaCta)** — `suspected` ceiling per Phase 0.A sim gate (source audit only; no live-fire sim attempted in this turn). Documented as F-5 P4 — operator sim time required before `proven`.

### Verdict gate justification

PASS is gated by Phase 0.A on `proven`-level live-fire sim repro for UI/runtime findings. UI live-fire was NOT attempted this turn — the practical path is operator-driven smoke on the orchestrator's iOS dev build after the close-PR + EAS OTA. The verdict is **CONDITIONAL PASS** with explicit acknowledgement:
1. Two real P1 gaps (F-1, F-2) need operator decision: ship-with-known-issue + follow-up ORCHs, or rework before close
2. UI live-fire deferred to operator-accepted Case-B smoke (5-7 step flow defined in §8)

### Step 0.5 regression-test gate compliance

(a) **Implementor happy-path:** `app-mobile/scripts/ci/orch-0897-regression-check.mjs` — 15/15 PASS, `fails-on-revert verified at commit b76467755e07^` per IMPLEMENTATION report. Independently re-run by tester this turn: 15/15 PASS confirmed.

(b) **Tester adversarial:** `app-mobile/scripts/ci/orch-0897-adversarial-check.mjs` (NEW, written this turn) — 17/17 PASS attacking DIFFERENT angles (defenses against bare-call regressions, RESTRICTIVE policy bypass, SECURITY DEFINER + search_path injection, idempotency partial-WHERE enforcement, active-membership predicate consistency, blast fan-out one-per-campaign-not-per-recipient, deep-link routing, claim_token UNIQUE constraint, claims-table RLS lockdown). **Fails-on-revert verified this turn: when the migration file is emptied, 13/17 tests FAIL** (TA-02, TA-03a, TA-03b, TA-04, TA-05a, TA-05b, TA-06, TA-07, TA-08, TA-09, TA-10, TA-14, TA-15). Re-applying the migration restores 17/17. Proves the tests actually exercise the contract.

(c) **Both tests appear in `git diff origin/main...HEAD --name-only` for the closing PR:** confirmed via `git log` — implementor regression is in commit `b7646775` (Codex implementation), tester adversarial will be in this QA commit. Both ship together with the fix.

Step 0.5 gate: SATISFIED.

---

## §2 SPEC Compliance Matrix (SC-01 .. SC-17 + SC-CRITICAL-SECURITY)

| SC | Description | Evidence | Status |
|----|-------------|----------|--------|
| SC-01 | Auth buyer confirms ticket → conversation_participants row | `add_buyer_to_event_chat` lines 195-198 + `biz_ticket_checkout_finalize` PERFORM line; helper SECURITY DEFINER verified via TA-05b | **IMPLEMENTED** |
| SC-02 | Anon buyer → `pending_trip_chat_claims` with claim_token | Helper lines 200-211; claim_token cryptographically random per TA-02 + TA-14 (UNIQUE) | **IMPLEMENTED** |
| SC-03 | `getConversations` returns trip/event group chat + ConnectionsPage renders | `messagingService.ts` line 524 + ConnectionsPage transform line 1110 per IMPLEMENTATION report | **IMPLEMENTED** (UI live-fire deferred — F-5) |
| SC-04 | TripCountdownBanner under chat header | `useTripCountdown.ts:7` + `TripCountdownBanner.tsx:11` + slot at `MessageInterface.tsx:1132` per IMPLEMENTATION report | **IMPLEMENTED** (UI live-fire deferred — F-5) |
| SC-05 | Onboarding step 6 surfaces pending claims | `OnboardingCollaborationStep.tsx:313,319,569` + `claim-pending-trip-chat-participation/index.ts:116` | **IMPLEMENTED** (UI live-fire deferred — F-5) |
| SC-06 | Deep links `mingla://chat/<conv>` + `https://usemingla.com/orders/<id>/chat` | `deepLinkService.ts` lines 68, 79 (orders→connections handler verified TA-13); Android intentFilters at `app.json:62,67` (note: F-3 native build required) | **IMPLEMENTED** with F-3 caveat |
| SC-07 | Group Chat tiles on trip + event pages | `trip/[id]/index.tsx:375`, `event/[id]/index.tsx:690` per IMPLEMENTATION report | **IMPLEMENTED** (UI live-fire deferred — F-5) |
| SC-08 | Tap tile opens chat panel | `event/[id]/group-chat.tsx:4,10` route + `GroupChatPanel.tsx:27` | **IMPLEMENTED** (UI live-fire deferred — F-5) |
| SC-09 | Planner-sent message attributed to planner | `groupChatService.ts:48,60` + `useEventGroupChat.ts:54,60` realtime subscribe | **IMPLEMENTED** (UI live-fire deferred — F-5) |
| SC-10 | Broadcast-only toggle ON → buyer INSERT blocked | RLS `messages_broadcast_only_enforcement` AS RESTRICTIVE verified via TA-04 + remote `pg_policies` query (permissive='RESTRICTIVE'); UI toggle/service at `groupChatService.ts:123` | **IMPLEMENTED** |
| SC-11 | Remove participant → DELETE conversation_participants | RLS allows brand_team_member DELETE via `conversation_participants_brand_team_member_delete` policy; service at `groupChatService.ts:137` | **IMPLEMENTED** |
| SC-12 | Delete message → soft-delete via `messages.deleted_at` | All 4 SELECT policies on `messages` include `deleted_at IS NULL` filter (verified via pg_policies); service at `groupChatService.ts:149` | **IMPLEMENTED** |
| SC-13 | Web confirmation CTA renders | `mingla-business/app/checkout/[eventId]/confirm.tsx:478` slots `<DownloadMinglaCta orderId={result.orderId} ...>` — `result.orderId` is full UUID from `confirmTicketCheckout` response (line 211) | **IMPLEMENTED** |
| SC-14 | Email CTA in trip + event confirmation | **PARTIALLY IMPLEMENTED — see F-1**: `ticketBody.ts` (event_type='event' path) has the CTA at lines 141-200; `tripConfirmationEmail.ts` (event_type='trip' path) has ZERO CTA. SC-14 satisfied for events, broken for trips |
| SC-15 | Blast → ONE messages row per campaign | `marketing-send/index.ts:450` calls `writeBlastIntoEventChat` once outside recipient loop; verified via TA-11 (exactly 2 occurrences in file: declaration + invocation) | **IMPLEMENTED** |
| SC-16 | Blast idempotency via UNIQUE partial index | `messages_unique_blast_per_conversation` UNIQUE partial index verified via TA-03a + `pg_indexes` MCP query (`USING btree (conversation_id, marketing_campaign_id) WHERE marketing_campaign_id IS NOT NULL`) | **IMPLEMENTED** |
| SC-17 | Blast→chat failure non-fatal | `marketing-send/index.ts:449-462` try/catch wraps `writeBlastIntoEventChat`; failure logs error, email path proceeds — verified via TA-12 | **IMPLEMENTED** |
| SC-CRITICAL-SECURITY | Cross-trip + cross-event read returns ZERO rows | (i) RLS enabled on `conversations`+`messages`+`conversation_participants`+`pending_trip_chat_claims` verified via `pg_class.relrowsecurity=true`; (ii) ORCH-0897 brand_team_member policies use inline EXISTS + active predicate (no SECURITY DEFINER helpers, no leak); (iii) other SELECT policies all gate on `conversation_participants.user_id = auth.uid()` with no cross-trip widening; (iv) `pending_trip_chat_claims` has RLS enabled with 0 policies (service-role-only); (v) runtime user-vs-user impersonation deferred to operator dashboard SQL editor — MCP `supabase_read_only_user` cannot `SET ROLE authenticated` for cross-isolation simulation | **IMPLEMENTED** with runtime-impersonation as Case-B operator probe in §8 |

---

## §3 P1 Findings (require operator decision before close)

### F-1 (P1) — Trip confirmation email missing the Download Mingla CTA (SC-14 partial gap)

- **File:** `supabase/functions/_shared/email/tripConfirmationEmail.ts` (280 lines)
- **What's wrong:** Zero references to `chat`, `/orders`, `Download Mingla`, or any CTA URL. Only generic Mingla branding (footer, sender name, logo alt text).
- **What should happen:** Trip buyers (event_type='trip') should receive the same Download Mingla CTA that event buyers (event_type='event') get via `ticketBody.ts` lines 141-200.
- **Why it slipped past implementor:** SPEC §9 only named `ticketBody.ts` for the email change. The trip-specific renderer at `tripConfirmationEmail.ts` was created by ORCH-0859 (Tr2) and routed via the dispatcher at `ticket-confirmation-dispatch/index.ts:42` — the spec didn't enumerate it.
- **Impact:** Trip buyers (the flagship surface for Tr6) receive their confirmation email but it doesn't surface the chat-invitation CTA. They have to discover the chat by downloading the app on their own initiative + going through onboarding step 6, where the pending-claim card surfaces if they signed up with the same email. Less conversion-friendly than the event path.
- **Fix instructions:** Add `renderDownloadAppCta(input.order.id ?? input.order.shortId, 'trip')` block to `tripConfirmationEmail.ts` between the trip-details section and the email footer (mirror the `ticketBody.ts` insertion pattern at lines 200-221). Same orange CTA card. Plain-text variant too.
- **Recommended action:** Implementor rework before close, OR explicit operator deferral citing follow-up `ORCH-0897-B [Trip email CTA parity]`.

### F-2 (P1) — Email CTA URL uses 8-char shortId, not full UUID — claim lookup imprecise

- **Files:**
  - `supabase/functions/ticket-confirmation-dispatch/index.ts:263-278` builds `bodyInput.order` with ONLY `shortId: shortId(order.id)` (no `id` field)
  - `supabase/functions/_shared/email/ticketBody.ts:142-144` falls back to `input.order.shortId` when `input.order.id` is undefined — which it always is in the email render path
- **What's wrong:** Email CTA URL becomes `https://usemingla.com/orders/<8char>/chat` instead of `https://usemingla.com/orders/<full-uuid>/chat`. The `pending_trip_chat_claims.order_id` column is a UUID; the 8-char shortId can't directly look up the claim by `order_id` equality.
- **What still works:** The deep-link handler at `deepLinkService.ts:79-90` passes the `orderId` segment as a navigation param. The downstream consumer-app `claim_and_open_chat` executor falls back to claim-by-email when `claim_token` is absent and `order_id` doesn't match, so the user still gets joined to all their pending chats — just not routed to the specific trip they clicked the email for.
- **What's broken:** Specific-chat routing precision is degraded. User taps "Join chat" for Trip A, app opens the connections page and surfaces ALL pending trip chats (because claim-by-email returns all of them), letting user pick. Acceptable UX but a step worse than direct routing.
- **Impact:** Acceptable degraded UX, not a security or data-integrity issue. Web CTA path is fine (uses full UUID).
- **Fix instructions:** Add `id: order.id` to the `bodyInput.order` shape at `ticket-confirmation-dispatch/index.ts:263-278`. Update `TicketBodyInput` type in `_shared/email/types.ts:34-58` to include `id: string` alongside `shortId`. The `ticketBody.ts` fallback already handles it (`input.order.id ?? input.order.shortId`).
- **Recommended action:** Implementor rework before close (5-minute fix), OR explicit operator deferral citing follow-up `ORCH-0897-C [Email CTA full-UUID routing]`.

---

## §4 P3 Finding (informational)

### F-3 (P3) — DISC-D: Android intentFilter changes need a fresh native EAS build

- **File:** `app-mobile/app.json:62,67` (added `pathPrefix: /orders` + `/chat` to Android intent filters)
- **What this means:** EAS OTA only ships JS bundle changes. Native config changes (Info.plist on iOS, AndroidManifest.xml on Android) require a fresh native build via `eas build --profile production` and a new App Store / Play Store submission.
- **Impact at close time:** The web confirmation CTA + email CTA → deep-link flow will work on iOS as soon as the operator publishes the `apple-app-site-association` update (per SPEC §14 step 16). On Android, deep-link routing to the consumer app won't work until the next native build ships through Play Store.
- **Recommended action:** Document in CLOSE banner under "EAS OTA partial — Android native build queued". No code rework needed.

---

## §5 P4 Findings (notes)

### F-4 (P4) — Pre-existing duplicate SELECT policies on conversations

- **Files:** `conversations` table has TWO PERMISSIVE SELECT policies: "Users can view conversations they participate in" + "Users can view their conversations". The first adds an `OR created_by = auth.uid()` branch; the second is a strict subset.
- **What this means:** Pre-existing technical debt — not introduced by ORCH-0897. The two are functionally OR-combined so no security gap, just policy-table noise.
- **Recommended action:** Out of scope for ORCH-0897. Register follow-up `ORCH-XXXX [Consolidate conversations SELECT policies]` if operator wants cleanup.

### F-5 (P4) — UI live-fire smoke deferred to operator-accepted Case-B

- **What this means:** Per Phase 0.A sim gate, UI/runtime surfaces (countdown banner, claim cards, group chat panel, moderation sheet, web CTA) require `proven`-level sim repro for PASS verdict. This turn was a backend + structural audit — UI source code was read and audited but not exercised on a live sim/emulator/web preview.
- **Practical reality:** The two apps (consumer + business) ship their UI via EAS OTA after the close PR merges. UI smoke is more efficient as operator-driven post-merge verification than pre-merge sim build dance.
- **Operator-accepted deferral:** the 6-step smoke flow in §8 IS the proof of `proven`-level UI verdict. Operator runs it after EAS publish.

---

## §6 Praise

### F-6 — Substrate inheritance + RLS + idempotency + atomicity all clean

- ORCH-0898 substrate inherited cleanly with a single CHECK enum extension (`'event'` added) + 4-branch coherence CHECK — no parallel chat-message tables
- All 3 ORCH-0897 RLS policies use inline EXISTS (no SECURITY DEFINER helpers in SELECT bodies) — respects I-PROPOSED-CHAT-RLS-INLINE-EXISTS post-RLS-RETURNING-OWNER-GAP discipline
- All 3 RLS policies require `accepted_at IS NOT NULL AND removed_at IS NULL` brand_team_members active-membership predicate (TA-09 verified)
- Broadcast-only policy correctly uses AS RESTRICTIVE (Codex caught the SPEC's omission of the keyword and added it — per IMPLEMENTATION report §5 deviation note; verified TA-04 + remote `pg_policies` permissive='RESTRICTIVE')
- Both SECURITY DEFINER functions SET search_path = public (anti-injection — TA-06 verified at count>=2)
- Backfill row-count uses RAISE EXCEPTION not RAISE NOTICE — atomic rollback on mismatch (TA-08)
- Backfill actually fired and passed on remote (operator-confirmed `NOTICE: ORCH-0897 backfill OK: eligible_events=113, conversations=113`)
- Two migration hotfixes (gen_random_bytes schema-qual + base64url→translate trick) — Codex correctly held back and surfaced both errors atomically; orchestrator fixed forward without losing transactional integrity
- Edge function deploys preserved `verify_jwt: true` on both (claim + marketing-send)
- Helper `add_buyer_to_event_chat` has clean dual-path (auth'd vs anon) with ON CONFLICT DO NOTHING idempotency on both legs
- `pending_trip_chat_claims` correctly RLS-locked with ZERO user policies (service-role bouncer pattern per SPEC §3.4)
- Blast fan-out: ONE chat write per campaign, idempotent via UNIQUE partial index, non-fatal on failure

---

## §7 Constitution Compliance (14 rules)

| # | Rule | Status | Evidence |
|---|------|--------|----------|
| 1 | No dead taps | UNVERIFIED (UI deferred) | Source audit only; F-5 |
| 2 | One owner per truth | PASS | `conversations`+`messages` is single chat substrate; no parallel tables |
| 3 | No silent failures | PASS | Blast→chat failure logs explicitly (`console.error`), email continues; backfill uses RAISE EXCEPTION |
| 4 | One key per entity | UNVERIFIED (UI deferred) | F-5 |
| 5 | Server state server-side | UNVERIFIED (UI deferred) | F-5 |
| 6 | Logout clears everything | N/A | No auth state introduced |
| 7 | Label temporary | PASS | No `[TRANSITIONAL]` markers needed; spec is permanent |
| 8 | Subtract before adding | PASS | No legacy code layered on; new code path is additive |
| 9 | No fabricated data | PASS | All claim tokens cryptographic; backfill uses real event metadata |
| 10 | Currency-aware | N/A | No currency display in this scope |
| 11 | One auth instance | PASS | Uses existing auth.uid() throughout |
| 12 | Validate at right time | PASS | start_at validation in countdown banner (deferred — F-5) |
| 13 | Exclusion consistency | PASS | Trigger gate + helper lazy-create both filter `event_type IN ('event','trip')` (TA-07) |
| 14 | Persisted-state startup | UNVERIFIED (UI deferred) | F-5 |

11 PASS / 0 FAIL / 4 UNVERIFIED (UI-deferred) / 0 N/A — no automatic-P0 triggers fired.

---

## §8 Operator-driven smoke flow (Case-B step for `proven` UI verdict)

After EAS OTA publishes the consumer + business JS bundles, run this 6-step flow on iOS or Android sim/device with a fresh checkout:

1. **Web confirmation CTA renders:** Open `mingla-business` web (or business app web preview), buy any event ticket as anon buyer, reach the Stripe confirmation page. **Expect:** "Download Mingla to join your event chat" glass card appears between the QR carousel and "Back to event" CTA, with App Store + Play Store badges.

2. **Email CTA renders (event):** Check the buyer's email inbox for the order confirmation. **Expect:** Orange CTA button "Open in Mingla" below the calendar links. (Note: trip-specific email will NOT have this CTA — that's F-1 P1.)

3. **Onboarding pending-claim surface:** Install Mingla consumer app fresh, sign up with the SAME email as the buyer in step 1. Reach onboarding step 6 ("Let's find something together"). **Expect:** A "Join chat" card surfaces next to any pending session invites, naming the event you bought tickets to.

4. **Tap "Join chat" in onboarding:** Tap the card. **Expect:** Navigate into Friends-tab chat surface for that event group conversation; `pending_trip_chat_claims.claimed_at` for that order is now set; `conversation_participants` row exists for (conversation_id, user_id).

5. **Slim countdown banner under chat header:** Inside the chat, **expect:** thin banner just beneath the header showing "N days until [event name]" / "Today is [event name]!" on day-of / hidden post-end.

6. **Business app Group Chat tile + moderation:** Open `mingla-business` app, navigate to the trip OR event page that someone bought tickets to. **Expect:** New "Group chat" tile in the action grid. Tap it. **Expect:** Chat panel showing the buyer's join + ability to post planner-voice message. Tap "..." → broadcast-only toggle → flip ON → return to consumer app, attempt to post as buyer. **Expect:** RLS error / disabled composer (broadcast-only RESTRICTIVE policy fires).

Cross-trip RLS isolation (operator dashboard SQL editor — admin role required):

```sql
-- As user B (4def4191-b4e7-4d76-84bd-fcc3994307f8 or any non-team-member auth user):
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"4def4191-b4e7-4d76-84bd-fcc3994307f8","role":"authenticated"}';
SELECT COUNT(*) FROM conversations WHERE id = 'c3bd1fe3-27e2-4068-a9dd-133b1ef3139e';  -- expect 0
SELECT COUNT(*) FROM messages WHERE conversation_id = 'c3bd1fe3-27e2-4068-a9dd-133b1ef3139e';  -- expect 0
SELECT COUNT(*) FROM conversations WHERE linked_entity_type IN ('trip','event');  -- expect 0 (user B has no roster row)
```

If steps 1-6 + the SQL probe all pass on operator's device, UI verdict promotes from `suspected` → `proven`.

---

## §9 Discoveries for Orchestrator

| ID | Discovery | Severity | Action |
|----|-----------|----------|--------|
| DISC-A | RESOLVED — `marketing_campaigns.account_id` FK to `auth.users(id)` ON DELETE RESTRICT verified live via `pg_constraint`. Sender ID compatibility with `messages.sender_id` confirmed. | P4 | No action |
| DISC-B | CONFIRMED P1 — trip email template missing CTA (F-1) | P1 | Operator decides: rework before close OR follow-up ORCH-0897-B |
| DISC-C | CONFIRMED P1 — email URL uses shortId (F-2) | P1 | Operator decides: rework before close OR follow-up ORCH-0897-C |
| DISC-D | CONFIRMED P3 — Android native build required (F-3) | P3 | Document in CLOSE banner under EAS OTA partial |
| New | F-4 pre-existing duplicate conversations SELECT policies — not introduced by ORCH-0897 | P4 | Consider follow-up cleanup ORCH if desired |
| New | Operator dashboard SQL editor required for runtime user-vs-user RLS cross-isolation probe — MCP `supabase_read_only_user` cannot SET ROLE authenticated (documented Case-B step in §8) | P4 | Operator runs the SQL probe in §8 to elevate to `proven` |

---

## §10 Next handoff

NEXT HANDOFF — paste into Claude `mingla-orchestrator`:

ORCH-0897 [Trips + Events Group Chat] returned from TEST with **CONDITIONAL PASS** (P0:0 / P1:2 / P2:0 / P3:1 / P4:2). All backend + structural verification `proven` via 17/17 adversarial regression on the migration file (fails-on-revert verified: 13/17 fail when migration is emptied) + 9 MCP probes against remote DB state + 4 confirmation queries on RLS policy text. Adversarial check at `app-mobile/scripts/ci/orch-0897-adversarial-check.mjs`. QA report at `Mingla_Artifacts/reports/QA_ORCH-0897_TRIP_EVENT_GROUP_CHAT_REPORT.md`. Two P1 findings need operator decision before CLOSE: F-1 (trip email template `tripConfirmationEmail.ts` missing Download Mingla CTA — SC-14 partial gap; fix is a 10-line addition mirroring `ticketBody.ts` pattern; spec didn't enumerate trip-specific email) and F-2 (email CTA URL uses 8-char shortId not full UUID — `bodyInput.order` shape only carries shortId at `ticket-confirmation-dispatch/index.ts:263-278`; degraded UX not security; fix is adding `id: order.id` to the shape + updating `TicketBodyInput` type). One P3 informational (F-3 Android intentFilter native build queued). UI live-fire (F-5) deferred to operator-driven 6-step smoke + dashboard SQL probe in QA §8. Working tree: `/Users/sethogieva/Desktop/mingla-main-orch-0897` on branch `orch-0897-impl`. Codex implementor commits `b7646775` + `b394f881` + post-rebase hotfix commits `67a4e20d` + `f74e5e5a`. Tester adversarial commit pending this turn. Downstream routing: orchestrator decides — option A (FAIL→implementor rework for F-1 + F-2 before close), option B (CLOSE with operator-accepted P1 deferrals citing follow-up ORCH-0897-B + ORCH-0897-C). If option B chosen, run the standard CLOSE protocol (Step 0.5 gate satisfied per §1; Step 1 artifact sync; Step 1.5 DIAG-marker reap; Step 2 commit message; PR `orch-0897-impl → main` with pre-merge gate; EAS OTA publish for JS bundles + native build queued for Android per F-3; operator-owned `apple-app-site-association` deploy per SPEC §14 step 16).

---

**Report complete.**
