# INVESTIGATION — META-ORCH-1337 [social-proof-guest-list]

**Phase:** INVESTIGATE (feature-gap forensics; NO fixes proposed)
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list` (rebased onto origin/main 2026-07-10)
**Date:** 2026-07-10
**Confidence:** **proven** for every gap/mount/schema/guard fact (static absence + presence of code is provable by reading; live prod-DB probes done read-only). Sim live-fire exempt per dispatch (feature-gap, not a reproducer-bound bug); one dispatch premise was REFUTED by code (Q9/F-9).
**Comms:** COMMS-0087 read (RESOLVED — CI TS pin, no action); COMMS-0084 read+factored (OPEN/WARN — BaseBottomSheet overlay slot + sheet-bug history, binding on Q7); COMMS-0083 read+factored (OPEN/WARN — AppsFlyer MCP + 1313 P1 go-live gates, binding on Q9); COMMS-0088 is this META's own entry. Acks recorded here for the orchestrator (sub-agent is bound to one report commit; direct-to-main ledger writes left to the orchestrator per `feedback_comms_ledger_direct_main_commits_fragile`).

---

## Mission summary (expected vs actual)

Seth ordered a full build: the RSVP "momentum" card must extend to trips/experiences/standard events on all public surfaces; the dark `privateGuestList`/`hideRemainingCount` host toggles must actually gate publicly and be added to trip+experience wizards; the faceless cluster gets REAL avatars for Mingla-user guests (overturning I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY); a NEW consumer guest-list sheet (tap cluster / "See who's going") with add-friend + message actions; buyer-web same tap → device-aware store link + QR + deferred deep link into that event's guest-list sheet post-install.

**Actual today (all proven below):** card renders ONLY on RSVP surfaces, is pure-presentational with a zero-onPress glyph cluster; both toggles are written by two wizards + edit paths and persisted server-side, but NOTHING public reads them (one live prod event already has `privateGuestList=true` stored and silently ignored); trips/experiences have no toggle UI and hard-code `false`; no peer-visible guest identity read path exists at any layer; the consumer OneLink deferred-deep-link rail EXISTS (ORCH-1318 — dispatch premise "both AF listeners false" is stale) but has no guest-list-sheet landing, no buyer-web link source, and is native-build-gated.

---

## Investigation manifest (files read, in trace order)

| # | File | Layer | Why |
|---|---|---|---|
| 1 | `.claude/skills/mingla-forensics/SKILL.md` + `COMMS_LEDGER.md` (anchor) | docs | Mode + comms gate |
| 2 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (~line 670-720) | docs | Exact anon-only invariant text + siblings |
| 3 | `Mingla_Artifacts/WORLD_MAP.md` (META-1337 rows) | docs | Dispatch premise + reserved children |
| 4 | `~/Desktop/mingla-orchs/1334-[rsvp-guest-identity]/…/INVESTIGATION_ORCH-1334_RSVP_GUEST_CONSOLE_IDENTITY.md` (full, read-only) | docs | Sealed profiles-RLS/identity findings + RPC pattern + scope |
| 5 | `packages/offering-rendering/RsvpMomentumDecision.tsx` (all 744 lines) | code | The card: props, cluster, onPress surface |
| 6 | `packages/offering-rendering/rsvpMomentum.ts` (all) | code | Honest derivation owner |
| 7 | `packages/offering-rendering/RsvpOfferingBody.tsx` (header + DecisionUnit/Box/FloatingBar regions) | code | The two card mounts |
| 8 | `mingla-business/src/components/event/PublicEventPage.tsx` (:575-910 + branch greps) | code | Buyer-web RSVP/ticketed branch + config source |
| 9 | `mingla-business/src/components/event/FoundationRsvpPreview.tsx` (composition greps) | code | Shell wrapper |
| 10 | `mingla-business/app/rsvp/[id]/preview.tsx` | code | Business preview mount (goingCount:0) |
| 11 | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (:225-300, mount greps) | code | Consumer RSVP branch + seed dependency |
| 12 | `app-mobile/app/e/[brandSlug]/[eventSlug].tsx` (all) | code | Cold universal-link route |
| 13 | Trip/Experience: `TripOfferingBody`/`ExperienceOfferingBody`/`EventOfferingBody` greps; `app/t|exp` routes (biz + consumer); `TripPreview`/`ExperiencePreview` | code | Prove no momentum + insertion map |
| 14 | Toggle sweep: `CreatorStep6Settings.tsx`, `RsvpStep5Setup.tsx`, `EditPublishedScreen.tsx`, `serverDraftEventMapper.ts`, `liveEventAdapter.ts`, `draftEventStore.ts`, `liveEventStore.ts`, `businessEvents.ts`, `publicEventsService.ts`, `tripToLiveEvent.ts`, `useExperienceDraftAdapter.ts` | code | Q3 write/read audit |
| 15 | Migrations: `20261113/20261114_orch_1172*`, `20261222_orch_1296` (toggle persist); `20261004_orch_1150_rsvp_events` (:100-180 RLS), `20261016_orch_1163_event_rsvp_guests` (:82-94), `20261220_orch_1291` (:630-730 view), `20261206_orch_1273` (:157), `20261015_orch_1167*`, `20260724_orch_0946`, `20260803_orch_1016_pg_published_trips_public`, `20261017_meta_orch_1174_pg_public_trip_by_slug`, `20261115_orch_1183_pg_public_experience_by_slug`, baseline `20260505` (orders :8525-8547, tickets :9862-9885, profiles :9105-9120, policies :14076/14200/14204/14318) | schema | Q2/Q4/Q6 |
| 16 | `app-mobile/src/services/{connectionsService,friendsService,blockService,messagingService,deepLinkService,appsFlyerService,oneLinkResolver}.ts`; `hooks/useFriends.ts`; `components/{connections/*,friends/*,profile/ViewFriendProfileScreen,profile/AccountSettings}`; `services/enhancedProfileService.ts` | code | Q5/Q8/Q9 |
| 17 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` (:1-260 + regression-comment greps); `MessageInterface.tsx` (:2190-2260 EventAudienceSheet) | code | Q7 |
| 18 | `app-mobile/app/index.tsx` (:363-400, :840-940 sink + deferred replay); `app-mobile/app.json` (scheme/applinks) | code | Q9 |
| 19 | `mingla-marketing/lib/store-links.ts`; `mingla-business/src/components/checkout/DownloadMinglaCta.tsx`; `accept-brand-invitation/success.tsx` | code | Q9 web precedents |
| 20 | Guards: `packages/offering-rendering/__tests__/orch_1157_*` (momentum + adversarial, verbatim assertion blocks), `orch_1163_*`; `.github/workflows/{strict-grep-mingla-business,tests-append-only}.yml`; `.github/scripts/strict-grep/` listing | test/CI | Q10 |
| 21 | LIVE prod DB `gqnoajqerqhnvulmnyvv` (Management API, 3 read-only queries) | data | Q12 |
| 22 | `ls ~/Desktop/mingla-orchs/*/supabase/migrations` (all 15 worktrees) | schema | Q6 collision scan |

---

## Q-scorecard

- **Q1 — Card mount map?** ONE shared mount chain; RSVP-only; admin-web has zero mounts; parity is automatic via the shared package. **Verdict: proven** (F-1, F-2).
- **Q2 — "Going" data per entity?** RSVP = `event_rsvps` SUM(1+plus_count) going+approved, anon-exposed; standard/trip/experience = `tickets` COUNT (status valid/used/transferred), anon-exposed only as REMAINING per tier — absolute sold count is NOT anon-readable when capacity is unlimited. **Verdict: proven, with a named backend gap** (F-3).
- **Q3 — Toggle audit?** Written by 2 wizards + edit paths, persisted under `events.theme.business_event.settings`, parsed by business services, rendered/gated NOWHERE public; trips/experiences hard-code false with no toggle UI; trip has a wizard settings home, experience has NONE. **Verdict: proven dark** (F-4, F-5).
- **Q4 — Identity + avatar source?** `profiles.{display_name,username,avatar_url,…}` effectively world-readable (1334-sealed, policy lines re-verified); linkage: RSVP `user_id` (3/4 live), plus-ones `matched_user_id` (0 live), orders `buyer_user_id` (1/2 live), tickets carry NO user column. Avatar fill 9/61 (15%). **Verdict: proven** (F-6).
- **Q5 — Privacy model?** `visibility_mode` (public/friends/private, default friends; NOT RLS-enforced for reads) + 4 `show_*` booleans + blocking + friend-gated Message CTA. NO who-can-message / who-can-friend-request / per-event guest-list opt-out. **Verdict: proven; SPEC must define the public-identity default** (F-7).
- **Q6 — Peer-read path?** Peers/anon can read aggregates only; identity is walled by RLS (host/self/matched). ORCH-1334 pattern extracted (DEFINER + guard-first + whitelisted columns); its scope = `host_list_rsvp_guests` rewrite (+ `admin_list_event_rsvps`, `fetch_user_going_rsvps` twins flagged) — no collision with a NEW peer RPC. Migration frontier across ALL worktrees = `20261223000000`. **Verdict: proven** (F-8).
- **Q7 — Sheet infra?** BaseBottomSheet contract + ORCH-1315 overlay slot + EventAudienceSheet exemplar + 9 regression classes enumerated with mechanisms. **Verdict: proven** (F-10 context; §Sheet infra).
- **Q8 — Add-friend + message plumbing?** `useFriends().addFriend()` → `friend_requests` insert + `accept_friend_request_atomic`; `messagingService.ensureConversation()` → `get_or_create_direct_conversation` RPC (block-checked) + `sendFirstMessage()`. Message CTA is friends-only today (ORCH-0993). **Verdict: proven** (F-7, §Q8 detail).
- **Q9 — Deep-link + install funnel?** Dispatch premise REFUTED: ORCH-1318 already shipped consumer OneLink deferred deep-linking (listeners TRUE, entity payload contract incl. event/trip/experience, deferred replay via `router.push`). Remaining gaps: no sheet-landing param, seedless cold-route degradation, no buyer-web link/QR source, native-build + S2S go-live gates. **Verdict: proven (premise-correcting)** (F-9).
- **Q10 — Guard inventory?** 1 test block + 1 invariant + 1 component doc-contract must be REWRITTEN (with the tests-append-only override token); ~12 guards must stay INTACT and bind the new code (list below). The anon-only invariant BUNDLES the address-privacy rule — the rewrite must preserve that half. **Verdict: proven** (F-10).
- **Q11 — Buyer-web body insertion map?** Per-entity route → preview wrapper → shared body table below; inserting the momentum unit inside the shared bodies yields automatic 5-surface parity; per-surface work is config plumbing only. **Verdict: proven** (F-2, §Q11 map).
- **Q12 — Data reality?** Live prod census completed read-only (3 queries). 9 live events (3 event / 4 rsvp / 2 trip / 0 experience); RSVP user-linkage 75%; order buyer-linkage 50%; avatar fill 15%; `privateGuestList=true` already stored on 1 live event; friends graph real (15 requests / 30 friendship rows); `event_rsvp_guests` empty. **Verdict: proven** (F-11).

---

## Findings (six-field evidence)

### F-1 — The momentum card is RSVP-only, pure-presentational, glyph-only, with a zero-onPress cluster · `CONFIRMED FEATURE GAP (cold-proof verified)`
- **Symptom:** No social proof on trips/experiences/standard events; the "N going" cluster is not tappable anywhere.
- **Layer:** code.
- **Probe:** full read of `packages/offering-rendering/RsvpMomentumDecision.tsx` + `rsvpMomentum.ts`; `grep -rn "Momentum|cluster|goingCount" EventOfferingBody.tsx TripOfferingBody.tsx ExperienceOfferingBody.tsx` → zero hits; `grep -rln RsvpMomentumDecision` repo-wide.
- **Evidence:** cluster block `RsvpMomentumDecision.tsx:380-418` is a plain `<View style={styles.cluster}>` mapping `momentum.shownAvatars` `PersonGlyph` disks (`:158-168` SVG circle+path) — no `Pressable`, no `onPress`, no `<Image>`, no `uri`. Props interface `:85-153` carries NO name/photo/guest field (doc-contract `:21-27`: "cluster avatars are GLYPH-only … never an `<Image>`/uri"). `RSVP_CLUSTER_SHOWN = 3` + overflow chip `+N` (`rsvpMomentum.ts:14,52-54`). Decision buttons DO have onPress (`:427-500`) — only the momentum unit is inert. The three non-RSVP bodies have zero momentum code.
- **Mechanism:** the component was contract-built under I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY; nothing was ever wired for identity or tap; the other entity bodies never mounted it.
- **Severity:** `CONFIRMED` feature gap (matches the pre-investigation cold proof; cited, not re-derived).

### F-2 — Mount map: ONE shared mount chain; parity automatic; admin-web excluded · `CONFIRMED (mount map)`
- **Symptom:** n/a (map).
- **Layer:** code.
- **Probe:** import greps + reads of `RsvpOfferingBody.tsx:995-1110`, `PublicEventPage.tsx:598,798-869`, `ConsumerEventDetailScreen.tsx:80-81,246,901-991`, `app/rsvp/[id]/preview.tsx:360-367`, `FoundationRsvpPreview.tsx:32-35`; `grep -rn offering-rendering mingla-admin/src` → empty.
- **Evidence (the map):**
  - `RsvpMomentumDecision` is mounted ONLY by `RsvpOfferingBody.tsx`'s internal `DecisionUnit` (`:995`, always `variant="floating-dock"`), consumed twice: `RsvpDecisionBox` (`:1057-1064`, `showMomentum=true`, testID `orch-1157-rsvp-inline-momentum`) and `RsvpOfferingFloatingBar` (`:1098-1109`, `showMomentum=false` — decision only).
  - **Consumer iOS/Android:** `ConsumerEventDetailScreen` RSVP branch (`isRsvp = seed?.eventType === "rsvp"` `:246`) mounts shared `RsvpOfferingBody` `:931` + pins `RsvpOfferingFloatingBar` `:976`. `goingCount` from `fetchRsvpMomentum(eventId)` → `business_public_events_view` (`rsvpDeckService.ts:66,74`) + `usePublicRsvpBySlug` → RPC `pg_public_rsvp_by_slug`.
  - **Buyer-web AND business iOS/Android (same code):** `PublicEventPage.tsx:798` `isRsvp` branch → `FoundationRsvpPreview` (`:816-869`) with `config.goingCount = event.rsvpGoingCount ?? 0` (`:823`, from `business_public_events_view.rsvp_going_count`, `publicEventsService.ts:1096`). `FoundationRsvpPreview` composes `ParallaxCoverShell` + `RsvpOfferingBody` + desktop-sticky `RsvpDecisionBox` + `RsvpOfferingFloatingBar`.
  - **Business preview (native + web):** `app/rsvp/[id]/preview.tsx:360` → `FoundationRsvpPreview` with honest `goingCount: 0` (`:367`).
  - **Admin-web:** NO mount (zero `offering-rendering` imports in `mingla-admin/src`).
- **Mechanism:** all five app surfaces render the ONE package component → any card change is automatic parity; only the per-surface CONFIG (counts, toggles) is manual plumbing.
- **Severity:** supporting map (drives the child split).

### F-3 — "Going" data per entity + a real anon sold-count gap for ticketed entities · `CONFIRMED (data contract) + SECONDARY GAP`
- **Symptom:** the card needs an honest `goingCount` per entity; ticketed entities cannot supply one anonymously in all cases.
- **Layer:** schema.
- **Probe:** read latest defs: `20261220_orch_1291_rsvp_contributions.sql:630-730` (recreates `business_public_events_view`); `20260724_orch_0946_public_ticket_types_remaining.sql:44,55`; `20260803_orch_1016_pg_published_trips_public.sql:100-153`; `20261017_meta_orch_1174_pg_public_trip_by_slug.sql:112-126`; `20261115_orch_1183_pg_public_experience_by_slug.sql:139-153,228-242`.
- **Evidence:**
  - **RSVP:** `rsvp_going_count = (SELECT COALESCE(SUM(1 + r.plus_count),0) FROM event_rsvps r WHERE r.event_id=e.id AND r.rsvp_status='going' AND r.approval_status='approved')` (view `:706-712`) — an ABSOLUTE headcount, anon-readable via the view AND `pg_public_rsvp_by_slug` (`20261206_orch_1273:157`). Capacity = `events.rsvp_capacity`.
  - **Standard/trip/experience:** all three are `events` rows with `ticket_types`+`tickets`; sold formula everywhere = `COUNT(tickets WHERE status IN ('valid','used','transferred'))` (ORCH-0946 `:44`; comment `:55` "matches biz_ticket_checkout_create_session"). BUT the anon by-slug RPCs expose per-tier **remaining** = `GREATEST(quantity_total - sold, 0)` and return NULL for unlimited tiers — the absolute sold count is derivable only when capacity is finite (`sold = capacity - remaining`). `pg_published_trips_public` DOES return `tickets_sold` (`:47,110-111`) but is the trips LIST RPC, not the detail path, and nothing equivalent exists for standard events/experiences.
  - Honest semantics per entity: RSVP "going" = confirmed guests incl. plus-ones; ticketed "going" = issued live tickets (seats, not orders — party size is tickets-per-order).
- **Mechanism:** the momentum card needs `goingCount + capacity`; RSVP has both anon-side; ticketed entities have capacity-relative data only → a uniform anon-safe count read (aggregate-only) is NEW backend work for the card cross-entity.
- **Severity:** `SECONDARY GAP` — the one genuine backend prerequisite for leg 1339's counts (besides identity for 1340/1341).

### F-4 — Both host toggles are written+persisted but read by NOTHING public; a real host is already relying on one · `CONFIRMED FEATURE GAP (user-impacting)`
- **Symptom:** hosts toggle "Private guest list"/"Hide remaining count" and the public page ignores them.
- **Layer:** code + schema + data.
- **Probe:** repo-wide grep `privateGuestList|private_guest_list|hideRemainingCount|hide_remaining_count` (all extensions, node_modules excluded); read of the 1172 migration chain; prod query.
- **Evidence:**
  - **Storage shape:** NOT DB columns — `events.theme -> business_event.settings.{privateGuestList,hideRemainingCount}` (booleans), stated verbatim in `20261113_orch_1172_rsvp_edit_privacy_settings.sql:4-8` and persisted by the edit RPC chain `20261113` → `20261114_orch_1172_r2` (`:155-161,204-205`) → LATEST `20261222_orch_1296_rsvp_edit_chip_in.sql:229-247` (COALESCE(payload → existing theme → default) + `jsonb_set`). Create-publish persists via the wizard payload (`serverDraftEventMapper.ts:470-471`; hydration `:803-805` `asBoolean(..., false)`).
  - **Write sites (all four entity wizards):** standard `CreatorStep6Settings.tsx:137,155` (both ToggleRows); RSVP `RsvpStep5Setup.tsx:318,327`; edit `EditPublishedScreen.tsx:1386-1402` + diff builders `liveEventAdapter.ts:344-354` / `buildRsvpUpdatePayload` (ORCH-1172 no-clobber tests pin this). **Trips:** `tripToLiveEvent.ts:132-134` hard-codes `false` — no toggle in `TripCreatorStep1Basics…Step6Intake`. **Experiences:** `useExperienceDraftAdapter.ts:116-119` hard-codes `false` — wizard is only `ExperienceCoverStep/ExperienceStopsStep/ExperiencePricingStep`, NO settings step exists.
  - **Read sites:** business hydration only — `businessEvents.ts:472,484`, `publicEventsService.ts:1062,1067` (parse into the LiveEvent model), plus dirty-check/test utils. ZERO renders/gates: no component in `packages/offering-rendering`, `mingla-business` public pages, or the ENTIRE `app-mobile` reads either flag (grep: app-mobile has zero hits).
  - **Data:** prod: `events with theme#>>'{business_event,settings,privateGuestList}'='true'` → **1** (of 9 live events); `hideRemainingCount=true` → 0.
- **Mechanism:** the setting round-trips wizard↔DB↔business-app faithfully (ORCH-1172 fixed the edit clobber) but no public read path was ever built → a live host's privacy expectation is silently unmet.
- **Severity:** `CONFIRMED` gap; the stored-true event makes gating these flags load-bearing on day one of leg 1339.

### F-5 — Wizard homes for net-new trip/experience toggles · `SUPPORTING (scope map)`
- **Layer:** code.
- **Probe:** `ls mingla-business/src/components/trip|experience` + reads of step lists.
- **Evidence:** Trip create = 6 steps; the settings-like home is `TripCreatorStep5Policy.tsx`; trip EDIT has `EditPublishedTripSettingsAccordion.tsx` (natural edit home). Experience create = 3 steps (Cover/Stops/Pricing) — no settings step; experience edit flows through the live-edit adapters (`useExperienceDraftAdapter`). The reusable control is the exact ToggleRow pattern of `CreatorStep6Settings.tsx:137-157`.
- **Severity:** supporting — leg 1339 needs a placement decision for experiences (flagged in Open Questions).

### F-6 — Identity linkage + avatar source per entity · `CONFIRMED (capability map)`
- **Symptom:** n/a (capability).
- **Layer:** schema + data (+ ORCH-1334 sealed findings, cited not re-proven).
- **Probe:** baseline `20260505` reads (orders `:8525-8547`, tickets `:9862-9885`, profiles `:9105-9120`); ORCH-1334 F-4/F-5 (sealed, live-proven); prod census (F-11).
- **Evidence:**
  - **profiles columns for display:** `display_name, username, avatar_url, first_name, last_name, photos text[], bio` (+ `visibility_mode` CHECK public/friends/private, default `'friends'`, baseline `:9105,9120`). NO full_name/handle/photo_url (1334 F-4).
  - **profiles RLS:** six permissive SELECT policies, broadest `"Profiles viewable except by blocked users"` = `(auth.uid()=id) OR (NOT is_blocked_by(id, auth.uid()))`, `roles={public}` → **effectively world-readable including anon**; `visibility_mode` NOT enforced for reads (1334 F-5, LIVE RLS sim, sealed; policy text re-verified at baseline `:14076/:14318`).
  - **RSVP linkage:** `event_rsvps.user_id → auth.users(id) = profiles.id` (1334 F-4); live 3/4 rows linked. Web plus-ones: `event_rsvp_guests.matched_user_id` (live 0 rows).
  - **Ticketed linkage:** `orders.buyer_user_id uuid` NULLABLE (anon checkout → NULL; live 1/2 linked) + typed `buyer_name/email/phone`; **`tickets` has NO user column** — per-seat `attendee_name/email/phone` text only. So "is a Mingla user + avatar" is answerable ONLY for the order BUYER, never per seat. Trips/experiences ride the same orders/tickets tables.
  - **Avatar reality:** 9/61 profiles have `avatar_url` (15%) → any real-avatar cluster MUST keep the glyph as the per-guest fallback, not just the anonymous mode.
- **Severity:** supporting capability map (binds 1338's payload design).

### F-7 — Privacy model today: visibility_mode + granular show_* + blocking + friend-gated messaging; nothing guest-list-specific · `CONFIRMED (must be flagged to SPEC)`
- **Symptom:** the SPEC needs a defined default for "who appears with a real face".
- **Layer:** code + schema + data.
- **Probe:** reads of `AccountSettings.tsx:115,418`, `enhancedProfileService.ts:398-408`, `blockService.ts`, `useFriends.ts:57-257`, `ViewFriendProfileScreen.tsx:708-718`, `messagingService.ts:582-604`; prod visibility census.
- **Evidence:**
  - Settable today: `profiles.visibility_mode` (public/friends/private — AccountSettings `updateField("visibility_mode", nextMode)` `:418`); `updateProfilePrivacy({visibility_mode, show_activity, show_saved_experiences, show_location, show_preferences})` (`enhancedProfileService.ts:399-406`); blocking (blockService; `is_blocked_by` in RLS; `hasBlockBetween` in messaging).
  - Messaging is FRIEND-GATED at the UI layer: the profile Message CTA renders only when `profile.isFriend` (`ViewFriendProfileScreen.tsx:712` — "ORCH-0993 … friend-only Message gate structurally intact"); `ensureConversation` additionally block-checks (`messagingService.ts:588-589`).
  - Friend-request visibility primitive exists: RPC `resolve_user_visibility_by_identifier` → `{user_exists, is_blocked, can_view, profile_id, …}` (`useFriends.ts:113-124`).
  - Does NOT exist: who-can-message setting, who-can-friend-request setting, per-event "hide me from the guest list", any RLS enforcement of visibility_mode (1334-sealed).
  - Live distribution: `{friends: 60, public: 1}` — the default dominates; a "public-visibility-only" avatar rule would show ~no faces.
- **Mechanism:** with no explicit guest-facing privacy setting, the SPEC must DEFINE the default mapping from `visibility_mode` (+ blocks) to card/sheet exposure — flagged with a recommendation in Open Questions; NOT invented here.
- **Severity:** `CONFIRMED` constraint. Security note: any peer RPC must not become a profile-scraper (see F-8 guard).

### F-8 — No peer-visible guest read path exists; the 1334 pattern + collision map for the new one · `CONFIRMED (backend gap)`
- **Symptom:** nothing lets a peer/anon see who's going, by design of current RLS.
- **Layer:** schema.
- **Probe:** `20261004_orch_1150_rsvp_events.sql:120-180` (policies), `20261016_orch_1163_event_rsvp_guests.sql:82-94`, baseline `:14200/:14204`; 1334 report §F-5/§R1; `ls ~/Desktop/mingla-orchs/*/supabase/migrations | tail`.
- **Evidence:**
  - `event_rsvps` policies: `event_rsvps_host_read` (event_manager rank via `biz_brand_effective_rank`), `event_rsvps_guest_read_own` (`:154`), guest insert/update own — no peer/anon SELECT. `event_rsvp_guests`: `host_read` + `owner_read` only. `orders`: `"Buyer or brand team can select orders"`; `tickets`: `"Buyer or brand team can select tickets"`. Anon/peer read = aggregates only (`business_public_events_view`, `pg_public_ticket_types_remaining`, by-slug RPCs).
  - **ORCH-1334 pattern (extracted for reuse, not re-proven):** SECURITY DEFINER + guard-first-statement + whitelisted display columns (`display_name/username/avatar_url` only) + `GRANT EXECUTE TO authenticated`; its host-guard predicate is `biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank('event_manager')` and it warns a DEFINER RPC without a guard is an open per-event guest-scraper. **1334's RPC scope:** rewrite `host_list_rsvp_guests` (primary) + flagged twins `admin_list_event_rsvps`, `fetch_user_going_rsvps`. A NEW peer-facing RPC (different name, different guard: event-is-public + `privateGuestList` false + row-cap + column whitelist) does not collide.
  - **Migration collision scan (all 15 worktrees):** highest version anywhere = `20261223000000_orch_1298_chip_in_receipt_enqueue.sql` (main + all current worktrees identical; the stale orch-118x/119x worktrees are far behind). ORCH-1334 has NOT yet added its migration. → leg 1338 must pick versions `> 20261223000000`, re-scan at IMPLEMENT time, and expect 1334's migration to land nearby.
- **Mechanism:** the identity wall is the single blocker for real avatars + the guest-list sheet; a guarded aggregate+sample RPC (or RPC pair) is net-new backend.
- **Severity:** `CONFIRMED` gap; the security guard requirements above are load-bearing.

### F-9 — Deep-link/funnel reality: ORCH-1318 already shipped consumer OneLink deferred deep-linking — the dispatch premise "both AF listeners false" is STALE; the remaining gaps are narrower and different · `CONFIRMED (premise-correcting)`
- **Symptom:** dispatch assumed the whole deferred-deep-link rail is missing.
- **Layer:** code (+ COMMS-0083 for go-live gates).
- **Probe:** full reads of `appsFlyerService.ts` (init + `registerOneLinkDeepLink` `:93-107,155-215`), `oneLinkResolver.ts` (all), `app/index.tsx:363-400,840-880`, `app/e/[brandSlug]/[eventSlug].tsx` (all), `deepLinkService.ts` (all 359 lines), `app.json:10,35-37`, `mingla-marketing/lib/store-links.ts:6-16`.
- **Evidence:**
  - `appsFlyer.initSdk({... onInstallConversionDataListener: true, onDeepLinkListener: true})` (`appsFlyerService.ts:107-108`); `registerOneLinkDeepLink()` registered BEFORE initSdk (`:93-97`); `onDeepLink` handler dedups, resolves via the ONE `resolveOneLinkDestination`, forwards/buffers to the UI sink (`:155-215`); sink registered at `app/index.tsx:393`; Android cold-start `performOnDeepLinking()` helper present.
  - **Payload contract (ORCH-1318 SPEC §B.1):** `deep_link_value ∈ {brand,event,trip,experience,referral,internal}`, `deep_link_sub1`=brandSlug, `deep_link_sub2`=entitySlug, `af_sub1`=referral (`oneLinkResolver.ts:11-16,57-74`) — event/trip/experience entity destinations ALREADY EXIST.
  - **Deferred replay:** entity targets persist to `AsyncStorage['mingla_deferred_deeplink']` as `{router:true, url:'/e/{brand}/{event}', ts}` and replay ≤24h after auth+onboarding via `router.push(url)` (`app/index.tsx:850-877`).
  - **Two nav systems:** `deepLinkService.Destination` (mingla:// + push; kinds profile/conversation/session/pages — NO entity-detail kind) vs expo-router cold file routes `app/{e,t,exp,b,brand}/…` (universal links; `applinks:usemingla.com, business.usemingla.com, go.usemingla.com` already in `app.json:35-37` — the OneLink subdomain groundwork exists).
  - **Remaining gaps for "install → land in guest-list sheet of event X":** (a) NO sheet-landing concept — neither the `/e/` route nor `ConsumerEventDetailScreen` accepts an "open guests sheet" param, and `oneLinkResolver` has no sub-destination field wired for it; (b) **seedless cold-route degradation** — the `/e/` route mounts `ConsumerEventDetailScreen` with `seed=null`, and `isRsvp = seed?.eventType` (`:246`) → the RSVP branch is unreachable on a cold open, and the standard branch renders a graceful "open from the app" state (route comment, `app/e/[brandSlug]/[eventSlug].tsx:5-9` — anon event-by-slug consumer fetch was ruled out of ORCH-1138's allowlist); (c) buyer-web has NO "See who's going" affordance and NO OneLink URL builder; the store-URL SSOT (`APP_STORE_URL` id6760440898 etc.) lives in `mingla-marketing/lib/store-links.ts` — mingla-business has only scattered constants; (d) QR-desktop precedent = the marketing `/download` page (ORCH-1319/1326/1328 family, per WORLD_MAP rows read); (e) **go-live gates unchanged (COMMS-0083):** fresh native builds for the AF SDK + Seth-set `APPSFLYER_S2S_TOKEN` — the deferred leg stays dark until those ship (JS/OTA cannot light it).
- **Mechanism:** leg 1342 is NOT "build deferred deep-linking" — it is: add the guest-sheet landing param end-to-end (OneLink payload → route → screen → sheet), build the buyer-web affordance + link/QR, and fix the seedless landing; it must plan JOINTLY with ORCH-1313 P2/1318 rather than duplicating them.
- **Severity:** `CONFIRMED`, premise-correcting — materially shrinks and re-shapes ORCH-1342.

### F-10 — Guard inventory: exactly what must be rewritten vs stay intact; the anon-only invariant bundles the ADDRESS-privacy rule · `CONFIRMED (rewrite contract)`
- **Symptom:** overturning anon-only must not silently drop sibling guarantees.
- **Layer:** test/CI/docs.
- **Probe:** verbatim reads of `orch_1157_rsvp_momentum.test.ts:96-160` + adversarial header; registry `~line 686`; `strict-grep-mingla-business.yml` greps; `tests-append-only.yml:1-43`; `ls .github/scripts/strict-grep | grep 1157|1163` → none.
- **Evidence — MUST BE REWRITTEN (leg 1340, at its CLOSE, never silently deleted):**
  1. `packages/offering-rendering/__tests__/orch_1157_rsvp_momentum.test.ts:120-130` — asserts component source has NO `<Image\b`, NO `\buri\b`, HAS `PersonGlyph`, NO `maybeCount|waitlistCount`, NO `guestName|guestPhoto|attendeeName|guestAvatar`. Editing it requires the **tests-append-only override token** in the commit body (`tests-append-only.yml` — `[TEST-CHANGE-APPROVED ORCH-NNNN]` family, `.github/scripts/test-append-only-check.js`).
  2. `Mingla_Artifacts/INVARIANT_REGISTRY.md` `### I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)` (~line 686). ⚠️ **The invariant text bundles TWO rules:** (a) anon faceless cluster / no public maybe-waitlist counts, AND (b) "the exact street address is hidden until the viewer is Going/Maybe (RSVP) / purchased (ticketed); the venue NAME must never carry the street". The rewrite overturns (a) ONLY; (b) must be re-stated verbatim in the successor invariant. Note the naming drift: registry says `…1157-SOCIAL-PROOF…`, the component comment + test title say `…1157-RSVP-SOCIAL-PROOF…` — sweep BOTH strings.
  3. The component doc-contract `RsvpMomentumDecision.tsx:21-27` (glyph-only paragraph) — must be rewritten to the new contract, and the props-carry-no-identity statement replaced by the new privacy-gated contract.
- **Evidence — MUST STAY INTACT (bind all new code):**
  - Same test file `:103-110` NO-CHECKOUT (no /checkout, priceAllIn, Reserve, cart in the shared unit); `:112-118` DECISION-IS-HERO; `:132-145` THEME-DIAL — **no 6/3-digit hex literals in the component** (new avatar UI must be palette-driven); `:147-152` Android opaque fill.
  - `orch_1157_rsvp_momentum_adversarial.test.ts` — no numeric maybe/waitlist/attendee leak in ANY sub-line; meter clamps at 100; no Maybe on full; "YOU'RE INVITED" kicker. (Real avatars don't violate these; new SUB-LINE copy could — binding.)
  - `orch_1157_round2/6/7/8/9` tests (address unlock caption, doors locale pill, Android gap + wrapInRNModal) and `orch_1163_{rsvp_shared_body,r2_floating_parity,r3_rsvp_floating_active,r4_rsvp_opaque_pill}` (9-section order incl. the `orch-1163-rsvp-inline-box` anchor, chips promoted out of the momentum unit, hideStepper, one-state-machine parity).
  - Strict-grep gates that grep this exact code: `orch-1292-taxonomy-label-parity` (the momentum chip must call `taxonomyLabel`, not `partyTypeLabel`); `orch-1303-rsvp-loop-interaction-handle` (EVERY `Animated.timing/spring` inside ANY `Animated.loop` across `RsvpMomentumDecision/RsvpOfferingBody/RsvpChipInPanel` must carry `isInteraction:false` — binding on any new avatar/cluster animation); `meta-orch-0991-base-bottom-sheet-sole-consumer` (the new consumer sheet MUST be a BaseBottomSheet consumer — only `BaseBottomSheet.tsx` may import gorhom); `orch-1043-sheet-scroll-viewport-check`.
  - No strict-grep `.mjs` gate pins 1157/1163 directly (verified empty) — the enforcement is the Deno test suite above.
- **Severity:** `CONFIRMED` rewrite contract.

### F-11 — Live prod data census (READ-ONLY, Management API) · `CONFIRMED (data layer)`
- **Layer:** data.
- **Probe:** 3× `POST https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/database/query` (browser UA), SELECTs only.
- **Evidence (verbatim):**
  - `{"rsvps_total":4,"rsvps_with_user":3,"orders_total":2,"orders_with_user":1,"tickets_total":2,"profiles_total":61,"profiles_with_avatar":9}`
  - `{"visibility_dist":{"public":1,"friends":60},"rsvp_plusone_rows":0,"plusones_matched":0,"pgl_true":1,"hrc_true":0,"events_total":9,"friend_requests_total":15,"friends_rows":30}`
  - `{"event_type_dist":{"event":3,"rsvp":4,"trip":2},"tickets_with_linked_buyer":1,"tickets_total":2,"rsvps_going_approved":4}`
- **Mechanism:** small-but-real dataset: identity is recoverable for most RSVP guests (75%) and half of ticket buyers; avatars are sparse (15%) → glyph fallback is a first-class state; one live event already expects `privateGuestList` to work; zero experiences live (experience leg is future-proofing, not day-one data).
- **Severity:** supporting (data layer sealed).

### F-12 — Side discovery: buyer-web `DownloadMinglaCta` ships a STALE App Store URL · `SUSPECTED CONTRIBUTOR (adjacent bug, out of scope)`
- **Symptom:** the post-checkout "Join your event chat in the Mingla app" CTA's iOS store link is a placeholder.
- **Layer:** code.
- **Probe:** read `mingla-business/src/components/checkout/DownloadMinglaCta.tsx:13-14` + usage grep.
- **Evidence:** `const APP_STORE_URL = "https://apps.apple.com/app/mingla";` (not the real `id6760440898` in `mingla-marketing/lib/store-links.ts:6`); Play URL is correct; mounted from `app/checkout/[eventId]/confirm.tsx`. Also the universal-link fallback `https://usemingla.com/orders/{id}/chat` targets the `orders/{id}/chat` deep-link path (consumer parser supports it).
- **Mechanism:** iOS users tapping the store badge post-checkout likely hit a dead/incorrect App Store page. This component is ALSO the closest in-repo precedent for 1342's buyer-web install affordance — fix + SSOT-alignment naturally folds into leg 1342.
- **Severity:** `SUSPECTED CONTRIBUTOR` (to install-funnel loss); registered as a discovery, not scoped here.

### F-13 — Side discovery: `connectionsService.ts` is a legacy half-stub · `RULED OUT (as plumbing for this build) / pattern-compliance flag`
- **Layer:** code.
- **Probe:** full read (261 lines).
- **Evidence:** `getConversations`/`getMessages` return `[]` unconditionally (`:144-167`); `getFriends` probes column names at runtime (`friend_id` vs `friend_user_id`, `:103-109`); comments say "conversations table might not exist". Real plumbing lives in `useFriends`/`friendsService`/`messagingService`.
- **Mechanism:** legs 1341 must NOT wire through `ConnectionsService` — use `useFriends().addFriend` + `messagingService.ensureConversation/sendFirstMessage`.
- **Severity:** `RULED OUT` as a dependency; flagged as dead-code cleanup candidate.

---

## Q8 detail — exact plumbing signatures (for the SPEC)

- **Send friend request:** `useFriends().addFriend(friendUserIdOrEmail: string, receiverEmail: string, receiverUsername?: string)` (`app-mobile/src/hooks/useFriends.ts:57-257`) — UUID path verifies the profile, upserts `friend_requests {sender_id, receiver_id, status:'pending'}` (re-pends a previously actioned row), fires edge fn `send-friend-request-email` (non-critical), logs `af_invite` + mixpanel, invalidates `friendsKeys.requests`. Accept: `supabase.rpc('accept_friend_request_atomic', {p_request_id})` (`:267`; also used by `useNotifications.ts:497`). Cancel: `cancelFriendRequest` (same hook). Reads: `friendsService.fetchFriends/fetchFriendRequests/fetchBlockedUsers` (typed `Friend/FriendRequest/BlockedUser`).
- **Open/create DM:** `messagingService.ensureConversation(userId1, userId2): Promise<{conversationId: string|null; error: string|null}>` — block-checks via `blockService.hasBlockBetween(userId2)` then atomic RPC `get_or_create_direct_conversation(p_user1_id, p_user2_id)` (`messagingService.ts:582-604`); `sendFirstMessage(senderId, recipientId, content, …)` composes ensure+send (`:609-632`). UI landing today: deep-link `Destination {kind:'conversation', conversationId, chatType:'direct'}` → `setDeepLinkParams({tab:'messages', conversationId,…})` + `setCurrentPage('connections')` (`deepLinkService.ts:302-315`); profile overlay via `setViewingFriendProfileId` (kind `'profile'`).
- **UI exemplars:** `EventAudienceSheet` (inline in `MessageInterface.tsx:2221-2260`): BaseBottomSheet, `wrapInRNModal`, fixed `['70%']` snap, `theme="dark"`, `scrollMode="scroll"`, `header` slot (icon+title+subtitle), body = mapped participant rows, each a `TouchableOpacity` → `handleOpenAudienceProfile(participant.id)`. Also `FriendsActionChooserSheet` (options-sheet pattern: `{visible,onClose,onChooseCreateGroupChat,onChooseAddFriend,createGroupChatDisabled,onCreateGroupChatPaywall}`) and `FriendActionsSheet`.
- **Binding UI constraint:** the Message CTA is friend-gated (ORCH-0993, `ViewFriendProfileScreen.tsx:712`); the sheet's per-guest actions must respect this or explicitly change the product rule (Open Question 5).

## Q7 detail — BaseBottomSheet contract + sheet-regression classes (SPEC guards)

**Contract (`app-mobile/src/components/ui/BaseBottomSheet.tsx`):** declarative `visible`/`onClose` (ALL dismiss analytics on onClose — pan-down and button must fire identically); `variant: 'sheet'|'center-dialog'`; `snapPoints` / `initialIndex` / `enableDynamicSizing` + `maxDynamicContentSize` (ORCH-1138 clamp); `enablePanDownToClose` default true; `scrollMode: view|scroll|flatlist|sectionlist` + `scrollProps` (gorhom containers only — never a raw RN list inside); `header` = intrinsic-height SIBLING above the scroll body (ORCH-1043 — never wrapped in a flexed BottomSheetView); `stickyFooter`; `wrapInRNModal` (ORCH-0908 z-stack over tab bar/chat); `tabBarAware` (0991 Bug 4 — only for sheets BELOW the visible nav; mutually exclusive in practice with wrapInRNModal); `hidesBottomNav` (ORCH-1016); `bottomSheetInset`; keyboard props; `handleStyle`/`backgroundStyle`/`backdropOpacity`; **`overlay`** (ORCH-1315/COMMS-0084) = viewport-fixed SIBLING slot inside the same window for any full-screen surface triggered from inside the sheet — NEVER nest a second RN `<Modal>` over a `wrapInRNModal` sheet (iOS silently drops it; source reads wrongly clear it — runtime proof required).

**Regression classes to guard in the SPEC (each cited from source/registry):**
- **META-ORCH-0991** — raw RN `<Modal>` sheets → BaseBottomSheet; GestureHandlerRootView must wrap (Bug 1); floating-nav bottom-padding footprint (Bug 4/tabBarAware); enforced by `meta-orch-0991-base-bottom-sheet-sole-consumer` (only BaseBottomSheet may import gorhom).
- **ORCH-1016** — full detail/checkout sheets must hide the floating GlassBottomNav (`hidesBottomNav`) or the CTA is painted over.
- **ORCH-1040/1043 family** — sheet body/header layout: header as intrinsic sibling; body containers not double-wrapped; `orch-1043-sheet-scroll-viewport-check` CI gate.
- **ORCH-1064** — deterministic TIMING open/close replacing gorhom's spring (release-only "half-open stall" freeze).
- **ORCH-1138** — content-sized sheets: `maxDynamicContentSize` clamp paired with a snapPoints max.
- **ORCH-1157 R8/R9** — Android bottom gap under `wrapInRNModal` (tests `orch_1157_round8/9`).
- **ORCH-1171** — per-RN-Modal-window keyboard provider + Done bar (keyboard inside wrapInRNModal windows doesn't inherit the app-root provider).
- **ORCH-1190/1191** — consumer sheet bottom-fill (sheet must fill to the physical bottom; COMMS-0052 family).
- **ORCH-1315 (COMMS-0084)** — modal-over-modal paywall drop; use the `overlay` slot; a closed overlay must render `null` (no touch-capturing layer).

## Q11 detail — cross-entity insertion map

| Entity | Buyer-web route (mingla-business, also business-native) | Wrapper | Shared body | Consumer screen | Business preview |
|---|---|---|---|---|---|
| RSVP | `/e/{brandSlug}/{eventSlug}` + `/checkout/[eventId]` → `PublicEventPage:798` | `FoundationRsvpPreview` | `RsvpOfferingBody` (card ALREADY here) | `ConsumerEventDetailScreen` RSVP branch (`:931/:976`) | `app/rsvp/[id]/preview.tsx:360` |
| Standard | same routes → `PublicEventPage` ticketed path | `FoundationEventPreview` | `EventOfferingBody` (NO momentum) | `ConsumerEventDetailScreen` standard branch (`:916`) | `FoundationEventPreview` |
| Trip | `/t/{brandSlug}/{tripSlug}` (`app/t/[brandSlug]/[tripSlug].tsx:64`) | `TripPreview` (FOUNDATION) | `TripOfferingBody` (NO momentum) | `ConsumerTripDetailScreen` | `TripPreview` |
| Experience | `/exp/{brandSlug}/{experienceSlug}` (`:63`) | `ExperiencePreview` (FOUNDATION) | `ExperienceOfferingBody` (NO momentum; `:895` consumer) | `ConsumerExperienceDetailScreen` | `ExperiencePreview` |
| Brand | `/b/{brandSlug}` → `packages/brand-rendering` | — | offering TILES only | — | — |

Inserting the momentum unit INSIDE the three non-RSVP shared bodies = automatic 5-surface parity; the manual work per surface is the CONFIG (counts per entity, toggles, entity-appropriate copy — "going" vs ticketed semantics). The brand page is tiles-only; recommend OUT of scope (flag).

Naming correction for the docs: the dispatch/WORLD_MAP say "RsvpPublicBody" — that component was dissolved by ORCH-1163; the current chain is `PublicEventPage → FoundationRsvpPreview → RsvpOfferingBody`.

---

## Five-Truth-Layer reconciliation

| Layer | What it says | Contradictions flagged |
|---|---|---|
| **Docs** | WORLD_MAP/dispatch premise: card RSVP-only ✔; toggles dark ✔; "both AF listeners currently false" ✖ STALE (ORCH-1318 shipped them true); "RsvpPublicBody" naming ✖ dissolved (ORCH-1163). Invariant registry bundles anon-cluster + address-privacy in ONE invariant. | **Docs vs Code #1:** AF-listener premise — CODE holds the truth (F-9). **Docs vs Code #2:** component naming drift — cosmetic, but the SPEC must cite real files. |
| **Schema** | Identity exists server-side for RSVP guests + order buyers; RLS walls all of it from peers; anon reads are aggregates; toggles live in `events.theme`, not columns; profiles world-readable despite `visibility_mode`. | **Schema vs Docs:** `visibility_mode` promises a privacy level RLS doesn't enforce (1334-sealed posture flag — the new peer RPC must implement privacy IN-RPC, not lean on RLS). |
| **Code** | Card pure-presentational glyph cluster; toggles written+parsed, rendered nowhere; OneLink rail complete though sheet-landing absent; messaging friend-gated. | **Code vs Code:** `publicEventsService` PARSES the toggles into the public event model while no renderer consumes them — a half-built read path (the gap IS the feature). |
| **Runtime** | Prod probes: view counts + RLS behavior consistent with schema reading; no sim run (feature-gap exemption per dispatch; no source-contradicting finding arose that required one). | none |
| **Data** | 1 live event stores `privateGuestList=true` (silently ignored — user-impacting); avatars 15%; RSVP linkage 75%; buyers 50%; 0 experiences live. | **Data vs Docs:** hosts already USE a toggle documented in wizard UI as if it works — the darkness is not hypothetical. |

## Repro evidence

Feature-gap investigation — Prime-Directive-7 exemption applies per the dispatch (already-cold-proven gaps; code-audit + backend). Live-fire performed at the DATA layer: 3 read-only SQL probes against prod `gqnoajqerqhnvulmnyvv` via the Management API (results verbatim in F-11). No mutations, no deploys, no sim run (no finding contradicted source).

## Blast radius / cross-surface map

- **In scope (per leg, see decomposition):** `packages/offering-rendering/{RsvpMomentumDecision,rsvpMomentum,EventOfferingBody,TripOfferingBody,ExperienceOfferingBody}.tsx` + config types; per-surface config plumbing (`PublicEventPage`, `FoundationEventPreview`, `TripPreview`, `ExperiencePreview`, `ConsumerEventDetailScreen`, `ConsumerTripDetailScreen`, `ConsumerExperienceDetailScreen`, `publicEventsService`, `rsvpDeckService`/hooks); wizard toggles (`TripCreatorStep5Policy` or accordion, a NEW experience settings home, reusing `CreatorStep6Settings` ToggleRow); NEW migration(s) `> 20261223000000` (peer RPC + cross-entity counts); NEW consumer sheet (BaseBottomSheet consumer) + tap wiring in the card; buyer-web affordance + OneLink/QR; `oneLinkResolver`/route param for sheet landing.
- **Out of scope (declared):** admin-web (ORCH-1334's twin owns admin attendee views); brand page tiles; `host_list_rsvp_guests`/`admin_list_event_rsvps`/`fetch_user_going_rsvps` (1334's scope); Chip-in panel; checkout paths.
- **Surfaces:** consumer iOS ✔, consumer Android ✔, buyer-web ✔, business iOS/Android ✔ (wizard + preview + PublicEventPage), business-web preview ✔, admin-web ✖ (declared), marketing-web — only if 1342 reuses `/download` QR assets (read-only precedent).
- **Recurring-pattern note:** this is the third "identity resolution at read time" build (1334 host console, 1334-flagged admin twin, now peer-facing) — the whitelisted-columns DEFINER pattern is becoming the house standard.

## Invariant impact (flagged, NOT pre-decided)

- **I-PROPOSED-1157-SOCIAL-PROOF-ANON-ONLY (ACTIVE)** — deliberately overturned by Seth's order, but ONLY its anon-cluster half; its bundled ADDRESS-privacy half must survive verbatim (F-10). Guards to rewrite listed in F-10 with the tests-append-only token requirement.
- **I-PROPOSED-1157-NO-CHECKOUT-AFFORDANCE / DECISION-IS-HERO / USES-BRAND-THEME-DIAL (ACTIVE)** — untouched and binding (no hex literals in the card; the sheet/link must not introduce checkout affordances into the RSVP unit).
- **I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER, orch-1043 viewport gate, ORCH-1303 isInteraction, ORCH-1292 taxonomy-label** — binding on new code (F-10).
- **I-MOR-0827-PACKAGE-ISOLATION** — the card stays props-only/pure; avatar data must arrive via props (no fetch in the package); the count/identity fetch lives in each surface's host. Any `<Image>` introduction must also respect the biz-web bundle-budget gate (`web-build-check.yml`).
- **Constitution #9 (no fabricated data)** — glyph fallback for avatar-less/private guests is HONEST and mandatory (15% avatar fill).
- **COMMS-0057 / ORCH-1206 (RSVP never merges into the ticket path)** — cross-entity counts must be per-entity reads, not a forced shared table.
- **I-NOTIF-FALLBACK-AGREES / I-ONELINK-SINGLE-RESOLVER** — any sheet-landing param must flow through the ONE resolver + the typed Destination/router contract, not a second ad-hoc parser.

## Discoveries for Orchestrator

1. **`DownloadMinglaCta` stale iOS store URL** (`apps.apple.com/app/mingla`) on the buyer-web post-checkout confirm — install-funnel leak; candidate fold-into ORCH-1342 or a sibling quick fix (F-12).
2. **`connectionsService.ts` is a legacy half-stub** (empty conversations, runtime column-probing) — dead-code cleanup candidate; must not be used by 1341 (F-13).
3. **`publicEventsService` parses the privacy toggles into the public model with no consumer** — half-built read path; leg 1339 completes it rather than re-plumbing (F-4).
4. **WORLD_MAP/dispatch AF-premise stale** ("both AF listeners false") — ORCH-1318 flipped them true with a full deferred rail; recommend a doc-sync note at this META's next checkpoint (F-9).
5. **Profiles world-readable posture** (1334 discovery, still standing) — the new PEER RPC makes this posture user-visible for the first time; the SPEC's privacy mapping (Open Q1) is where this gets a deliberate decision.
6. **Component naming drift in docs** — "RsvpPublicBody" no longer exists; chain is `PublicEventPage → FoundationRsvpPreview → RsvpOfferingBody`.

## Confidence

**proven** — every claim above is backed by verbatim file+line reads, latest-migration-chain checks (Phase-0 rule applied: `business_public_events_view` cited from its LATEST recreation in 20261220; toggle RPC from LATEST 20261222; sold formula from 0946 + its by-slug reuses), and live prod data. The single runtime-dependent behavior asserted from source only (seedless `/e/` cold-route degradation) is stated with its in-code authority (the route's own contract comment + the `seed?.eventType` read) and flagged for the 1342 SPEC to re-verify at TEST.

## Recommended next phase + child decomposition (direction only — NOT a spec)

**Validated split (reserved IDs hold), with dependency order and two scope adjustments:**

1. **ORCH-1338 [guest-read-backend] — FIRST, blocks 1340/1341; half-blocks 1339.**
   Scope: (a) NEW peer-facing, privacy-aware guest read RPC(s) — SECURITY DEFINER, guard-FIRST (event public/live + `privateGuestList` gate read server-side from `events.theme`, row-cap, whitelisted columns `display_name/username/avatar_url` + an `is_mingla_user` discriminator; per-viewer block exclusion for authed callers), per the 1334 pattern; (b) the uniform anon "social-proof counts" read for standard/trip/experience (absolute sold/going + capacity, fixing the unlimited-capacity hole, F-3); (c) avatar-cluster sample payload (first N linked guests with avatars). Migration versions `> 20261223000000`, re-scan worktrees at IMPLEMENT (1334's migration will land nearby). No UI.
2. **ORCH-1339 [momentum-card-cross-entity] — after 1338's count contract (can SPEC in parallel).**
   Scope: mount the momentum unit in `EventOfferingBody`/`TripOfferingBody`/`ExperienceOfferingBody` + config plumbing on all five surfaces; wire BOTH toggles as live gates everywhere the card renders (incl. the existing RSVP surfaces — F-4's live host); add the toggles net-new to trip (Step5Policy + edit accordion) and experience (NEW settings home — placement decision) wizards, reusing the `CreatorStep6Settings` ToggleRow pattern. Designer: optional (existing patterns); entity-appropriate momentum copy ("going" vs ticketed) needs a copy decision — fold into the SPEC, mingla-product-grade copy review recommended.
3. **ORCH-1340 [card-real-avatars] — after 1338.**
   Scope: real avatars in the cluster (privacy + host-toggle + blocked-pair gated; glyph fallback per guest), the invariant/test/doc-contract rewrite (F-10 list, tests-append-only token, address-privacy half preserved), successor invariant + fails-on-revert guards. **Needs mingla-designer** (mixed avatar/glyph cluster, loading/fallback states, theme-dial compliance — no hex literals).
4. **ORCH-1341 [guest-list-sheet-consumer] — after 1338; after 1340 for visual consistency.**
   Scope: NEW BaseBottomSheet consumer sheet (EventAudienceSheet as the UI exemplar; wrapInRNModal + COMMS-0084 overlay rules; every F-10/Q7 regression class guarded in the SPEC), tap wiring on the cluster + a "See who's going" affordance in the card (both card mounts — inline box AND any momentum-bearing mount), add-friend via `useFriends().addFriend`, message via `ensureConversation`/`sendFirstMessage` honoring the friend-gate default. **Needs mingla-designer** (sheet IA/states/motion). Runtime sheet proof (open/close/z-index) mandatory at TEST per Seth's standing caution.
5. **ORCH-1342 [web-see-whos-going-funnel] — last; joint with ORCH-1313 P2/1318.**
   Scope: buyer-web "See who's going" tap → device-aware store link (iOS/Android; QR on desktop per the ORCH-1326/1328 patterns), a OneLink URL builder (default subdomain `go.usemingla.com`, already in associated domains) carrying an "open guest sheet" payload extension through the ONE resolver → route param → sheet; the seedless `/e/` cold-route landing fix (bounded consumer event-by-slug read OR RSVP-first scoping — Open Q6); fold in the F-12 stale-URL fix + store-URL SSOT alignment for mingla-business. Designer: light (web affordance). **Go-live remains native-build + `APPSFLYER_S2S_TOKEN` gated (COMMS-0083)** — sequence the deferred-link TEST after those ship; the store-link + QR half is shippable immediately.

**Open questions WITH recommended defaults (Seth pre-authorized: real avatars public subject to privacy; app-gated full list; OneLink default — not re-asked):**
1. **Privacy mapping for public identity** (no explicit setting exists — F-7): recommend `visibility_mode public|friends` → real avatar on the card + name in the app-gated sheet; `private` → glyph + anonymous row; blocked-pair excluded per authed viewer; anon buyer-web gets avatars/count only, never names (full list app-gated per pre-auth). Alternative (stricter, near-empty at 60/61 friends-mode): public-only faces — NOT recommended.
2. **`hideRemainingCount` semantic:** recommend it suppresses the scarcity sub-line + meter percentage (render the "Open invite"-style momentum) while keeping the going count; `privateGuestList` suppresses the cluster, the "See who's going" affordance, and the sheet/peer RPC (server-enforced).
3. **Ticketed cluster identity:** only order BUYERS are linkable (tickets carry no user) — cluster shows linked buyers; extra seats stay glyphs. Recommend accept; per-seat linkage is a future capture ask (mirrors 1334 F-8's honesty split).
4. **Message action for non-friends in the sheet:** recommend keep the ORCH-0993 friend-gate — non-friends get Add-friend only; message unlocks once friends.
5. **Experience wizard settings home:** recommend a Settings accordion appended to `ExperiencePricingStep` (avoids a new step) — designer/spec to confirm.
6. **Seedless cold-route landing (1342):** recommend adding the bounded anon event-by-slug consumer read (revisits ORCH-1138 OQ-6's degradation with the new justification) rather than scoping deferred landing to RSVP only.
7. **Brand-page tiles:** recommend OUT of scope for this META (tiles are a different density; register a follow-up if Seth wants counts-on-tiles).

**Next phase:** SPEC per leg (forensics SPEC mode), starting with ORCH-1338; mingla-designer invoked at SPEC time for 1340 + 1341.

---

## Layman-first outcome

Today, only invite-style (RSVP) event pages show the "4 going" momentum card, and its little row of faces is fake-anonymous silhouettes that do nothing when tapped. Ticketed events, trips, and experiences show no social proof at all. The two privacy switches hosts can already flip ("Private guest list", "Hide remaining count") save correctly but change nothing publicly — and one real host has already turned one on, expecting it to work. The good news: the machinery to fix all of this mostly exists. Every surface renders the card from ONE shared component (change it once, it changes everywhere); the database already knows which guests and buyers are real Mingla users and what their profile photos are (though only 15% have photos, so silhouettes stay as the fallback); the app already has friend-requests, direct messages, blocking, and a proven bottom-sheet kit for the new "who's going" list; and — better than we thought — the "install the app and land on the right event" pipeline was already built last week (ORCH-1318), so the web funnel leg only needs the "See who's going" button, the QR/store link, and a small "open the guest list" add-on to that pipeline (it stays dark until the new native builds ship). The real new work is one careful backend read path that shows guest identities to peers WITHOUT becoming a scraping hole, a privacy rule for who appears with a real face (recommended: everyone except "private" profiles and blocked pairs), and rewriting the old "never show faces" rule and its tests deliberately — while keeping its second half (street addresses stay hidden until you're going) fully intact.
