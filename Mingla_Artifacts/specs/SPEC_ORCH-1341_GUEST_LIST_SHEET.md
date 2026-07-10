# SPEC — ORCH-1341 [guest-list-sheet-consumer]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 4 of 5 (after 1338 backend, 1339 card, 1340 avatars/affordance seam; before 1342 web funnel)
**Phase:** SPEC (forensics SPEC mode — contract, not code)
**Binding investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md` — F-7 (privacy model), F-8 (peer read + scrape guards), F-13 (`connectionsService` BANNED), Q7 (sheet contract + the 9 regression classes), Q8 (plumbing signatures) govern.
**Binding design:** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1337_GUEST_SOCIAL_PROOF.md` §2 (`EventGuestListSheet` — IA, BaseBottomSheet config, header, row anatomy, actions, states, a11y, regression table §2.9), §4 (copy block), §5 (guard notes) — BINDING for every token/dimension/state/motion; cited by section, restated only where load-bearing.
**Binding payload contract:** `SPEC_ORCH-1338_GUEST_READ_BACKEND.md` §4.1.2 + §4.4 — `peer_list_event_guests(p_event_id, p_limit, p_offset)` → `PeerGuestListPage { eventId, entityType, returned, hasMore, guests: PeerGuestRow[] }`; `PeerGuestRow { profileId, displayName, username, avatarUrl, isMinglaUser, isAnonymous, partySize }`; error tokens `authentication_required` / `event_not_available` / `guest_list_private`; hard cap 100; authenticated-only grant. Consumed as-frozen.
**Binding card seam (from 1340):** `onSeeWhosGoing?: () => void` on `RsvpOfferingConfig` AND on the three offering bodies → `OfferingMomentum` (SPEC_ORCH-1340 §4.7). This leg supplies the HANDLERS; it does not touch the package.
**Sealed decisions honored (not re-opened):** D1 (named rows = public|friends visibility; private → anonymous row; blocked excluded; names are app-gated + authed), D2 (privateGuestList suppresses the list SERVER-side), D3 (buyers-only identity; `partySize` carries the extra seats), D4 (Message stays ORCH-0993 friend-gated; Add-friend open), D8 (`profileId` present on NAMED authed rows ONLY — the sheet's actions key off it; anonymous rows carry none), D9 (RPC visibility mirrors the public page), DESIGN decisions (rows NOT pressable — only the two inline action buttons; close-sheet-before-NAVIGATE on message; glyph = loading state; fixed `['70%']`; app-chrome dark, never palette-themed; no search/pull-to-refresh/load-more in v1; transient line-2 hint, no toasts).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`.
**Date:** 2026-07-10

---

## 1. Executive summary

After 1340, the momentum cluster shows real faces and carries a "See who's going ›" affordance that nothing handles yet. This leg builds the destination: `EventGuestListSheet` — a consumer-app BaseBottomSheet (`wrapInRNModal`, fixed `['70%']`, dark app-chrome — the proven EventAudienceSheet posture) listing the event's guests by name where privacy allows (D1), anonymous where it doesn't, with two inline per-row actions: **Add friend** (open to all named rows, via the real `useFriends().addFriend` plumbing) and **Message** (friend-gated per ORCH-0993/D4, via `messagingService.ensureConversation` + the app's one deep-link rail, sheet closed BEFORE navigation). Data arrives through a new React-Query hook wrapping 1338's `peer_list_event_guests` with a key from the app's central key factory. The tap is wired in all three consumer detail screens (RSVP card + `OfferingMomentum` mounts). Blocked pairs and typed contact data never reach the client (server-enforced — the client MUST NOT re-filter); `privateGuestList` flips are honored mid-view via the RPC's `guest_list_private` error → a designed gated state. Consumer sheets historically regress (Seth standing caution) — this SPEC carries a named runtime open/close/z-index proof as a hard success criterion and maps every Q7 regression class to the clause that prevents it.

## 2. Scope & non-goals

**In scope**
- NEW `app-mobile/src/components/EventGuestListSheet.tsx` (flat under `src/components/` — the sibling convention for app-level sheets: `NotificationsSheet.tsx`, `DismissedCardsSheet.tsx`, `FeedbackHistorySheet.tsx` all live at the root; domain subdirs hold domain-owned pieces).
- NEW hook `app-mobile/src/hooks/useEventGuestList.ts` + a `guestListKeys` factory added to the central `app-mobile/src/hooks/queryKeys.ts`.
- ONE added export in `app-mobile/src/services/socialProofService.ts` (1339's file): `fetchPeerGuestList`.
- Tap wiring + sheet mount in the three consumer screens: `ConsumerEventDetailScreen` (RSVP branch via `rsvpConfig.onSeeWhosGoing` + standard branch via `EventOfferingBody`'s prop), `ConsumerTripDetailScreen`, `ConsumerExperienceDetailScreen`.
- Message-action navigation via the EXISTING deep-link rail (`mingla://chat/{conversationId}?type=direct` — zero new navigation plumbing; §4.5).
- New regression tests (deno source-structure + adversarial) and the runtime sheet-proof protocol.

**Non-goals (explicitly out)**
- Buyer-web tap (`SeeWhosGoingGate`, store links, QR, OneLink sheet-landing param) → ORCH-1342. Web mounts pass no `onSeeWhosGoing` yet ⇒ inert by 1340's design (no dead tap).
- Profile-open from a row → explicitly EXCLUDED (design §2.4: modal-over-modal footgun; a future ORCH may add it via the `overlay` slot ONLY, never a second RN Modal).
- Accept-incoming-request from the sheet, cancel-request, search, pull-to-refresh, pagination/load-more → v1 exclusions per design §2.5/§2.2/§2.6 (each flagged as optional follow-up, not built).
- Any package (`packages/offering-rendering`) change — 1340 shipped the seam; any backend change — 1338 frozen.
- `event_rsvp_guests.matched_user_id` plus-one identity (1338 §10-1 deferral; `partySize` carries them).
- Business app surfaces (no guest sheet in business; preview passes no handler), admin-web (F-2).
- `connectionsService.ts` — BANNED dependency (F-13 legacy half-stub); the sheet imports NOTHING from it (guard-tested).

**Assumptions (investigation/design-proven, re-verified verbatim this session)**
- BaseBottomSheet contract (verbatim-read `app-mobile/src/components/ui/BaseBottomSheet.tsx:1-280`): declarative `visible`/`onClose` (ALL dismiss analytics on `onClose` — pan-down + backdrop + programmatic close fire identically); `wrapInRNModal` = ORCH-0908 z-stack escape hatch; `tabBarAware` documented mutually-exclusive-in-practice with `wrapInRNModal` (Bug 4); `header` = intrinsic-height SIBLING (ORCH-1043); `scrollMode="flatlist"` renders gorhom's own list (never a raw RN list); `overlay` slot = the ORCH-1315/COMMS-0084 sanctioned layering escape (closed overlay renders `null`); stock spring (no `animationConfigs` — ORCH-1064).
- Exemplar posture (verbatim-read `MessageInterface.tsx:2215-2299` + `:96`): `EVENT_AUDIENCE_SNAP = ["70%"] as const` module constant; `wrapInRNModal` + `theme="dark"` + fixed snap + header slot + mapped rows — the design's §2.2/§2.3 geometry source.
- **Layering context (verbatim-read this session — the z-index proof target):** all three consumer detail screens are INLINE BaseBottomSheet hosts (`ConsumerEventDetailScreen.tsx:833-845` — ORCH-1194 comment explicitly reverted its `wrapInRNModal`; trip/experience same family). The deck event path early-returns `<ConsumerEventDetailScreen/>` DIRECTLY (`ExpandedCardModal.tsx:1819-1825`) — the wrapInRNModal deck sheet does NOT wrap it. Therefore the guest sheet is the ONLY RN-Modal window when open — exactly the EventAudienceSheet-over-chat posture. No second RN Modal exists in any in-scope mount context.
- Plumbing signatures (verbatim-read): `useFriends().addFriend(friendUserIdOrEmail: string, receiverEmail: string, receiverUsername?: string): Promise<void>` — UUID path verifies the profile, upserts/re-pends `friend_requests`, fires the non-critical email fn, logs `af_invite` + mixpanel, invalidates `friendsKeys.requests`, and THROWS on failure (`useFriends.ts:57-257`). `useFriends()` also returns `friends: Friend[]` (`friend_user_id` = peer profile id) and `friendRequests: FriendRequest[]` — which contains **incoming AND outgoing** pending rows (`friendsService.fetchFriendRequests:116-139` runs both directions) → the "Requested" chip can render from first paint. `messagingService.ensureConversation(userId1, userId2): Promise<{conversationId: string|null; error: string|null}>` — block-checks then atomic RPC `get_or_create_direct_conversation` (`messagingService.ts:582-604`); returns, never throws. `sendFirstMessage` (`:610-634`) is the COMPOSE-path helper — the sheet does NOT call it; the conversation thread UI owns composition (see §4.5 note).
- Navigation rail (verbatim-read): `mingla://chat/{conversationId}?type=direct` → `parseDeepLink` → `{kind:'conversation', conversationId, chatType:'direct'}` (`deepLinkService.ts:130-136`) → root warm-link listener (`app/index.tsx:1671` `Linking.addEventListener("url", …)`) → `executeDeepLink` → `setDeepLinkParams({tab:'messages', conversationId, chatType})` + `setCurrentPage('connections')` (`deepLinkService.ts:302-315`). One parser, one rail — no second ad-hoc parser (the I-ONELINK-SINGLE-RESOLVER posture flagged by the investigation).
- Key factory (verbatim-read `app-mobile/src/hooks/queryKeys.ts:1-13`): "Centralized query key factories. Each domain entity should have exactly one key factory." — the new `guestListKeys` factory belongs HERE (Constitution #4 bans hardcoded key strings).
- Icon + avatar primitives: `Icon` from `./ui/Icon`, `ImageWithFallback` from `./figma/ImageWithFallback` (MessageInterface's imports — the exemplar family).

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS | YES | Tap cluster/link on RSVP + standard + trip + experience details → guest sheet with named/anonymous rows, add-friend + message actions, all §4.4 states | `EventGuestListSheet.tsx`, `useEventGuestList.ts`, `queryKeys.ts`, `socialProofService.ts`, 3 detail screens | Sheet is one component; per-screen wiring manual ×3 |
| 2 | Consumer Android | YES | Same + opaque dark canvas to the physical bottom (design §2.9 Android delta) | same files | Same code; runtime proof per platform MANDATORY |
| 3 | Buyer/anon Web | NOT covered | — web tap = ORCH-1342's gate; no handler passed ⇒ 1340's inert/absent-link state, no dead tap | none | — |
| 4 | Business iOS | NOT covered | — no guest sheet in the business app; previews pass no handler | none | — |
| 5 | Business Android | NOT covered | — same | none | — |
| 6 | Admin Web | NOT covered | — no mounts (F-2); ORCH-1334's twin owns admin attendee views | none | — |
| 7 | Business Web preview | NOT covered | — honest zero-state preview, no affordance (1340 §3) | none | — |

**Delivery constraint (routing note):** all files are consumer `app-mobile` pure JS ⇒ per-platform OTA-able; no native module added. One META PR at CLOSE.

## 4. Layered specification

Database / edge function / realtime: **none** (1338 frozen; counts refresh via 1339's query; the guest list is fetch-on-open).

### 4.1 Service — `app-mobile/src/services/socialProofService.ts` (MODIFY: one added export)

`fetchPeerGuestList(eventId: string): Promise<PeerGuestListPage>` → `supabase.rpc("peer_list_event_guests", { p_event_id: eventId, p_limit: 100 })` (the hard cap — ONE page, no pagination in v1; `hasMore` + `goingCount` drive the "and N more" tail).
- Success: return the payload typed as `PeerGuestListPage` (import from `packages/offering-rendering/socialProofTypes` — camelCase-identical to the RPC json, no mapping layer).
- Error contract (typed, so the sheet can pick states): map the PostgREST error message to a discriminated error — `message` containing `guest_list_private` → throw `GuestListGatedError`; `event_not_available` → throw `GuestListUnavailableError`; anything else (incl. network + `authentication_required`, unreachable in practice since the sheet is authed-app-only) → rethrow as generic. Error classes may be lightweight local classes or a `code` field on Error — implementor picks one form and documents it; the HOOK contract below is what's binding.

### 4.2 Hook — `app-mobile/src/hooks/useEventGuestList.ts` (NEW) + key factory

**Factory (added to `app-mobile/src/hooks/queryKeys.ts` — Constitution #4; cite the file's own "one factory per domain entity" header):**
```ts
export const guestListKeys = {
  all: ['eventGuestList'] as const,
  list: (eventId: string) => [...guestListKeys.all, eventId] as const,
};
```
**Hook:** `useEventGuestList(eventId: string | null, visible: boolean)` → `useQuery({ queryKey: guestListKeys.list(eventId ?? 'none'), queryFn: () => fetchPeerGuestList(eventId!), enabled: visible && !!eventId, staleTime: 0, gcTime: 0, retry: 1 })`.
- `staleTime: 0` + `gcTime: 0` = the design's "fresh fetch on every open" (§2.6): every open is `isLoading` ⇒ deterministic skeleton→content transition; no stale roster flash; closing mid-fetch disables the query (rapid open/close safe).
- Return surface: `{ page, isLoading, isError, error, refetch }` (thin passthrough; NO Zustand — server data stays in React Query, ownership rule).
- The hook performs NO block filtering, NO visibility filtering, NO name synthesis — the payload is already privacy-final (D1/D2 server-side; bound by test T-8).

### 4.3 Component — `app-mobile/src/components/EventGuestListSheet.tsx` (NEW)

**Props (exact):**
```ts
{ visible: boolean; onClose: () => void; eventId: string | null;
  goingCount: number; onOpenConversation?: (conversationId: string) => void }
```
(`goingCount` feeds the header subtitle + the "and N more" math — passed by the host from the same momentum data the card rendered. `onOpenConversation` is an OPTIONAL override seam for tests/future hosts; the DEFAULT behavior is the §4.5 deep-link rail — when the prop is absent the sheet uses the rail directly.)

**BaseBottomSheet configuration — DESIGN §2.2 verbatim (BINDING), restated:**
- `visible={visible} onClose={onClose}` — ALL dismiss analytics (if any are ever added) live on `onClose` only.
- `snapPoints={GUEST_LIST_SNAP}` where `const GUEST_LIST_SNAP = ['70%']` is a module-level constant (EventAudienceSheet precedent, `MessageInterface.tsx:96`); `initialIndex` default 0; NO `enableDynamicSizing` (ORCH-1138 mismeasure class — chooser-sheet lesson).
- `wrapInRNModal` — z-stacks above the inline detail sheet + floating pill/bar (§2 assumption: no second RN Modal exists in any mount context).
- `theme="dark"` ALWAYS (app-chrome surface, never `palette.*` — design §2.2; brand theming ends at the event page).
- `scrollMode="flatlist"` + `scrollProps={{ data, renderItem, keyExtractor, contentContainerStyle, ListFooterComponent }}` — gorhom's own list container; NEVER a raw RN FlatList/ScrollView inside.
- `backgroundStyle={styles.guestSheetBackground}` — `#111418`, top radii 26, borderTopWidth 1, `rgba(255,255,255,0.10)` (design §2.2 exemplar parity).
- `accessibilityLabel="Who's going"`; `header={<GuestSheetHeader/>}` as the intrinsic-height sibling slot (ORCH-1043).
- `tabBarAware` OMITTED (false) + `hidesBottomNav` OMITTED (false) — wrapInRNModal sheets z-stack above the nav (BaseBottomSheet Bug-4 doc).
- `enablePanDownToClose` default true; backdrop default (dark 0.55); stock motion (NO `animationConfigs` — ORCH-1064).
- NO text input anywhere (no search in v1 ⇒ the ORCH-1171 keyboard apparatus is N/A by construction).
- NO `overlay` usage in v1 (nothing layers above the sheet); if any future feature must layer, it uses the `overlay` slot — NEVER a second RN `<Modal>` (COMMS-0084; bound by test T-9).
- Mounted UNCONDITIONALLY in each host with the `visible` flag driving it (exemplar posture `MessageInterface.tsx:2222`) — never conditionally `{visible ? <Sheet/> : null}` (that pattern re-mounts gorhom mid-gesture; the declarative primitive owns lifecycle).

**Header — DESIGN §2.3 (binding):** icon shell 42×42 r21 `colors.primary[500]` + Ionicon `people` 18 `#ffffff` (via `Icon` from `./ui/Icon`); title "Who's going" 20/800 `#ffffff`; subtitle `"{goingCount} going"` 13/600 `rgba(255,255,255,0.58)`; EventAudienceSheet header geometry (row, gap 12, paddingH 20, paddingTop 4, paddingBottom 18, hairline `rgba(255,255,255,0.08)`). Title `accessibilityRole="header"`.

**Row derivation (pure, in-file or a tiny local helper — display concerns only, never privacy):**
- Input `PeerGuestRow[]` → display sort per DESIGN §2.6 bands: ① You (`profileId === viewer id`) → ② named with `avatarUrl` → ③ named without → ④ `isMinglaUser === false` (unlinked guests) → ⑤ `isMinglaUser === true && isAnonymous` (private profiles). Stable within a band (payload order = server recency).
- keyExtractor: `profileId ?? `anon-${index}`` (anonymous rows carry no id — D8).
- Cap tail (DESIGN §2.6): when `goingCount > rows.length` → `ListFooterComponent` "and {goingCount − rows.length} more" 13/600 `rgba(255,255,255,0.48)` centered paddingV 16. (partySize seats beyond the row are honestly inside this arithmetic — D3.)

**Row anatomy + variants — DESIGN §2.4 (binding; restated skeleton):** minHeight 64, paddingV 8, hairline `rgba(255,255,255,0.06)`, paddingH 20; avatar 46×46 r23 (`ImageWithFallback` for photos, `onError` → initials/glyph fallback) + 12 gap + text column (flex 1, minWidth 0) + action zone. Variants exactly per the design table: named-with-photo / named-no-photo (initials disk `#eb7825`) / unlinked guest ("Guest", glyph disk, NO actions) / anonymous ("Someone" / "Keeping it low-key", glyph disk, NO actions — actions would deanonymize) / You (own row, "You", NO actions). Line 1 = `displayName ?? username ?? "Guest"` for named rows (16/700 `#f8fafc`, 1 line ellipsize); line 2 = `@{username}` or "On Mingla" when username null (12/600 `rgba(255,255,255,0.48)`).
- **Rows are NOT pressable (SEALED).** No `TouchableOpacity`/`Pressable` wraps the row container; ONLY the two action buttons are interactive. No profile-open (design §2.4 exclusion).

**Row actions — DESIGN §2.5 (binding); plumbing bound here:**
- Geometry: two trailing 40×40 circle buttons, `hitSlop` 4 (→48pt effective), icons 20px, 10 gap; pressed scale 0.96 + opacity 0.85; `HapticFeedback.medium()` on action fire.
- **Add-friend** (named rows where NOT already friends): `person-add-outline` accent style per design. State machine (all states designed §2.5, all bound):
  - initial cross-ref at open: `isFriend = friends.some(f => f.friend_user_id === row.profileId)` → button ABSENT; `pendingOutgoing = friendRequests.some(r => r.sender_id === viewerId && r.receiver_id === row.profileId)` → "Requested" chip from first paint (disabled, `accessibilityState={{disabled:true}}`); incoming-request-exists → default button (v1; Accept-chip flagged follow-up).
  - tap → in-flight (16px `ActivityIndicator` `#f97316`, disabled) → `await addFriend(row.profileId, "", row.username ?? undefined)` (the exact `useFriends().addFriend` signature — UUID path resolves email/username from the profile row server-side; `""` receiverEmail is correct on this path) → resolve = "Requested" chip; throw = revert to default + transient line-2 hint "Couldn't send — try again" (fade 120ms / hold 2500ms / fade 200ms; reduced-motion instant).
  - `addFriend` already invalidates `friendsKeys.requests` — no extra cache work in the sheet.
- **Message** (named rows): friends → live accent button; not-friends → visible LOCKED state (`rgba(255,255,255,0.28)` icon, no border) whose tap shows the line-2 hint "Add them as a friend to message" (D4/ORCH-0993 — the gate is KEPT; hint teaches the unlock). Live tap sequencing per §4.5.
- a11y per DESIGN §2.8: row = one accessible group ("Amara Okafor, at-amara, on Mingla" / "Someone, keeping it low-key" / "{name}, you"); buttons "Add {name} as a friend" / "Message {name}" (+ locked hint "Available once you're friends"); "Requested" chip announces "Friend request sent to {name}", disabled.

**States — DESIGN §2.7 (binding, all five):**
- **Skeleton** (query `isLoading`): 6 placeholder rows per design geometry; ONE shared opacity pulse 0.5↔1.0 1000ms/leg `Easing.inOut`, **`isInteraction:false`** (ORCH-1303 discipline — a loop must never hold an InteractionManager handle); reduced-motion static 0.7.
- **Gated mid-view** (`GuestListGatedError` — host flipped `privateGuestList` between card render and RPC): lock icon + "This guest list is private" / "The host keeps it just for the guests." NO action (closing is the action). This is an EMPTY state, not an error state.
- **Empty zero** (payload `guests.length === 0`): "No one yet" / "Someone has to be first."
- **Error + retry** (network / `GuestListUnavailableError` / generic): "Couldn't load the guest list" / "Give it another go." + Retry pill (44pt min, `colors.primary[500]`) → `refetch()` → skeleton.
- **Transitions:** skeleton→content/empty/error cross-fade 150ms ease-out (reduced-motion instant); NO row entrance stagger.

**testIDs (design §2.9):** `orch-1341-guest-sheet`, `-row-{key}`, `-add-friend`, `-message`, `-requested`, `-skeleton`, `-empty`, `-error-retry`, `-footer-more`.

### 4.4 Blocked pairs + anonymity (bindings restated as hard rules)

- Blocked pairs NEVER appear — **server-side exclusion is the ONLY filter** (1338 SC-6). The sheet/hook MUST NOT import `blockService` or re-filter rows (a client filter would mask server regressions and double-own the rule) — bound by T-8's source assertion.
- Anonymous rows (`isAnonymous: true`) render with NO actions and NO profileId (D8 — the payload carries none); the sheet must never attempt username-resolution or any identity recovery for them.
- Typed contact data (`guest_*`/`buyer_*`/`attendee_*`) cannot appear — 1338's whitelist; the sheet renders ONLY `displayName`/`username`/`avatarUrl` + the design's fixed strings.

### 4.5 Message-action sequencing + navigation (exact, and one design deviation flagged)

**Sequence on a LIVE Message tap (friends only):**
1. Button → in-flight (spinner in the 40pt circle, disabled).
2. `const { conversationId, error } = await messagingService.ensureConversation(viewerUserId, row.profileId)` (block-check + atomic RPC inside; returns, never throws).
3. **Failure** (`error` or null id): button reverts; transient line-2 hint "Couldn't send — try again" — the sheet STAYS OPEN (a closed sheet has no error surface).
4. **Success:** `onClose()` FIRST (sheet fully dismissed — the sealed close-before-NAVIGATE rule; kills sheet-under-navigation z-mess), then navigate:
   - default: `Linking.openURL(\`mingla://chat/${conversationId}?type=direct\`)` — rides the ONE parser (`deepLinkService.ts:130-136`) + root warm-link listener (`app/index.tsx:1671`) → Messages tab, that conversation (`deepLinkService.ts:302-315` landing). No new navigation plumbing, no second parser.
   - `onOpenConversation` prop present (test/override seam) → call it instead with the id.
5. The sheet does NOT call `sendFirstMessage` — no message exists to send from a list row; the conversation thread's composer owns composition (Q8: `sendFirstMessage` = compose-path helper). ⚠️ **Deviation flag (explicit, not silent):** DESIGN §2.5's literal text reads "close sheet first, then `ensureConversation` → navigate"; the SEALED dispatch clause is close-before-**NAVIGATE** only. Binding order here is ensure → close → navigate, because a post-close `ensureConversation` failure would have no error surface (state-completeness beats the design's letter; its intent — never navigate under an open sheet — is fully honored). If Seth prefers the design's literal order, the failure path must become a toast-class surface — a design change; stop-and-amend.

### 4.6 Tap wiring — BOTH momentum mounts on all three consumer screens

Each screen adds: `const [guestSheetVisible, setGuestSheetVisible] = useState(false)`, a `handleSeeWhosGoing = () => setGuestSheetVisible(true)` callback, and mounts `<EventGuestListSheet visible={guestSheetVisible} onClose={() => setGuestSheetVisible(false)} eventId={…} goingCount={…}/>` as a SIBLING inside the screen's existing root fragment (the proven posture — each screen already returns `<>…inline detail sheet…floating bar…</>`; the guest sheet joins as the last sibling).

| Screen | Wiring | eventId / goingCount source |
|---|---|---|
| `ConsumerEventDetailScreen.tsx` | RSVP branch: `rsvpConfig.onSeeWhosGoing = handleSeeWhosGoing` (the 1340 config field — reaches the inline `RsvpDecisionBox` mount; the floating bar has `showMomentum=false`, no cluster). Standard branch: `onSeeWhosGoing={handleSeeWhosGoing}` on `EventOfferingBody` (1340's passthrough). | RSVP: `rsvpPublicEvent.id` + `rsvpMomentum.goingCount`; standard: `seed.eventId` + `socialProofQuery.data.goingCount` |
| `ConsumerTripDetailScreen.tsx` | `onSeeWhosGoing` on `TripOfferingBody` (:936 mount) | the trip's event id (same id the 1339 socialProof query uses) + its goingCount |
| `ConsumerExperienceDetailScreen.tsx` | `onSeeWhosGoing` on `ExperienceOfferingBody` (:895 mount) | same pattern |

- Pass the handler ONLY when the card can render it usefully: gate the prop on `socialProof?.privateGuestList !== true && goingCount > 0` where the screen holds the payload (belt-and-braces — the card already suppresses the affordance for both cases per 1340 §4.3/§4.4; double-gating costs nothing and survives package regressions). Cold `/e/` route (seedless): the RSVP/standard branches degrade exactly as today (F-9b) — no wiring fires; 1342 owns the cold landing.

### 4.7 SHEET-REGRESSION GUARD SECTION (Q7 map — every class → the clause that prevents it → the check that proves it)

| # | Regression class (Q7/F-10) | Preventing clause in this SPEC/design | Proof |
|---|---|---|---|
| 1 | META-0991 — raw RN Modal sheets / second gorhom importer | BaseBottomSheet consumer only (§4.3); GHRV owned by the primitive | strict-grep `meta-orch-0991-base-bottom-sheet-sole-consumer` + T-9 |
| 2 | ORCH-0908/1315/COMMS-0084 — modal-over-modal drop | ONE `wrapInRNModal` sheet; hosts' detail sheets are INLINE (verbatim-proven §2); Message navigates AFTER close (§4.5); profile-open excluded; future layering = `overlay` slot only | T-9 source assert (no `<Modal` in the new files) + SC-R runtime proof |
| 3 | ORCH-1016 — nav painted over content | wrapInRNModal z-stacks above the nav; `hidesBottomNav`/`tabBarAware` both false (§4.3) | SC-R screenshots incl. nav region |
| 4 | ORCH-1040/1043 — header/body double-wrap | `header` = intrinsic sibling slot; body = primitive's own flatlist container (§4.3) | CI `orch-1043-sheet-scroll-viewport-check` + T-9 |
| 5 | ORCH-1064 — release-only half-open stall | stock motion, NO `animationConfigs` (§4.3) | T-9 source assert + SC-R rapid open/close ×5 |
| 6 | ORCH-1138 — dynamic-size mismeasure in RN-Modal wrap | fixed `['70%']` single detent; NO dynamic sizing (§4.3) | T-9 source assert |
| 7 | ORCH-1157 R8/R9 — Android bottom gap under wrapInRNModal | primitive-owned (the R13 screen-height fix lives in BaseBottomSheet); opaque `#111418` canvas; list paddingBottom 24 | SC-R Android bottom-edge screenshot |
| 8 | ORCH-1171 — keyboard in RN-Modal windows | NO text input in v1 (§4.3); search (if ever) ships WITH the 1171 apparatus | T-9 source assert (no `TextInput|BottomSheetTextInput`) |
| 9 | ORCH-1190/1191 — bottom fill to physical edge | primitive-owned + opaque canvas (design §2.9) | SC-R Android/iOS bottom screenshots |
| 10 | Dismiss-analytics split (BaseBottomSheet §3.1 rule) | any analytics live on `onClose` only (§4.3) | code review + T-9 |
| 11 | Ghost touch-blocker after close (COMMS-0084 corollary) | no overlay used; sheet unmount leaves nothing painted; verified interactivity after every dismiss path | SC-R step 4 |

### 4.8 Hook/component ownership notes
- No Zustand writes anywhere in this leg (server state in React Query only).
- No `console.log` debris; errors surface through the designed states.
- All new colors are the design's fixed dark-chrome values (app-chrome surface — rgba/hex sanctioned OUTSIDE the palette-bound package; matches the EventAudienceSheet family; RN color formats hex/rgba only).

## 5. Success criteria

- **SC-1-iOS / SC-1-Android:** tapping the cluster/link on a live RSVP event opens the sheet at 70% with header "Who's going / {n} going"; rows render named→anonymous per the §4.3 sort; named rows show real names/@usernames; anonymous rows show "Someone / Keeping it low-key"; unlinked show "Guest"; the viewer's own row shows "You" first.
- **SC-2-iOS / SC-2-Android:** same from the STANDARD event, TRIP, and EXPERIENCE detail screens (OfferingMomentum mounts) — 4 entry points total per platform.
- **SC-3:** Add-friend on a named row: tap → spinner → "Requested" chip; the request row exists in `friend_requests` (live SQL check); re-opening the sheet shows "Requested" from first paint (outgoing cross-ref). Failure (airplane mid-flight) reverts + shows the line-2 hint for ~2.5s.
- **SC-4:** Message on a FRIEND row: spinner → sheet fully closes → app lands in Messages on that conversation (the `mingla://chat/…?type=direct` rail) — no sheet remnant under the conversation, no dead backdrop. Message on a NON-friend row: locked visual; tap shows "Add them as a friend to message"; NO conversation is created (live DB check — zero `get_or_create_direct_conversation` effect).
- **SC-5:** already-friends rows show NO add-friend button and a LIVE message button; anonymous/unlinked/You rows show NO buttons; rows themselves never respond to taps (row-press = nothing).
- **SC-6:** gated mid-view — flip `privateGuestList` ON server-side, then tap a stale card: the sheet opens to the lock state ("This guest list is private"), never an error toast, never rows.
- **SC-7:** blocked pair — after blocking a listed guest, re-open: the guest is ABSENT (server exclusion); the client contains no block-filtering code (source assert).
- **SC-8:** cap tail — on `goingCount > rows.length` (plus-ones or >100 guests) the footer reads "and {diff} more"; header count stays the honest total.
- **SC-9:** offline / RPC failure → error state with Retry; Retry refetches to skeleton then content. Zero guests → "No one yet" state.
- **SC-R (RUNTIME SHEET PROOF — named criterion per Seth's standing caution; REQUIRED at TEST, screen-recorded):** on iOS simulator AND Android emulator, for EACH of the 4 entry points: (1) open — sheet renders ABOVE the inline detail sheet, floating bar/pill, and nav, at 70%, dark canvas to the physical bottom edge (no see-through band); (2) close via pan-down, backdrop tap, AND the Message navigation path — after each, the page underneath is fully interactive (tap a control to prove no ghost blocker); (3) rapid open/close ×5 — no half-open stall, no frozen backdrop; (4) evidence: `xcrun simctl io booted recordVideo` + Android screenrecord, attached to the TEST report. Source-only reasoning CANNOT satisfy SC-R (COMMS-0084: source reads wrongly clear modal-drop bugs).
- **SC-10:** all existing suites green with zero existing-test edits (no tests-append-only token needed in this leg — new test files only); strict-grep `meta-orch-0991`, `orch-1043`, `orch-1303` green.
- **SC-11:** a11y — VoiceOver/TalkBack reads header → rows (grouped labels) → footer; buttons announce per §4.3; locked message button announces the hint; targets ≥44pt (rows 64, buttons 48 effective, retry ≥44).

## 6. Invariants

**Preserved (ID + how + verifying check):**
- **I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER:** the sheet imports `BaseBottomSheet` (and nothing from `@gorhom/*`); strict-grep stays green.
- **COMMS-0084 / ORCH-1315 layering rule:** no second RN Modal ever; `overlay` slot is the only sanctioned future layering; T-9 + SC-R.
- **ORCH-1043 header-sibling / ORCH-1064 stock-motion / ORCH-1138 fixed-snap / ORCH-1016+Bug-4 nav rules:** §4.3 config lines; §4.7 table.
- **ORCH-0993 friend-gated messaging (D4):** locked state + hint; non-friends can never reach `ensureConversation` (button state machine); SC-4.
- **ORCH-1303 isInteraction:** the skeleton pulse loop carries `isInteraction:false`; T-9 asserts it wherever `Animated.loop|timing` appears in the new files.
- **I-PROPOSED-1340-GUEST-IDENTITY-PRIVACY-GATED (DRAFT, successor):** names render ONLY in this authed sheet; anonymous rows carry no identity and no actions; privateGuestList suppresses the list server-side (the sheet renders the gated state, never a bypass). Verified by SC-6/SC-7 + 1338's server tests.
- **I-PROPOSED-1338-PEER-GUEST-READ-GUARDED:** consumed as designed — authed RPC, cap 100, no client-side widening (single fetch, no offset-walking in v1).
- **Constitution #4 (query keys from factories):** `guestListKeys` in the central factory file; T-9 asserts the hook contains no literal `['eventGuestList'` string outside the factory import.
- **Constitution #9 (nothing fabricated):** every rendered name/avatar comes from the payload; fixed strings are the design's copy; no synthesized identities.
- **Zustand-persist rule:** untouched (no client-store writes).

**Proposed NEW (DRAFT — orchestrator flips at CLOSE):**
- **I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY (DRAFT):** guest-list rows are never pressable; the ONLY interactive elements are the per-row Add-friend and Message buttons; anonymous rows expose no actions; profile-open from the sheet (if ever added) must use the BaseBottomSheet `overlay` slot, never a second RN Modal and never a row tap.
- **I-PROPOSED-1341-MESSAGE-CLOSE-BEFORE-NAVIGATE (DRAFT):** any navigation triggered from inside a wrapInRNModal sheet completes the sheet's `onClose` BEFORE the navigation fires; conversation landing rides the one deep-link rail (`mingla://chat/{id}?type=direct` → `parseDeepLink`), never a second parser.

## 7. Test cases (happy / error / edge + adversarial)

| # | Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|---|
| T-1 | happy roster | live RSVP event, mixed guests (named w/ + w/o photo, private, unlinked, You) | open sheet | §4.3 sort bands; variants per design table; header count | runtime/live |
| T-2 | add-friend happy | named non-friend row | tap add | spinner → Requested; `friend_requests` row live; reopen → Requested at first paint | runtime + data/live |
| T-3 | add-friend failure | airplane mode mid-tap | tap add | revert + "Couldn't send — try again" 2.5s; no crash | runtime/sim |
| T-4 | message friend | friend row | tap message | ensure → close → land in the DM (SC-4); recorded | runtime/live |
| T-5 | message locked | non-friend row | tap message | hint shown; sheet stays; NO conversation created (DB check) | runtime + data/live |
| T-6 | message ensure-failure | block created server-side just before tap (race) | tap message | `ensureConversation` returns error → hint, sheet OPEN (deviation contract §4.5) | runtime/live |
| T-7 | gated mid-view flip | flip privateGuestList ON, tap stale card | open | lock state, not error; close cleanly | runtime/live |
| T-8 | blocked pair + no client re-filter | viewer blocks guest X; source scan | reopen + deno assert | X absent (server); new files import no `blockService`, contain no visibility/block filter logic | live + unit |
| T-9 | source contract (deno) | new component + hook + service files | source asserts | no `<Modal\b`, no `@gorhom/` import, no `TextInput`, no `animationConfigs`, no `enableDynamicSizing`, no raw `<FlatList`, no `connectionsService`, `wrapInRNModal` present, `['70%']` const, `guestListKeys.` usage (no literal key), `isInteraction: false` with any Animated, row container not wrapped in Touchable/Pressable, `sendFirstMessage` NOT called | unit (deno) |
| T-10 | rapid open/close | ×5 fast toggles + close mid-skeleton | stress | no stall/ghost backdrop; query disabled on close; fresh skeleton each open (gcTime 0) | runtime/sim |
| T-11 | offline / retry | RPC blocked | open → Retry | error state → skeleton → content | runtime/sim |
| T-12 | anonymous rows | private-profile guests present | open | "Someone / Keeping it low-key", glyph, NO buttons, a11y group label | runtime/live |
| T-13 | cap tail | seeded >100 guests OR plus-ones | open | ≤100 rows; "and N more" math = goingCount − rows | data/live + runtime |
| T-14 | entry-point sweep | all 4 mounts × iOS + Android | Maestro (`--device <iOS UDID>`) + emulator | SC-2 + SC-R protocol, recorded | runtime |
| T-15 | a11y sweep | VoiceOver/TalkBack | navigate sheet | SC-11 labels/order/targets | runtime |

## 8. Implementation order

1. `socialProofService.ts` — `fetchPeerGuestList` + typed errors (§4.1).
2. `queryKeys.ts` — `guestListKeys` factory; then `useEventGuestList.ts` (§4.2).
3. `EventGuestListSheet.tsx` — config → header → rows/variants → actions state machine → states (§4.3), design §2 open beside it.
4. Screen wiring ×3 (§4.6): event → trip → experience.
5. Tests T-9 (deno source suite) + adversarial file; typecheck + lint.
6. Runtime pass on iOS sim + Android emulator (SC-R protocol, recorded) — the implementor performs a first-pass proof; the TESTER independently repeats it (never trust the implementor's recording alone).
7. Fails-on-revert demonstrations (§9). NO deploy/OTA (orchestrator owns SHIP; consumer OTA per-platform at CLOSE).

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguard:** `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` (+ `orch_1341_guest_list_sheet_adversarial.test.ts`) — the T-9 source-structure suite. Named revert catches:
1. Wrap the sheet in a raw RN `<Modal>` / import gorhom directly → T-9 FAILS (+ strict-grep 0991).
2. Make rows pressable (Touchable/Pressable around the row container) → T-9 row-press assertion FAILS (I-PROPOSED-1341-GUEST-SHEET-ACTIONS-ONLY).
3. Re-order Message to navigate-before-close (drop the `onClose()` call preceding `Linking.openURL`) → adversarial sequence assertion (source-order: `onClose` token precedes the `openURL` token within the message handler) FAILS.
4. Add client-side block/visibility filtering → T-8 source assertion FAILS (server-authority rule).
5. Hardcode the query key (`['eventGuestList'` literal in the hook) → T-9 factory assertion FAILS (Constitution #4).
6. Add `enableDynamicSizing` / custom `animationConfigs` / a `TextInput` → T-9 FAILS (regression classes 5/6/8).
7. Call `sendFirstMessage` or import `connectionsService` → T-9 FAILS (Q8 compose-path rule; F-13 ban).
Each family demonstrated red-then-green (sed-strip in a scratch copy) in the implementation report.

**Protective comments:** the sheet's header comment names the EventAudienceSheet posture, COMMS-0084 (overlay slot, never a second Modal), the sealed rows-not-pressable and close-before-navigate decisions, and this SPEC; the hook's comment names `guestListKeys` + the fresh-fetch-per-open rationale (gcTime 0).

**CI note:** all test files in this leg are NEW (append-only-safe; no token). The `orch-1043-sheet-scroll-viewport-check` and `meta-orch-0991` strict-greps bind the new component automatically.

## 10. Open questions

1. **§4.5 sequencing deviation** (ensure → close → navigate vs the design's literal close → ensure → navigate) — bound here for state-completeness; sealed close-before-NAVIGATE fully honored. Flag to Seth at review; changing it requires a failure-surface redesign (stop-and-amend).
2. **Key-factory drift (flagged, no action in this leg):** SPEC-1339 §4.6 binds literal `["socialProof", eventId]` keys (in-file sibling precedent), while this leg uses the central factory per Constitution #4 and the dispatch. Both work; the inconsistency is real. Recommend a hygiene follow-up ORCH to migrate `rsvpMomentum`/`socialProof` literals into `queryKeys.ts` — NOT done here (out of scope; 1339's files are DO-NOT-TOUCH).
3. **Incoming-request "Accept" chip** (design §2.5 flagged upgrade via `accept_friend_request_atomic`) — deliberately NOT in v1; register a follow-up if Seth wants it.
4. **`onOpenConversation` override prop** (§4.3) — included as a test seam with the deep-link rail as default. If the tester proves the warm-link rail lands correctly from ALL mount contexts (incl. trip/experience screens' route stacks), the prop may be dropped at a later cleanup; keep it for v1 (cheap, structurally honest). If the rail FAILS from any mount context at TEST (e.g. expo-router stack ordering), the amendment path is: thread `onOpenConversation` from that route file with an explicit `router.dismissTo('/')`-style hop — stop-and-amend, do not improvise a second parser.

## 11. Downstream routing

- **Next: mingla-implementor** — build exactly this contract in the META worktree (`~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]`, branch `META-ORCH-1337-social-proof-guest-list`). Dependencies: 1338 applied-or-frozen (the RPC contract), 1339 + 1340 landed on the branch (config seams + `onSeeWhosGoing` passthroughs). Stop-and-amend on ANY file outside the allowlist.
- **Then: mingla-tester** — §7 table with SC-R as a HARD gate: independent runtime open/close/z-index proof on iOS sim + Android emulator across all 4 entry points, recorded; live-fire add-friend/message against prod with a test account pair (never mutate the F-11 live host's data beyond reads + a self-owned test event); adversarial T-5/T-6/T-7/T-8/T-10/T-13 mandatory. Physical-device pass per house rules before CLOSE.
- **Then: orchestrator SHIP/CLOSE** — merge in the META PR (ALL CI green), consumer per-platform OTA (never `--platform all`), flip I-PROPOSED-1341-* DRAFTs ACTIVE, sync WORLD_MAP, route ORCH-1342 (web funnel — reuses this sheet via the deferred-link landing param) next.

---

## Scoped allowlist (the implementor may create/modify ONLY these)

1. `app-mobile/src/components/EventGuestListSheet.tsx` (NEW)
2. `app-mobile/src/hooks/useEventGuestList.ts` (NEW)
3. `app-mobile/src/hooks/queryKeys.ts` (append the `guestListKeys` factory ONLY — no other line)
4. `app-mobile/src/services/socialProofService.ts` (append `fetchPeerGuestList` + its typed errors ONLY)
5. `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (sheet state + mount + `onSeeWhosGoing` wiring in both branches)
6. `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (same)
7. `app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (same)
8. `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet.test.ts` (NEW)
9. `app-mobile/src/components/__tests__/orch_1341_guest_list_sheet_adversarial.test.ts` (NEW)

## DO-NOT-TOUCH (stop-and-amend before touching ANY of these)

- `app-mobile/src/components/ui/BaseBottomSheet.tsx` (the primitive is consumed, never adjusted) and `MessageInterface.tsx` (exemplar is read-only).
- `app-mobile/src/hooks/useFriends.ts`, `useFriendsQuery.ts`, `src/services/{friendsService,messagingService,blockService,deepLinkService,supabase}.ts` — consume-only; the `mingla://chat` parse form already exists.
- `app-mobile/src/services/connectionsService.ts` — BANNED (F-13); zero imports.
- `packages/offering-rendering/**` — ALL of it (1340 shipped the seams; the sheet lives app-side).
- `supabase/**` (1338 frozen), `mingla-business/**` (web tap = 1342), `mingla-admin/**`.
- EVERY existing test file (this leg adds files only; no tests-append-only token exists for this leg — if you believe an existing test must change, STOP: that is a SPEC amendment, not a token request).
- `app/index.tsx`, `app/e/[brandSlug]/[eventSlug].tsx`, `oneLinkResolver.ts`, `appsFlyerService.ts` (1342's territory).
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (orchestrator writes at CLOSE), `COMMS_LEDGER.md`, `WORLD_MAP.md`.
