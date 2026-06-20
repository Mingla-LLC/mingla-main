# IMPLEMENT REPORT — ORCH-1163 · [rsvp-shared-body] · META-ORCH-1166 LEG 2

**Branch:** `ORCH-1163-rsvp-shared-body` (worktree, off main).
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1163_RSVP_SHARED_BODY.md` (binding, 466 lines).
**Status:** Built in a single pass against the binding spec. Migrations WRITTEN, NOT applied (orchestrator applies). Not deployed, not merged.

---

## 1. What was built (by spec section)

### §0 / §A — the ONE shared, shell-agnostic body
- **NEW `packages/offering-rendering/RsvpOfferingBody.tsx`** — the canonical RSVP page body, rendered byte-identically on buyer-web + business iOS/Android + consumer iOS/Android. Renders the canonical order: (2) name → (3) **full-width solid-fill date row** (`orch-1167-date-row` parity, doors merged into the band) → (4) **solid-fill pills row** (format · ALL vibes · ALL party-types · ALL music-genres, **NO tickets-left**; party chips PROMOTED here, the body passes `partyTypes={[]}` to the momentum unit) → (5) **inline Going/Maybe/Not-going box** (contact form + per-guest mini-forms + the shared `RsvpMomentumDecision`) → (6) Presented By → (7) About toggle → (8) Where-you'll-be static map (city-level when hidden). Hosts **NO scroll root and NO `ParallaxCoverShell`** (shell-agnostic). Exports `RsvpOfferingDecisionDock` (section 9, surface-pinned) + `useRsvpOfferingState` (the surface lifts the ONE state machine and feeds BOTH the inline box and the dock — no duplicate writes).
- **NEW `RsvpGoingConfirmDialog.tsx` + `RsvpSuccessPopup.tsx`** — FLOW A. Package-isolated (RN `<Modal>` + `ThemePalette` only; NO `designSystem`/app-src import). Exported `RsvpConfirmationDetails` type.
- **`RsvpMomentumDecision.tsx`** — extended (append-only) with `hideStepper` so the body owns the per-guest mini-forms instead of the bare-integer stepper. Single owner preserved; `resolveRsvpCta` still drives `ctaState`.
- Barrel (`index.ts`) exports all of the above.

### §B — per-surface wiring
- **buyer-web + business native:** NEW `mingla-business/src/components/event/FoundationRsvpPreview.tsx` (thin wrapper, mirrors `FoundationEventPreview`) composes `ParallaxCoverShell` (RN ScrollView host) around `RsvpOfferingBody` + pins the dock on phone / passes it to the sticky panel on desktop. `PublicEventPage.tsx` RSVP branch repointed to it; `mingla-business/app/rsvp/[id]/preview.tsx` repointed too. **`RsvpPublicBody.tsx` DELETED.**
- **consumer:** `ConsumerEventDetailScreen.tsx` RSVP branch rewired — the bespoke `rsvpDock`/`rsvpMomentumUnit`/RSVP-branch `brandNode`/`aboutNode`/`venueNode`/address-privacy block DELETED; now lifts `useRsvpOfferingState` + mounts `<RsvpOfferingBody>` inside the existing gorhom `BottomSheetScrollView` and pins `<RsvpOfferingDecisionDock>` as the bottom overlay. **The standard-event `EventOfferingBody` branch is byte-untouched.**

### §C — the ONE read path
- **NEW migration `20261016000000_orch_1163_pg_public_rsvp_by_slug.sql`** — anon RPC restricted to `event_type='rsvp'`, returns the RSVP host-control block (`rsvpGoingCount`=SUM(1+plus_count) over going+approved / `rsvpCapacity` / `rsvpAllowPlusOnes` / `rsvpPlusOnesMax` / `rsvpWaitlistEnabled` / `rsvpApprovalMode`), NO tickets aggregate. **Server-side privacy:** omits `address` + `location_geo` and returns `city_geo` only when hidden. SECURITY DEFINER, STABLE, `$function$` before GRANT, DROP-before-CREATE, GRANT anon/authenticated, NOTIFY pgrst.
- **NEW `app-mobile/src/hooks/usePublicRsvpBySlug.ts`** — maps the json → `{event, brand, config}`; reads the SAME RPC; package-isolated.

### §H / §I / §J — per-guest contacts, passes, notify, matched-guest calendar
- **NEW migration `20261016000001_orch_1163_event_rsvp_guests.sql`** (all §H/§I/§J SQL folded in): child table `event_rsvp_guests(name/email/phone NOT NULL+CHECK, qr_token_hash, qr_code, matched_user_id, FK CASCADE)` + RLS (host-read via event_manager, owner-read OR `matched_user_id=auth.uid()`, GRANT service_role only); `event_rsvps.qr_token_hash/qr_code`; redefined `submit_event_rsvp` (DROP old 7-arg → new 9-arg with `p_guests jsonb` + `p_qr_token_pepper`; delete-then-insert guests; RAISE `rsvp_guest_count_mismatch`/`rsvp_guest_contact_required`; mint primary + per-guest signed `mingla:v1:rsvp:` tokens ONLY for going via the shared pepper helpers; resolve `matched_user_id`; capacity math SUM(1+plus_count) UNCHANGED); `biz_rsvp_qr_payload` (sibling of `biz_ticket_checkout_qr_payload`, reuses the pepper helper); `biz_resolve_verified_user` (VERIFIED `auth.identities` email + `phone_confirmed_at` phone, **NEVER user_metadata**); `fetch_user_going_rsvps` (UNION of primary + matched-guest rows, role discriminator).
- **edge fns:** `public-submit-rsvp` accepts `guests`, validates (count + per-guest email/phone), sources the pepper via `qrTokenPepper()`, passes `p_guests`/`p_qr_token_pepper`, returns `rsvpId`/`confirmationToken`, and after a GOING submit enqueues one `rsvp_notifications` row per recipient (`idempotency_key=rsvp_pass:<rsvpId>:<guestId|primary>`) + invokes `rsvp-notify` (wrapped so notify failure never fails the committed write). `rsvp-notify` gained an `rsvp_pass` branch that emails each recipient their own QR as a **PDF attachment** (new thin `buildRsvpPassPdf` in `_shared/ticketPdf.ts`, reuses `qrPayloadAsPngBytes` + `sendResendEmailWithAttachment` + `EMAIL_SENDERS.tickets`) and PUSHes (existing `sendPush({app:"consumer"})` + `public.notifications` inbox mirror) ONLY the matched guests + signed-in primary. **No new email/OneSignal/matcher client.**
- **services:** `submitPublicRsvp` (+guests/+rsvpId/+confirmationToken), `submitDeckRsvp` (+guests/+rsvpId/+confirmationToken).
- **consumer Calendar (FLOW C / §J.6):** `calendarService.fetchUserGoingRsvps` (calls `fetch_user_going_rsvps`, returns `ConsumerRsvpRow`), `useMyGoingRsvps` + `useRsvpsRealtimeSubscription` hooks, NEW `RsvpCalendarRow.tsx` + `RsvpPassSheet.tsx` (QR via `react-native-qrcode-svg`, change/cancel = soft `not_going`; guest-role cards hide the cancel-all CTA), `CalendarTab.tsx` `kind:"rsvp"` UnifiedRow sort-merged into Active/Archive.

---

## 2. Files changed / created

**Package (`packages/offering-rendering/`):** NEW `RsvpOfferingBody.tsx`, `RsvpGoingConfirmDialog.tsx`, `RsvpSuccessPopup.tsx`, `__tests__/orch_1163_rsvp_shared_body.test.ts`; MOD `RsvpMomentumDecision.tsx` (hideStepper), `index.ts` (barrel).
**Read path:** NEW `app-mobile/src/hooks/usePublicRsvpBySlug.ts`; NEW migration `…_orch_1163_pg_public_rsvp_by_slug.sql`.
**Write/notify path:** NEW migration `…_orch_1163_event_rsvp_guests.sql`; MOD `supabase/functions/public-submit-rsvp/index.ts`, `supabase/functions/rsvp-notify/index.ts`, `supabase/functions/_shared/ticketPdf.ts`, `mingla-business/src/services/rsvpEvents.ts`, `app-mobile/src/services/rsvpDeckService.ts`.
**Surface wiring:** NEW `mingla-business/src/components/event/FoundationRsvpPreview.tsx`; MOD `mingla-business/src/components/event/PublicEventPage.tsx`, `mingla-business/app/rsvp/[id]/preview.tsx`; DELETE `mingla-business/src/components/event/RsvpPublicBody.tsx`; MOD `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`.
**Calendar:** MOD `calendarService.ts`, `useCalendarEntries.ts`, `CalendarTab.tsx`; NEW `RsvpCalendarRow.tsx`, `RsvpPassSheet.tsx`.
**Gates (7 DRAFT):** NEW `app-mobile/scripts/ci/orch-1163-rsvp-{one-shared-body,shell-agnostic,one-read-path,going-confirm,plus-one-per-guest,going-calendar-qr,guest-notify-match}-check.mjs` + `app-mobile/package.json` script entries.
**Tests:** NEW `packages/offering-rendering/__tests__/orch_1163_rsvp_shared_body.test.ts`, `supabase/migrations/__tests__/orch_1163_rsvp.test.sql`; RETARGETED (`[TEST-MOD-APPROVED ORCH-1163]`) the ORCH-1157/1150/1159 RSVP tests that read the now-deleted `RsvpPublicBody.tsx` / old consumer RSVP-branch.

---

## 3. Migrations (WRITTEN, NOT APPLIED — orchestrator applies via Management API)

1. `supabase/migrations/20261016000000_orch_1163_pg_public_rsvp_by_slug.sql` — the anon read RPC.
2. `supabase/migrations/20261016000001_orch_1163_event_rsvp_guests.sql` — child table + primary/per-guest passes + `matched_user_id` + redefined `submit_event_rsvp` + `biz_rsvp_qr_payload` + `biz_resolve_verified_user` + `fetch_user_going_rsvps` + RLS.

Both follow the safe-migration protocol (additive/idempotent, `$function$` before GRANT, DROP-before-widen, SECURITY DEFINER + search_path + GRANT + NOTIFY pgrst). The QR pepper env (`qrTokenPepper()`), OneSignal env, and Resend env are already set (no new secrets).

---

## 4. Verification results

- **7 DRAFT CI gates:** ALL PASS (54 checks total), each proven fails-on-revert by the gate-authoring pass.
- **New package contract test** `orch_1163_rsvp_shared_body.test.ts`: 8 passed / 0 failed.
- **Retargeted package + business + consumer tests:** offering-rendering RSVP suite 55 passed / 0 failed; business jest (maybeCta + parallaxLayering + preview) 22 passed / 0 failed; consumer (rsvp_consumer + rsvpDeckService) 8 passed / 0 failed.
- **Edge fns:** `deno check public-submit-rsvp + rsvp-notify` clean.
- **Typecheck:** business-owned files (FoundationRsvpPreview/PublicEventPage/rsvpEvents/preview) tsc-clean; consumer/calendar files tsc-clean; package files carry ONLY the universal `Cannot find module 'react'`/jsx-runtime tsconfig-scope noise that ALL package files (EventOfferingBody/RsvpMomentumDecision) share — no NEW real errors (the one real error, `event.city` not on `PublicEventProps`, was fixed).
- **Fails-on-revert (live proof):** injecting a `ParallaxCoverShell` import into `RsvpOfferingBody.tsx` FAILED both `orch-1163-rsvp-shell-agnostic-check.mjs` (exit 1) AND the package test; restoring returned both to green (gate exit 0). See §6 for the hash.

---

## 5. Scope-flags / partials (honest)

1. **Web/business public-page READ still feeds RSVP config from the loaded `LiveEvent`** (which `business_public_events_view` populates from the same `events.rsvp_*` columns), NOT from the new `pg_public_rsvp_by_slug` RPC directly. The RPC exists as the canonical single owner and the **consumer cold-path reads it** (`usePublicRsvpBySlug`). Rewiring the web route's data load to the RPC is a larger refactor with regression risk on the existing `/e/[brandSlug]/[eventSlug]` route; left as a documented follow-up. The config values are identical (same source columns).
2. **Consumer RSVP doors line:** the consumer `rsvpConfig` does not yet populate `doorsOpenLabel`/`doorsCloseLabel` (the consumer deck seed doesn't reliably carry master start/end), so the consumer RSVP doors line won't render. Business/web feeds doors correctly via `PublicEventPage → rsvpDoors`. Minor parity gap; flagged.
3. **FOLLOW-ONS (per spec §F/§I.5/§J.2, NOT this PR):** host-side RSVP scanning/check-in (`ORCH-XXXX rsvp-host-checkin` — tokens minted in the correct signed format NOW so it's drop-in), back-match of a later-joining guest (`ORCH-XXXX rsvp-guest-backmatch`), per-guest self-decline from a guest-role Calendar card. Orchestrator to register.
4. **WebKit cover-autoplay** (if a video-cover RSVP exists) is NOT locally verifiable — the orchestrator verifies on a real Vercel deploy (DEC-189 lesson). The imperative-DOM video path is preserved (cover flows through `EventCoverMedia` via `ParallaxCoverShell`/pinned cover; no React-rendered `<video>` introduced).

---

## 6. DRAFT invariants registered (flip ACTIVE at CLOSE)

All 7 `I-PROPOSED-1163-*` from spec §E are enforced by the 7 gates: RSVP-ONE-SHARED-BODY, RSVP-SHELL-AGNOSTIC, RSVP-ONE-READ-PATH, RSVP-COVER-IMPERATIVE-VIDEO (via the existing ORCH-0978 web-video gate + imperative path preserved), RSVP-CANONICAL-9-SECTION-ORDER (the package test), RSVP-GOING-CONFIRM-MAYBE-DIRECT, RSVP-PLUS-ONE-PER-GUEST-CONTACT, RSVP-GOING-CALENDAR-QR, RSVP-PLUS-ONE-PER-GUEST-PASS, RSVP-GUEST-NOTIFY-EMAIL-PUSH, RSVP-MATCHED-GUEST-CALENDAR.
