# SPEC — ORCH-1163 · [rsvp-shared-body] · ONE shared shell-agnostic RSVP body (FINAL, AMENDED)

**META:** META-ORCH-1166 — public offering-page single source of truth. **LEG 2 of 4 (RSVP).**
**Pattern source (binding precedent):** ORCH-1167 [event-page-canonical] / DEC-189 — LEG 1 (standard ticketed event). This spec REPLICATES that proven playbook for `event_type='rsvp'`, then EXTENDS it with three Seth-confirmed flows (A Going-confirmation, B per-guest plus-one contacts, C consumer Calendar-tab RSVP card + QR).
**Inputs read:** `INVESTIGATE_ORCH-1163_RSVP_PUBLIC_PAGE_SOT.md` (3 render paths, 2 bodies), DEC-189, ORCH-1167-R3 canonical event structure (full-width date row + solid-fill pills row in `EventOfferingBody.tsx`), the live `RsvpPublicBody.tsx` / `EventOfferingBody.tsx` / `RsvpMomentumDecision.tsx` / `usePublicEventBySlug.ts` / `pg_public_event_by_slug.sql` / `ConsumerEventDetailScreen.tsx` RSVP branch / `rsvpDeckService.ts`, and the RSVP backend (`event_rsvps` table `20261004000000_orch_1150_rsvp_events.sql`, `submit_event_rsvp` RPC, `public-submit-rsvp` edge fn), the consumer Calendar (`CalendarTab.tsx` `UnifiedRow` union + `BusinessEventCalendarRow.tsx` + `TicketPdfSheet.tsx` + `calendarService.ts`), and the signed ticket-QR pattern (`mingla:v1:ticket:<id>:sig:<hmac>` from `biz_ticket_checkout_qr_payload`, scanned by `biz_ticket_scan`).
**Status:** SPEC — FINAL binding contract (AMENDED from e2a9f2017 — adds §J: each plus-one is a FIRST-CLASS invited guest with its OWN per-guest QR token + email + push, plus a Mingla-account match → the plus-one's OWN consumer Calendar card). DO NOT implement from this header; implement from §0 (canonical structure) + §A–§K (body/wiring/read/flows A·B·C + §J per-guest pass/notify/match/calendar/invariants/manifest/tests) + §13.
**AMENDMENT (this commit, Seth-confirmed):** OQ-5/6/7 LOCKED (see end). NEW §J expands flow B+C: per-guest QR token (party of N → N passes), email-with-ticket to EVERY plus-one (Mingla user or not), push to MATCHED plus-ones + primary, and a Mingla-account match (verified `auth.identities`/phone, ORCH-1111/1112 pattern) → the matched plus-one's event appears in THEIR consumer Calendar tab with THEIR own QR. Reuses the EXISTING email infra (`rsvp-notify` + `_shared/email/*`), push infra (`notify-dispatch` + `_shared/push-utils.ts`), and identity-match (`_shared/trustedCallerEmail.ts`) — NO parallel notification system.
**Branch/worktree:** `ORCH-1163-rsvp-shared-body` off latest merged main (one rendering package `@mingla/offering-rendering`; `event-rendering` dissolved by ORCH-1169).

---

## 0. SETH'S CANONICAL CONTRACT (THE binding structure — identical on buyer-web + business iOS/Android + consumer iOS/Android)

The RSVP public page is a **9-section vertical order**, byte-identical on every surface, mirroring the ORCH-1167-R3 event page styling exactly:

1. **Cover** — full-bleed; video covers autoplay+loop via the imperative-DOM `EventCoverMedia` (DEC-189). Surface-pinned (not body-owned).
2. **Event Name** — bold title (`styles.leadBlock`/`styles.title` parity with `EventOfferingBody`).
3. **Date & Time** — AM/PM-formatted strings, rendered as a **FULL-WIDTH row** (`alignSelf:"stretch", width:"100%"`, `accentWash` fill + `panelBorder`, testID parity with `orch-1167-date-row`), matching the event page's final R3 styling (DEC-189).
4. **Pills row** — event format → **ALL** vibes → **ALL** party types → **ALL** music genres, each a solid-fill `<Pill>` (`accentWash`/`panelBorder`, radius 999) in one flex-wrap row, matching `EventOfferingBody`'s `pillsRow`. **NO "tickets left" pill** (RSVP has no tickets). The party chips that today live INSIDE the momentum unit (`RsvpMomentumDecision` `styles.chips`) are PROMOTED into this canonical pills row.
5. **Going / Maybe / Not-going box** — **INLINE** on the page (a discrete section in the flow, mirroring the event page's inline ticket-box position between pills and Presented By), built on the shared `RsvpMomentumDecision` (inline variant with `showDecision`). User picks status + adds PLUS-ONES (now per-guest, flow B).
6. **Presented By box** — `<Brand>` "Presented by {displayName}" tile, tappable → `onOpenBrand(slug)` (parity with `EventOfferingBody` `brandRow`).
7. **About toggle** — collapsible `event.description` (parity with `EventOfferingBody` About, 160-char threshold, Read more/Show less).
8. **Where you'll be** — Mapbox **static map** (server-proxied `static-map` edge fn, no token) + "Open maps" / "view on map" card; **city-level when the address is hidden** (server-side privacy — §C, mirror the event leg).
9. **Floating Going / Maybe / Not-going button** — persistent overlay, mirrors the inline box (§5), surface-pinned (parity with `EventOfferingFloatingBar`). The decision dock node is exported as `RsvpOfferingDecisionDock`.

**This 9-section order is the contract.** §3 below (the legacy `RsvpPublicBody` section list) is retained ONLY as the migration source-of-truth; where §3 and §0 differ, §0 WINS (the body is re-ordered/re-styled to §0 — full-width date row, promoted pills row, inline decision box, R3 pill fills).

---

## 1. Problem (one line)
The RSVP public page has THREE render paths but TWO distinct bodies: buyer-web + business share `mingla-business/src/components/event/RsvpPublicBody.tsx`; the consumer app FORKS it as a hand-mirrored RSVP branch in `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`; and the read path is split (web reads `business_public_events_view` via the adapter; consumer reads the same view via `rsvpDeckService.fetchRsvpMomentum` + builds props from the deck seed). The body lives in `mingla-business/src/` so `app-mobile` cannot import it → forced fork → drift risk. This is the exact gap ORCH-1167 already solved for the standard event.

## 2. Goal (the contract, in one paragraph)
Promote `RsvpPublicBody` into `packages/offering-rendering` as ONE shared, **shell-agnostic** RSVP body named **`RsvpOfferingBody`**, rendered byte-identically on buyer-web + business iOS/Android + consumer iOS/Android. RETIRE the consumer hand-mirror (the `ConsumerEventDetailScreen` RSVP branch mounts `RsvpOfferingBody`). UNIFY the read path behind ONE canonical anon RPC `pg_public_rsvp_by_slug`. PRESERVE every single-owner already in place: the shared `RsvpMomentumDecision`, `resolveRsvpCta`, the `submitPublicRsvp → public-submit-rsvp` write path, the ORCH-1150 maybe=cap-neutral/auto-approve rules, and the ORCH-1157 Direction-C momentum redesign. NO ticket box (RSVP is money-free); the decision surface stays the Going/Maybe/Can't `RsvpMomentumDecision` + the contact/submit flow.

---

## 3. Current `RsvpPublicBody.tsx` SECTION LIST (migration source-of-truth — RE-ORDERED to §0)
> **SUPERSEDED BY §0 for final structure.** This list is the migration baseline: it documents the state-machine + testIDs to preserve. The FINAL vertical order/styling is §0 (full-width date row, promoted solid-fill pills row, inline decision box, R3 pill fills). The implementor preserves the state machine + testIDs below but re-orders/re-styles content to §0.

Read at `mingla-business/src/components/event/RsvpPublicBody.tsx` @ this branch. The body currently OWNS its scroll/cover via `ParallaxCoverShell` (this is the non-shell-agnostic part to dissolve). The CONTENT, in render order:

1. **Cover** — `ParallaxCoverShell` (pinned parallax cover; X · Share · Mute chrome; `hideCloseOnWeb`; hero eyebrow = `event.dateLine`, hero title = `event.name`; `showMute` only when `coverMediaType==='video'`). Video covers already render through `EventCoverMedia`'s imperative-DOM web `<video>` (DEC-189) via the shell — KEEP this path.
2. **Brand card** — `<Brand>` "Hosted by {displayName}", tappable → `onOpenBrand(slug)`.
3. **Direction-C inline momentum** (phone only, `!isDesktop`) — `RsvpMomentumDecision variant="inline" showMomentum showDecision={false}`: going COUNT + capacity METER + anonymous faceless cluster + "You're invited" kicker + party-type vibe chips. (Desktop hosts this in the sticky panel.)
4. **Contact form** — `<RsvpField>` × 3 (name / email / phone, all REQUIRED for Going+Maybe — A4-NEW); shown only for a logged-out guest in an unresolved, contact-eligible state. Email/phone regex validation; inline field errors.
5. **Inline error** — `errorNode` (phone places it with the form; desktop in the panel).
6. **Date fact pill** — `event.dateSubline` row (clock glyph, `surface.card`).
7. **Doors pill** (ORCH-1157 Issue 4) — `config.doorsOpenLabel` / `doorsCloseLabel` → "Doors open X · Doors close Y" in its own pill; REAL-DATA-ONLY (open-only if close null; omitted if no open). Built by adapter via `formatEventDoorsTimes`.
8. **Venue / "Where you'll be"** — `<Venue>`: venue name + address line + Open-in-maps deep link, with **address privacy** (`hideAddressUntilTicket` → City/Country only until the viewer's OWN RSVP is going/maybe; `addressUnlockCaption` "Full address shared once you're going"; "Online event" when `format==='online'`). `venueMapsQuery` null unless revealed.
9. **About** — `event.description` card (rendered when non-empty).
10. **Decision (HERO)** — `RsvpMomentumDecision` as: phone → bottom **floating dock** (`variant="floating-dock"`, pinned absolute, `testID="orch-1157-rsvp-floating-dock"`); desktop → **sticky right panel** (`variant="sticky-panel"`, with `hostRow` + momentum + error). Carries Going / Maybe / Can't + plus-ones stepper (when `allowPlusOnes`); resolved-state subcopy (pending / waitlisted / going / maybe / not_going / full).

**State machine preserved verbatim:** `capacityFull` → `resolveRsvpCta` → `ctaState`; `guestStatus`/`guestApproval` after submit; `showContactForm` gate; `contactReady` gate (logged-in OR name+valid-email+valid-phone); `submit()` haptics + error-code mapping (`rsvp_contact_required` / `rsvp_phone_invalid` / `rsvp_full` / `rsvp_not_open`); `contentBottomInset` scroll-runway (ORCH-1150 R2 D-7b, default 96).

---

## A. The new shared `RsvpOfferingBody` (offering-rendering)

### A.1 File + export
- **New file:** `packages/offering-rendering/RsvpOfferingBody.tsx`.
- **Barrel:** export `RsvpOfferingBody` + `RsvpOfferingBodyProps` + `RsvpOfferingConfig` from `packages/offering-rendering/index.ts` (alongside `RsvpMomentumDecision`).
- Mirrors `EventOfferingBody` exactly in altitude: pure-presentational, props-only, NO app-`src/` imports (I-MOR-0827-PACKAGE-ISOLATION — the META-ORCH-0827 packages gate already covers this directory). Renders on react-native-web AND native RN.

### A.2 SHELL-AGNOSTIC contract (mandatory — the core transformation)
`RsvpOfferingBody` is a **PURE CONTENT body**. It hosts **NO scroll root and NO cover host**. It must NOT wrap `ParallaxCoverShell` (that is what `RsvpPublicBody.tsx` does today and is precisely what is being dissolved). Instead:
- The **cover** (section 1) is a **pinned sibling the surface scaffold owns** — exactly as `EventOfferingBody` does. On web + business native the surface wraps the body in `ParallaxCoverShell` (RN ScrollView host); on consumer the surface pins `EventCoverMedia` behind a gorhom `BottomSheetScrollView`.
- The **decision HERO** (the floating dock on phone / sticky panel on desktop) is exposed for the surface to position, mirroring how `EventOfferingBody` exposes `EventOfferingFloatingBar`. **Export `RsvpOfferingDecisionDock`** (the phone floating-dock node) and accept a `stickyPanel`-style desktop node, so the surface scaffold pins the dock as an overlay and the desktop panel goes into the shell's `stickyPanel` slot. The body's content View must remain the FIRST shell child (the ORCH-1150 R2 parallax-layering safety-net test).
- The body renders sections 2–9 (content) as its children; section 1 (cover) and section 10 (dock/panel) are surface-pinned.
- **Why a sub-export (not just children):** the consumer's gorhom scroll structure (`BottomSheetScrollView` inside `BaseBottomSheet`) is the LOAD-BEARING ORCH-1016/1043/1138 scaffold; the body wrapping `ParallaxCoverShell` re-triggers the gorhom freeze. The body must NEVER own the scroll root.

### A.3 Cover video — imperative-DOM (DEC-189, non-negotiable)
Cover video on web MUST be rendered via the imperative `document.createElement('video')` path. This is satisfied by reusing the SHARED `EventCoverMedia` from `@mingla/offering-rendering` (its `EventCoverWebVideo` already creates the `<video>` imperatively into a container ref so React never owns the node — WebKit permanently denies inline muted autoplay to a React-rendered `<video>`). The RSVP cover flows through `ParallaxCoverShell` (web/business) and through a directly-pinned `EventCoverMedia` (consumer), both of which already use the imperative primitive. **DO NOT introduce a React-rendered `<video>` anywhere in this leg.** `showMute` only when `coverMediaType==='video'`.

### A.4 Full prop contract
```ts
export interface RsvpOfferingConfig {
  capacity: number | null;
  goingCount: number;
  allowPlusOnes: boolean;
  plusOnesMax: number;
  waitlistEnabled: boolean;
  manualApproval: boolean;        // = (rsvp_approval_mode === 'manual')
  doorsOpenLabel?: string | null; // tz-aware, adapter-built; REAL-DATA-ONLY
  doorsCloseLabel?: string | null;
}

export interface RsvpOfferingBodyProps {
  event: PublicEventProps;        // shared offering-rendering type (already RSVP-tolerant)
  brand: PublicBrandProps | null;
  palette: ThemePalette;
  theme: ResolvedTheme;
  config: RsvpOfferingConfig;
  isLoggedIn: boolean;            // true → skip contact form (profile supplies contact)
  // contact + submit (the SINGLE write path — see §D, EXTENDED for per-guest plus-ones §H):
  onSubmit: (input: {
    rsvpStatus: "going" | "not_going" | "maybe";
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    plusCount: number;            // = guests.length (kept for back-compat + capacity math)
    guests: Array<{ name: string; email: string; phone: string }>; // NEW §H — per plus-one contact, length === plusCount
  }) => Promise<{
    status: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus: "pending" | "approved";
    rsvpId: string;               // NEW — the persisted event_rsvps.id (for the success popup + Calendar QR)
    confirmationToken: string | null; // NEW §I — the signed QR/entry token for a going RSVP (null for maybe/not_going)
  }>;
  // NEW §G — Going-confirmation + success popup are OWNED by the body (shared, shell-agnostic):
  //   tapping Going opens RsvpGoingConfirmDialog → on confirm calls onSubmit → on success shows RsvpSuccessPopup
  //   with the reservation details. Maybe / Not-going call onSubmit directly with NO dialog.
  // surface callbacks (identical to RsvpPublicBody today):
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  // cover-chrome (forwarded by the surface to ParallaxCoverShell / pinned cover):
  muted: boolean;
  onToggleMute: () => void;
  onClose: () => void;
  onShare: () => void;
  // scroll plumbing (forwarded to the surface scaffold):
  contentBottomInset?: number;   // default 96 (ORCH-1150 R2 D-7b runway)
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollViewLayout?: (e: LayoutChangeEvent) => void;
  safeAreaTop?: number;
  safeAreaBottom?: number;
  testID?: string;
}
```
**Decision on cover ownership:** since the surface owns the cover (shell-agnostic), the cover-chrome props (`muted`/`onToggleMute`/`onClose`/`onShare`/`coverMediaUrl`/`coverMediaType`/`coverHue` from `event`) are forwarded by the body to the shell it is composed INTO. Implementation choice (binding): the body renders sections 2–9 as content + exposes `RsvpOfferingDecisionDock(props)` + a `desktopStickyPanelNode`. The surface wrapper (web/business `FoundationRsvpPreview`-style thin wrapper, or the consumer screen) composes `ParallaxCoverShell`/pinned-cover around it and pins the dock — exactly the `FoundationEventPreview` + `ConsumerEventDetailScreen` seam ORCH-1167 established. Preserve all `testID`s verbatim (`orch-1150-rsvp-*`, `orch-1157-rsvp-*`) so existing guards stay green.

### A.5 What MUST NOT change
No price / Reserve / cart / checkout affordance anywhere (I-PROPOSED-1157-RSVP-NO-CHECKOUT-AFFORDANCE). Social proof stays count + meter + faceless cluster ONLY — no guest names/faces, no public maybe/waitlist count (I-PROPOSED-1157-RSVP-SOCIAL-PROOF-ANON-ONLY). Android opaque card fills (ANDROID_GLASS_USES_OPAQUE_FALLBACK) — already honored inside `RsvpMomentumDecision` + the `surface.card` fills.

---

## B. Per-surface wiring

### B.1 buyer-web + business native (already-shared path)
- `mingla-business/src/components/event/PublicEventPage.tsx` RSVP branch (`isRsvp`, ~L585) currently mounts `<RsvpPublicBody>` directly. Repoint it to a thin surface wrapper (recommended name **`FoundationRsvpPreview`**, mirroring `FoundationEventPreview`) that composes `ParallaxCoverShell` (RN ScrollView host) around `RsvpOfferingBody` and pins `RsvpOfferingDecisionDock` on phone / passes the desktop panel to the shell `stickyPanel`. The adapter keeps owning: `rsvpSubmit` (→ `submitPublicRsvp`), `rsvpDoors` (`formatEventDoorsTimes`), `<Head>`/SEO, `ShareModal`, `Toast`. No behavior change for the web/business surface — same pixels.
- **`RsvpPublicBody.tsx` becomes a thin re-export wrapper OR is deleted.** Preferred: DELETE `RsvpPublicBody.tsx` and update its 2 callers (`PublicEventPage.tsx`, `mingla-business/app/rsvp/[id]/preview.tsx`) to mount `FoundationRsvpPreview`. The existing `RsvpPublicBody.*.test.ts` files retarget to `RsvpOfferingBody` (move into `packages/offering-rendering/__tests__/`). The host PREVIEW route (`preview.tsx`) renders the SAME wrapper (its draft→`PublicEventProps` mapper is unchanged).

### B.2 consumer (retire the hand-mirror)
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`: the RSVP branch (`isRsvp`, the `<>…</>` block at ~L1079 onward + the bespoke `rsvpDock` / `rsvpMomentumUnit` / `brandNode` / `aboutNode` / `venueNode`) is REPLACED by mounting `<RsvpOfferingBody>` inside the existing gorhom scaffold: the body's content goes inside `<BottomSheetScrollView>` (the same scroll host the standard-event branch uses for `EventOfferingBody`), the cover stays the pinned `EventCoverMedia` sibling (section 1), and `RsvpOfferingDecisionDock` is pinned as the bottom overlay (replacing the bespoke `rsvpDock`).
- The screen keeps: `handleRsvp` → `submitDeckRsvp` wired into `onSubmit`; `isLoggedIn = user !== null` (`contactReady` resolves true for signed-in app users, so the contact form is skipped — parity with today); the live going-count/capacity from the unified read (§C).
- **Net deletion:** the hand-mirrored RSVP-only nodes (`rsvpDock`, `rsvpMomentumUnit`, RSVP-branch `brandNode`/`aboutNode`/`venueNode`, the RSVP-specific address-privacy block) collapse into the shared body. The standard-event branch (`EventOfferingBody`) is UNTOUCHED. Keep the consumer's deck-card warm-open seed as the fast path but feed the body from the unified read once it resolves.

### B.3 Shell ownership summary
| Surface | Scroll host | Cover | Decision |
|---|---|---|---|
| buyer-web | `ParallaxCoverShell` (RN ScrollView, web) | shell pinned, imperative-DOM video | desktop sticky panel / phone floating dock |
| business iOS/Android | `ParallaxCoverShell` (RN ScrollView) | shell pinned | phone floating dock |
| consumer iOS/Android | gorhom `BottomSheetScrollView` | pinned `EventCoverMedia` sibling | phone floating dock overlay |

---

## C. The ONE canonical read path

### C.1 Decision: NEW RPC `pg_public_rsvp_by_slug` (recommended — see §C.3 rationale)
Add migration `supabase/migrations/2026XXXXNNNNNN_orch_1163_pg_public_rsvp_by_slug.sql` modeled byte-for-byte on `pg_public_event_by_slug` (DEC-189 / ORCH-1167 mig 2). Signature:
```
pg_public_rsvp_by_slug(p_brand_slug text, p_event_slug text) RETURNS json
```
- **Restricted to `event_type = 'rsvp'`** (mirror the event RPC's `event_type='event'` filter; same public/status/deleted guards: `visibility='public'`, `status = ANY('scheduled','live','ended','cancelled')`, `deleted_at IS NULL`).
- **NO `tickets` aggregate.** Instead returns the RSVP host-control block: `rsvpGoingCount`, `rsvpCapacity`, `rsvpAllowPlusOnes`, `rsvpPlusOnesMax`, `rsvpWaitlistEnabled`, `rsvpApprovalMode` (these are real `events.*` columns, ORCH-1150 mig). Reuse the event RPC's identity/description/date/cover/brand/pills (party_types/vibe_tags/music_genres)/city projections verbatim. Include `masterStartAt`/`masterEndAt`/`timezone` so the adapter can build doors labels.
- **Address privacy SERVER-SIDE (mirror the event leg exactly, I-PROPOSED-1167-CITY-LEVEL-MAP-NO-EXACT-PIN-WHEN-HIDDEN):** omit `address` + exact `location_geo` when `hide_address_until_ticket` is true; return only `city` + `city_geo`. The anon RPC NEVER emits an exact pin for a hidden-address RSVP. NOTE the RSVP reveal gate differs at the CLIENT (going/maybe reveals, not "ticket purchase") — but the RPC's anon read is identical: an anon viewer with no resolved RSVP gets city-only. (Post-RSVP street reveal for a going/maybe viewer rides the client `addressRevealed` logic already in the body + remains OQ-2: a server-authenticated post-RSVP unlock path is OUT of scope here, identical carve-out to ORCH-1167 OQ-2.)
- SAFE-MIGRATION PROTOCOL identical to mig 2: `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, `$function$` terminator BEFORE the GRANT, `DROP FUNCTION IF EXISTS` before CREATE, `GRANT EXECUTE … TO anon, authenticated`, `NOTIFY pgrst`. **DO NOT auto-apply** — applied via the Supabase Management API by orchestrator/Seth (browser UA), recorded in `schema_migrations`.

### C.2 Client read hook
Add `app-mobile/src/hooks/usePublicRsvpBySlug.ts` modeled on `usePublicEventBySlug.ts`: calls `supabase.rpc("pg_public_rsvp_by_slug", {p_brand_slug, p_event_slug})`, maps the json → `{ event: PublicEventProps; brand: PublicBrandProps | null; config: RsvpOfferingConfig }`. Imports ONLY `@mingla/offering-rendering` types + the anon supabase client (I-MOR-0827). The web/business adapter (`PublicEventPage`/`publicEventsService`) reads the SAME RPC (replacing the `business_public_events_view` projection of RSVP fields for the public page). RETIRE `rsvpDeckService.fetchRsvpMomentum`'s use as the public-page momentum source — the unified RPC supplies it. (`submitDeckRsvp` in `rsvpDeckService` STAYS — it is the consumer write, see §D.) Keep the deck-seed warm-open as the instant fast-path; the RPC is the cold-open + authoritative refresh (closes the consumer seedless cap).

### C.3 Rationale: new RPC vs reuse `pg_public_event_by_slug`
**Recommendation: NEW `pg_public_rsvp_by_slug`.** Reasons: (1) the event RPC is hard-filtered to `event_type='event'` and returns a `tickets` aggregate that is meaningless/absent for RSVP, while RSVP needs the `rsvp_*` host-control columns the event RPC does not project — branching one RPC on event_type would bloat a money-path read and entangle the LEG-1 single-owner; (2) ORCH-1167's I-PROPOSED-1167-ONE-READ-RPC names `pg_public_event_by_slug` as the standard-event single owner — a sibling RPC per offering type is the established META-ORCH-1166 shape (and trip/experience legs will follow with their own); (3) the privacy + projection helpers are copy-reused, so there is no fee-math/duplication risk (RSVP has no fee math). A new sibling RPC is the lower-blast-radius, pattern-consistent choice.

---

## D. Preserve (single owners — DO NOT duplicate)
- **`RsvpMomentumDecision`** (`packages/offering-rendering/RsvpMomentumDecision.tsx`) — the Going/Maybe/Can't + count + meter + cluster unit. `RsvpOfferingBody` composes it (inline + dock/panel variants) exactly as `RsvpPublicBody` does today. No new decision UI.
- **`resolveRsvpCta`** (`packages/offering-rendering/offeringCta.ts`) — the money-free CTA state machine. Single owner; the body calls it, never re-implements.
- **`submitPublicRsvp` → `supabase/functions/public-submit-rsvp`** — the write path, unchanged. Web/business pass `submitPublicRsvp` into `onSubmit`; the consumer passes `submitDeckRsvp` (which invokes the same edge fn on the logged-in path). Both satisfy the `RsvpOfferingBodyProps.onSubmit` contract.
- **ORCH-1150 rules:** maybe = cap-neutral + auto-approved; maybe is non-terminal (can upgrade to going / decline); Going AND Maybe both require a reachable guest (A4-NEW), not_going needs no contact. Enforced in the shared `submit()` (moved into the body) + the edge fn — unchanged.
- **ORCH-1157 Direction-C momentum redesign:** the kicker + party chips + faceless cluster + floating-dock/sticky-panel layout, all carried by `RsvpMomentumDecision` + the body's section order. Byte-preserved.
- **Doors labels:** adapter builds via `formatEventDoorsTimes` (tz-aware, REAL-DATA-ONLY); the body renders them. Unchanged.

---

## G. NEW FLOW A — Going confirmation dialog + success popup (shared, shell-agnostic)

**Behavioral rule (binding):** Tapping **Going** opens a **confirmation dialog**. **Maybe** and **Not-going** record DIRECTLY with NO dialog (call `onSubmit` immediately, exactly as today). This applies to BOTH the inline box (§0-5) and the floating dock (§0-9): both Going affordances route through the same dialog.

### G.1 New shared components (built INSIDE `packages/offering-rendering`, package-isolated)
No shell-agnostic dialog/popup exists today (`mingla-business/src/components/ui/ConfirmDialog.tsx`+`Modal.tsx` are business-only — they import `../../constants/designSystem`). Author two NEW prop-only components in `packages/offering-rendering/` over React-Native's native `<Modal>` (works on react-native-web AND native RN), themed via `ThemePalette` ONLY (NO `designSystem` import → satisfies I-MOR-0827-PACKAGE-ISOLATION):
- **`packages/offering-rendering/RsvpGoingConfirmDialog.tsx`** — centered overlay (scrim + scale-in), modeled on the business `Modal.tsx` portal pattern but token-driven. Props: `{ visible, palette, theme, eventName, dateLine, venueLine, guestName, plusGuests: Array<{name}>, submitting, errorText, onConfirm, onCancel }`. testID `orch-1163-rsvp-going-confirm-dialog`.
- **`packages/offering-rendering/RsvpSuccessPopup.tsx`** — same overlay primitive, success state. Props: `{ visible, palette, theme, details: RsvpConfirmationDetails, onClose }`. testID `orch-1163-rsvp-success-popup`.

`RsvpConfirmationDetails` (shared type, exported from the barrel):
```ts
export interface RsvpConfirmationDetails {
  eventName: string;
  dateLine: string;            // AM/PM formatted, same string section §0-3 renders
  venueLine: string;           // venue name + city, OR city-only when address hidden
  guestName: string;
  status: "going";             // the success popup is GOING-only (maybe/not_going show no popup)
  plusGuests: Array<{ name: string }>; // names only in the popup; count = plusGuests.length
  confirmationToken: string | null; // for parity/debug; QR lives on the Calendar card, not the popup
}
```

### G.2 Dialog copy + states (binding)
**Confirm dialog (`RsvpGoingConfirmDialog`):**
- Title: **"Confirm your RSVP"**
- Body: **"You're telling {brandDisplayName} you're going to {eventName} on {dateLine}."** When `plusGuests.length > 0`, append a line: **"Bringing {N}: {comma-joined names}."**
- Primary button: **"Confirm I'm going"** (fill `palette.accent`); in `submitting` → label **"Confirming…"**, disabled, spinner.
- Secondary: **"Cancel"** (dismiss, no write).
- `errorText` (from a failed `onSubmit`) renders inline above the buttons; the dialog STAYS open so the user can retry (do NOT close on error). Error copy maps the edge-fn codes: `rsvp_full`→"This event just filled up." / `rsvp_not_open`→"RSVPs are closed for this event." / `rsvp_contact_required`→"Add your name, email and phone." / `rsvp_phone_invalid`→"That phone number looks off." / default→"Couldn't save your RSVP. Try again."

**Success popup (`RsvpSuccessPopup`) — shows the reservation DETAILS:**
- Title: **"You're going! 🎉"** (if `status` resolved to `waitlisted` via capacity, title **"You're on the waitlist"**; if manual-approval `pending`, **"RSVP sent for approval"** — read the resolved `status`/`approvalStatus` from the `onSubmit` result, NOT the requested status).
- Detail rows (each a labeled line): Event = `eventName`; When = `dateLine` (AM/PM); Where = `venueLine` (city-only if address hidden); Guest = `guestName`; Plus-ones = `plusGuests.map(g=>g.name).join(", ")` (omit the row when none); Status = "Going" / "Waitlisted" / "Pending approval".
- For a SIGNED-IN consumer, append a one-line nudge: **"Find your RSVP + entry QR in your Calendar."** (Anon web guests have no Calendar; omit the nudge when `!isLoggedIn`.)
- Single button: **"Done"** → `onClose`.

### G.3 Body-owned orchestration (state machine extension)
The body owns the dialog/popup state (NOT the surface). New local state in `RsvpOfferingBody`: `confirmOpen: boolean`, `successDetails: RsvpConfirmationDetails | null`, plus the existing `submitting`/`errorNode`. Flow:
1. Going tapped (inline or dock) AND `contactReady` (A4-NEW gate) → `setConfirmOpen(true)`. If NOT contactReady → focus the contact form / show field errors as today (no dialog).
2. Dialog **Confirm I'm going** → `submitting=true` → `await onSubmit({rsvpStatus:'going', …, guests})`.
   - On reject → set `errorText` (mapped), keep dialog OPEN.
   - On resolve → `setConfirmOpen(false)`, build `RsvpConfirmationDetails` from the resolved result + event/guest state, `setSuccessDetails(...)` (popup opens). The going-count refresh rides the existing post-submit `guestStatus`/momentum update.
3. Maybe / Not-going tapped → `await onSubmit(...)` directly, NO dialog, NO success popup (existing inline subcopy resolves — unchanged from today).

---

## H. NEW FLOW B — plus-ones with PER-GUEST contact (data model + write path)

### H.1 Problem
Today a plus-one is a bare integer (`event_rsvps.plus_count`, `20261004000000_orch_1150_rsvp_events.sql`). Seth requires each plus-one to carry **NAME + EMAIL + PHONE**. There is NO per-guest store anywhere (confirmed: no `event_rsvp_guests`, no JSONB blob).

### H.2 DATA-MODEL DECISION — child table `event_rsvp_guests` (CHOSEN over JSONB)
**DECISION (binding): a child table, not a JSONB column.** Rationale:
- These are CONTACT records (name/email/phone) that the host will want to reach, dedup, and (future) notify per-guest — exactly the shape the primary `event_rsvps` contact triple already has; a relational child mirrors it and keeps validation/indexing in SQL.
- A child table makes per-guest queries (host guest-list export, future per-guest check-in/QR) trivial and lets `plus_count` stay as the capacity-math integer (`SUM(1+plus_count)` is unchanged — no view/RPC rewrites for capacity).
- JSONB would bury contacts in a write-only blob (the exact anti-pattern ORCH-1146 just reversed for experiences — "persist into REAL columns instead of a write-only blob"). Mingla's own precedent says NO blob.

### H.3 Migration `20261XXXXNNNNNN_orch_1163_event_rsvp_guests.sql` (DO NOT auto-apply)
```sql
CREATE TABLE IF NOT EXISTS public.event_rsvp_guests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rsvp_id     uuid NOT NULL REFERENCES public.event_rsvps(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  email       text NOT NULL CHECK (length(btrim(email)) > 0),
  phone       text NOT NULL CHECK (length(btrim(phone)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_rsvp_guests_rsvp_id_idx ON public.event_rsvp_guests(rsvp_id);
ALTER TABLE public.event_rsvp_guests ENABLE ROW LEVEL SECURITY;
-- Host read (event_manager on the parent event's brand) — mirror event_rsvps_host_read via the rsvp→event join:
CREATE POLICY event_rsvp_guests_host_read ON public.event_rsvp_guests FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.event_rsvps r JOIN public.events e ON e.id = r.event_id
    WHERE r.id = event_rsvp_guests.rsvp_id
      AND biz_brand_effective_rank(e.brand_id, auth.uid()) >= biz_role_rank('event_manager')));
-- Owner read (the RSVP-er reads their own plus-ones):
CREATE POLICY event_rsvp_guests_owner_read ON public.event_rsvp_guests FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.event_rsvps r
    WHERE r.id = event_rsvp_guests.rsvp_id AND r.user_id = auth.uid()));
GRANT SELECT, INSERT, DELETE ON TABLE public.event_rsvp_guests TO service_role;
-- (writes flow ONLY via the SECURITY DEFINER submit_event_rsvp RPC under service-role; no anon/authenticated table grant)
```
SAFE-MIGRATION protocol: applied via Supabase Management API (browser UA), recorded in `schema_migrations`. No `$function$`/GRANT-ordering hazard here (no function), but DROP-before-widen still applies if `submit_event_rsvp` RETURNS is changed (it is — §H.4).

### H.4 Extend the write path (single owner preserved)
The write path stays: `onSubmit` → `submitPublicRsvp`/`submitDeckRsvp` → `public-submit-rsvp` edge fn → `submit_event_rsvp` RPC. EXTEND each layer to carry `guests`:
- **`submit_event_rsvp` RPC** (redefine, latest-wins, in the SAME migration): add param `p_guests jsonb DEFAULT '[]'::jsonb`. Inside the existing transaction, AFTER the `event_rsvps` UPSERT resolves `v_rsvp_id`: **`DELETE FROM event_rsvp_guests WHERE rsvp_id = v_rsvp_id`** then **INSERT one row per element of `p_guests`** (the delete-then-insert makes re-submit idempotent and keeps the child set consistent with the new `plus_count`). VALIDATE: `jsonb_array_length(p_guests)` must equal the clamped `plus_count` for `going`/`maybe` (`RAISE rsvp_guest_count_mismatch` if not); each element must have non-empty name/email/phone (`RAISE rsvp_guest_contact_required`); for `not_going`, force `p_guests='[]'` (no plus-ones on a decline). DROP the old RETURNS signature before CREATE (RETURNS shape unchanged — still `{rsvpId,status,approvalStatus,capacityFull}` — but the param list changes, so DROP is mandatory). RETURN additionally surfaces `v_rsvp_id` (already does as `rsvpId`).
- **`public-submit-rsvp` edge fn** (`supabase/functions/public-submit-rsvp/index.ts`): accept `guests?: Array<{name,email,phone}>` in the body. Validate server-side (anon AND authenticated): when `rsvpStatus` is going/maybe and `plusCount > 0`, `guests.length` must === `plusCount` (400 `rsvp_guest_count_mismatch`), and each guest name/email/phone non-empty with email matching `EMAIL_RE` and phone passing `normalizePhone`/`PHONE_RE` (400 `rsvp_guest_contact_required` / `rsvp_guest_phone_invalid`). Pass `p_guests` to the RPC. Return `rsvpId` (already returned) — surface it to the client.
- **`submitPublicRsvp`** (`mingla-business/src/services/rsvpEvents.ts`): add `guests` to `SubmitPublicRsvpInput`; pass through; add `rsvpId` to `SubmitPublicRsvpResult`.
- **`submitDeckRsvp`** (`app-mobile/src/services/rsvpDeckService.ts`): add an optional `guests` param (signed-in consumer: the primary contact is JWT-resolved, but plus-one contacts are still required) → `{ eventId, rsvpStatus, guests }`; add `rsvpId` to `SubmitDeckRsvpResult`.

### H.5 Body UI — per-guest contact entry (replaces the count stepper)
The `RsvpMomentumDecision` plus-ones stepper (`styles.plusRow`, `+{plusCount}`, testIDs `orch-1157-rsvp-plus-minus`/`-plus`) is EXTENDED: each increment now reveals a **per-guest contact mini-form** (name + email + phone, all REQUIRED) — NOT just a count. Implement as a `guests: Array<{name,email,phone}>` array the body owns; the +/− stepper grows/shrinks the array (minus removes the LAST guest); each guest renders 3 `RsvpField`s (reuse the existing `RsvpField` primitive). Decrement disabled at 0, increment disabled at `plusOnesMax`. Validation: `contactReady` (the Going/Maybe gate) is EXTENDED to also require EVERY guest's name/email/phone valid (same regex as the primary). testIDs: `orch-1163-rsvp-guest-{i}-name|email|phone`. Keep `orch-1157-rsvp-plus-minus`/`-plus` for the steppers (guard parity).

### H.6 Validation summary (binding)
- Primary RSVP-er name/email/phone required for **Going AND Maybe** (A4-NEW, unchanged); not_going needs none.
- Each plus-one name/email/phone **required** (going/maybe). `guests.length === plusCount`.
- Enforced at THREE layers: body `contactReady` gate (blocks the Going dialog / Maybe submit), edge-fn (400s), and RPC (`RAISE`). Defense-in-depth, same as the primary contact today.

---

## I. NEW FLOW C — consumer Calendar-tab RSVP card + QR

### I.1 Goal
When a signed-in consumer is **GOING** to an RSVP event, it appears in the consumer app's **Calendar tab** as a card that MIRRORS the ticket/reservation card AND carries a QR.

### I.2 The QR / entry TOKEN — source (DECISION: signed token mirroring the ticket pattern)
**DECISION (binding): a dedicated SIGNED token, mirroring the ticket QR — NOT the bare rsvp id.** The ticket QR is `mingla:v1:ticket:<ticketId>:sig:<sha256(ticketId:qr_token_hash:pepper)>` (`biz_ticket_checkout_qr_payload`, validated by `biz_ticket_scan`). Replicate that shape for RSVP so a future host scanner can validate it the same way and a leaked rsvp uuid alone can't forge entry:
- Add columns to `event_rsvps` (in the §H.3 migration): **`qr_token_hash text NULL`** and **`qr_code text NULL`** (mirrors `tickets`). On a `going` resolution inside `submit_event_rsvp`, if `qr_token_hash IS NULL`, generate a random token (`gen_random_uuid()::text` or `encode(gen_random_bytes(16),'hex')`), compute `qr_token_hash = biz_ticket_checkout_token_hash(token, pepper)` and `qr_code = 'mingla:v1:rsvp:' || rsvp_id || ':sig:' || encode(digest(rsvp_id || ':' || qr_token_hash || ':' || pepper,'sha256'),'hex')` — REUSE the existing pepper-asserting helpers (`biz_ticket_checkout_assert_qr_pepper`/`biz_ticket_checkout_token_hash`); add a sibling payload helper `biz_rsvp_qr_payload(p_rsvp_id, p_token_hash, p_qr_token_pepper)` emitting the `mingla:v1:rsvp:` prefix. The pepper is passed from the edge fn (`qrTokenPepper()`), exactly as `ticket-checkout-confirm` does — so `public-submit-rsvp` gains a `p_qr_token_pepper` arg to the RPC. **Token is minted ONLY for `going`** (maybe/not_going get NULL `qr_code` → `confirmationToken` returns null).
- `confirmationToken` returned by the RPC/edge-fn/`onSubmit` = `event_rsvps.qr_code` (the full signed payload), so the success popup and the Calendar card both have it without a re-read.

### I.3 The READ — the signed-in user's GOING RSVPs
Add `CalendarService.fetchUserGoingRsvps(userId)` in `app-mobile/src/services/calendarService.ts`, modeled on `fetchUserBusinessEventOrders`. Reads `event_rsvps` where `user_id = userId` AND `rsvp_status = 'going'` AND `approval_status IN ('approved','pending')`, embedding the parent `events` (id, title, slug, cover_media_url, timezone, location_text, location_geo, is_online, online_url, brand) and the child `event_rsvp_guests(name)`:
```ts
supabase.from("event_rsvps").select(`
  id, rsvp_status, approval_status, plus_count, qr_code, created_at,
  events!inner ( id, title, slug, cover_media_url, timezone, location_text, location_geo, is_online, online_url,
    brand:brands!inner ( id, slug, name ),
    event_dates!left ( id, start_at, end_at, is_master ) ),
  event_rsvp_guests ( name )
`).eq("user_id", userId).eq("rsvp_status", "going").in("approval_status", ["approved","pending"])
```
RLS already permits this (`event_rsvps_guest_read_own` = `user_id = auth.uid()`; `event_rsvp_guests_owner_read` added §H.3, EXTENDED §J.1 with `OR matched_user_id = auth.uid()`). Returns a new `ConsumerRsvpRow` type: `{ rsvpId, qrCode: string|null, status, approvalStatus, plusGuestNames: string[], event:{title,slug,coverMediaUrl,dateLine,venue}, brandName, role:'primary'|'guest', invitedBy?: string }`. **NOTE §J.6 EXTENDS this read into a UNION:** it returns BOTH (a) primary rows (this query) AND (b) `event_rsvp_guests` rows where `matched_user_id = userId` (the matched plus-one's OWN card, QR = the guest's own `qr_code`). Implement as the §J.6 `fetch_user_going_rsvps` RPC (preferred) or two selects + merge. New hook `useMyGoingRsvps(userId)` in `app-mobile/src/hooks/useCalendarEntries.ts` (or a sibling file), `react-query` keyed `["myGoingRsvps", userId]`, with a `useRsvpsRealtimeSubscription` (postgres_changes on `event_rsvps` filtered to the user) for freshness — mirror `useTicketsRealtimeSubscription`.

### I.4 The CARD — a 4th `UnifiedRow` kind
`CalendarTab.tsx` uses a discriminated `UnifiedRow` union (`kind: "calendar" | "ticket" | "reservation"`). Add **`kind: "rsvp"`**: `{ kind: "rsvp"; key: string; sortAt: number; rsvp: ConsumerRsvpRow }`. Sort-merge it into the Active/Archive accordions by the event master date (past → Archive), exactly like tickets. New row component **`app-mobile/src/components/activity/RsvpCalendarRow.tsx`** modeled on `BusinessEventCalendarRow.tsx`: cover thumb + "On Mingla" badge, event title, subtitle = `brandName · dateLine`, an "RSVP · Going" pill (qr-code icon), plus-ones count ("+N guests"), and a "View RSVP" CTA → opens a bottom sheet.
- The sheet **`app-mobile/src/components/activity/RsvpPassSheet.tsx`** (modeled on `TicketPdfSheet.tsx`, dark `BaseBottomSheet`): venue block (location/online + Open in Maps), the **QR** (`<QRCode value={rsvp.qrCode} size={…} />` via `react-native-qrcode-svg`, the SAME library) under a "Show at door" caption (only when `qrCode` non-null), the guest name + status badge (Going / Pending approval), the plus-ones names list, and a **change/cancel-RSVP action** (re-opens the consumer RSVP flow / submits `not_going` via `submitDeckRsvp` → optimistic invalidate `["myGoingRsvps", userId]`). NO PDF/download (RSVP has no PDF).
- Filter/search parity: the row passes search on `eventTitle + brandName`; `when` filter applies via the event master date; null-date RSVPs visible only under "all" (mirror tickets).

### I.5 Host-side scanning / check-in — OUT of scope (token rendered now, scanner is a follow-on)
**RECOMMENDATION (binding for this leg): render the QR + mint the token NOW; full host-scanner integration is a FOLLOW-ON ORCH.** The live `biz_ticket_scan` RPC + `scan-ticket` edge fn + `mingla-business/app/event/[id]/scanner/index.tsx` camera are HARD-CODED to the `tickets` table and the `mingla:v1:ticket:` regex — an RSVP `mingla:v1:rsvp:` payload would fail (`not_found`). Wiring RSVP check-in requires a new RPC branch (`biz_rsvp_scan` against `event_rsvps` AND `event_rsvp_guests` — see §J.5 NOTE: the scanner must accept BOTH the primary and per-guest tokens) + a payload-kind switch in the scanner + a host RSVP-scanner entry point — that is a discrete follow-on (`ORCH-XXXX rsvp-host-checkin`, OQ-6 LOCKED). This leg mints the `mingla:v1:rsvp:…:sig:…` token (primary + EVERY plus-one) and renders it as a QR so the follow-on is drop-in (the token format + pepper are already correct). **Flag for the orchestrator to register the follow-on.**

---

## J. EXPANSION (Seth-confirmed) — each PLUS-ONE is a FIRST-CLASS invited guest

> **Binding amendment to flows B (§H) + C (§I).** A plus-one is no longer a mere host contact: it is an invited guest who (1) gets its OWN signed QR/entry token, (2) receives an EMAIL with that ticket, (3) gets a PUSH if it is a Mingla user, and (4) if its email/phone matches a Mingla consumer account, sees the event in ITS OWN consumer Calendar tab with ITS OWN QR. The primary RSVP-er continues to get a confirmation email + (if signed-in) push + Calendar card. **Reuse the existing email/push/match infra cited below — DO NOT invent a parallel notification system.** Preserve ORCH-1150 capacity math (plus-ones count toward capacity via `SUM(1+plus_count)`; maybe stays cap-neutral) and the privacy + single-owner rules.

### J.1 Schema — per-guest token + matched account on `event_rsvp_guests`
EXTEND the §H.3 `event_rsvp_guests` table (same migration) with **per-guest entry tokens + a matched-account FK**:
```sql
ALTER TABLE public.event_rsvp_guests
  ADD COLUMN IF NOT EXISTS qr_token_hash  text NULL,                                  -- mirror tickets/event_rsvps
  ADD COLUMN IF NOT EXISTS qr_code        text NULL,                                  -- full signed mingla:v1:rsvp: payload
  ADD COLUMN IF NOT EXISTS matched_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL; -- §J.4 verified-identity match
CREATE INDEX IF NOT EXISTS event_rsvp_guests_matched_user_idx
  ON public.event_rsvp_guests(matched_user_id) WHERE matched_user_id IS NOT NULL;     -- the plus-one's own-Calendar read (§J.6)
```
- `qr_token_hash`/`qr_code`: per-guest, minted ONLY when the parent RSVP resolves `going` (§J.3), identical shape to the primary's (§I.2) but keyed on the GUEST id: `mingla:v1:rsvp:<guest_id>:sig:<sha256(guest_id : qr_token_hash : pepper)>`. So a party of N (primary + N−1 plus-ones, or however the count is modeled) yields N distinct signed passes — the primary's on `event_rsvps.qr_code`, each plus-one's on its `event_rsvp_guests.qr_code`.
- `matched_user_id`: the verified Mingla consumer account this plus-one resolves to (NULL when no verified match). Drives BOTH the push target (§J.5) AND the plus-one's own-Calendar card (§J.6). RLS: extend `event_rsvp_guests_owner_read` (§H.3) so the MATCHED user can also read its own guest row: `OR matched_user_id = auth.uid()` (see §J.6 read).

### J.2 Identity match — VERIFIED only (REUSE ORCH-1111/1112 pattern, NEVER user_metadata)
**Single source of truth for matching:** reuse the EXISTING verified-identity helpers — do NOT write a new matcher.
- **Edge-side (TS), email:** `supabase/functions/_shared/trustedCallerEmail.ts` — `pickVerifiedIdentityEmail(identities)` + `resolveTrustedCallerEmail(user, makeAuthIdentitiesFetcher(service))`. The match key is a VERIFIED `auth.identities.identity_data->>'email'` (`email_verified IN ('true','t','1')`), exactly as `supabase/functions/list-my-pending-invites/index.ts` (ORCH-1111) does. **NEVER** `user_metadata`/`raw_user_meta_data`.
- **SQL precedent (email):** the verified-email WHERE clause to mirror is in `supabase/migrations/20260926000000_orch_1111_oauth_null_email_accept.sql` (`accept_invite_and_transfer_brand_ownership`): `SELECT (i.identity_data->>'email') FROM auth.identities i WHERE i.user_id = … AND (i.identity_data->>'email') IS NOT NULL AND lower(coalesce(i.identity_data->>'email_verified','')) IN ('true','t') ORDER BY i.last_sign_in_at DESC NULLS LAST LIMIT 1`.
- **Phone:** match a plus-one's phone to a Mingla account ONLY via a CONFIRMED phone: `auth.users.phone = <normalized E.164> AND phone_confirmed_at IS NOT NULL` (the verified-phone analogue; `auth.users.phone_confirmed_at` is the only trusted phone signal — same fail-closed posture as email). Do NOT match on an unconfirmed `auth.users.phone` and NEVER on profile/metadata phone.
- **Match resolver (where it runs):** add a SECURITY-DEFINER helper `biz_resolve_verified_user(p_email text, p_phone text) RETURNS uuid` in the §H/§J migration that runs BOTH lookups (email via `auth.identities` verified, phone via `auth.users.phone_confirmed_at`) and returns the matched `auth.users.id` (email match preferred; phone fallback; NULL when neither verified-matches). `submit_event_rsvp` calls it per guest to populate `matched_user_id`. Rationale for SQL-side resolve: the per-guest INSERT already happens inside the SECURITY-DEFINER RPC under service-role, where `auth.identities`/`auth.users` are readable; doing it edge-side would need an extra admin round-trip per guest. (The edge fn's `trustedCallerEmail.ts` helpers remain the canonical TS analogue if a future non-RPC path needs it.)
- **Back-match (FOLLOW-ON, non-trivial → deferred):** a guest who is NOT a Mingla user at submit time but JOINS Mingla later (verifies the same email/phone) should be back-matched so the event appears in their Calendar retroactively. This requires a trigger on `auth.identities`/`auth.users` verification (or a periodic resolver sweep) updating `event_rsvp_guests.matched_user_id` where the new verified contact matches an unmatched guest row. **NOT in this leg** — flag `ORCH-XXXX rsvp-guest-backmatch` for the orchestrator. This leg resolves the match ONCE at submit time only.

### J.3 Mint per-guest tokens (extend `submit_event_rsvp`, same single owner)
Inside the redefined `submit_event_rsvp` (§H.4), AFTER the delete-then-insert of `event_rsvp_guests` rows and ONLY on a `going` resolution, for EACH inserted guest row whose `qr_token_hash IS NULL`:
- generate a per-guest token (`encode(gen_random_bytes(16),'hex')`), set `qr_token_hash = biz_ticket_checkout_token_hash(token, p_qr_token_pepper)`, and `qr_code = 'mingla:v1:rsvp:' || guest_id || ':sig:' || encode(digest(guest_id || ':' || qr_token_hash || ':' || p_qr_token_pepper, 'sha256'),'hex')` — REUSE the same pepper-asserting helpers as the primary (`biz_ticket_checkout_assert_qr_pepper`/`biz_ticket_checkout_token_hash`; `biz_rsvp_qr_payload` from §I.2 already emits the `mingla:v1:rsvp:` prefix — it takes the entity id, so it serves BOTH the primary rsvp_id and each guest_id).
- ALSO resolve `matched_user_id = biz_resolve_verified_user(guest.email, guest.phone)` (§J.2) for each guest (independent of `going`/`maybe` — match is useful for both; but the QR + Calendar card only render for `going`).
- Idempotency: because §H.4 is delete-then-insert, re-submit re-creates guest rows → tokens re-mint fresh each going-submit (acceptable: the OLD child rows + their tokens are CASCADE/DELETE-gone; no stale pass survives). The PRIMARY token stays idempotent on `event_rsvps.qr_token_hash IS NULL` (§I.2) — only the per-guest set churns on re-submit. (NOTE for the implementor: if a future host-scanner has already checked-in a guest, delete-then-insert would orphan the check-in — out of scope here since the scanner is a follow-on, but FLAG it in the follow-on spec.)
- `p_qr_token_pepper` is the SAME RPC arg added in §I.2 (passed from the edge fn `qrTokenPepper()`); no second pepper.

### J.4 Email the ticket to EVERY plus-one + the primary (REUSE the RSVP email infra)
**Reuse path (cite):** RSVP already has a transactional multi-channel dispatcher — `supabase/functions/rsvp-notify/index.ts` — which fans out email + SMS + push via the shared `_shared/email/*` shell (`renderShell`/`renderGenericBody`/`EMAIL_SENDERS`/`sendResendEmailWithAttachment`-style Resend call in `ticket-confirmation-dispatch`) and the `rsvp_notifications` queue. **Do NOT build a new email function.** After a successful `going` submit, the `public-submit-rsvp` edge fn (§H.4) enqueues+dispatches a NEW RSVP-pass email template per recipient:
- **Recipients:** the PRIMARY (its `guest_email` / signed-in user email) + EVERY `event_rsvp_guests` row's `email` — REGARDLESS of whether that email matches a Mingla account (email goes to all plus-ones, matched or not).
- **Template:** add a `rsvp_pass` template to the RSVP notify copy (sibling to ORCH-1150's `rsvp_*` templates) rendered through the SAME `_shared/email` shell. Subject ≈ "You're going to {eventName}"; body = event name + AM/PM date line + venue/city (privacy-respecting: city-only when `hide_address_until_ticket` and viewer is a plain guest) + brand "Hosted by" + the recipient's OWN entry QR.
- **QR delivery (REUSE the ticket-email QR pattern):** the ticket email carries its QR as a **PDF attachment** built by `_shared/ticketPdf.ts` (`buildTicketPdf` → `qrPayloadAsPngBytes` via `esm.sh/qrcode`, embedded `pdf.embedPng`), sent through `sendResendEmailWithAttachment` (`supabase/functions/ticket-confirmation-dispatch/index.ts`). **Mirror that:** render each recipient's `qr_code` (primary → `event_rsvps.qr_code`; each plus-one → its `event_rsvp_guests.qr_code`) as a QR PNG via the SAME `qrPayloadAsPngBytes`, attach a one-page RSVP pass PDF (a thin `buildRsvpPassPdf` modeled on `buildTicketPdf` — same QR primitive, RSVP copy, NO price/order fields), and Resend it. (Implementor choice, binding default: PDF attachment to match the ticket precedent. An inline `cid:`/data-uri QR in the HTML is NOT the established pattern — `ticketBody.ts` deliberately keeps the QR in the PDF only; follow that.) The sender is `EMAIL_SENDERS.tickets` (`RESEND_TICKET_FROM`, default `tickets@usemingla.com`) — same as tickets.
- **Idempotency:** one `rsvp_notifications` queue row per recipient per going-resolution, `idempotency_key = 'rsvp_pass:' || rsvp_id || ':' || COALESCE(guest_id::text,'primary')` so re-dispatch never double-sends. Use the existing `rsvp_notifications` status machine (`pending→sending→sent/failed_retryable`) + the `notification-retry-sweeper` for retries.

### J.5 Push the matched plus-ones + the primary (REUSE OneSignal infra, NO new system)
**Reuse path (cite):** `supabase/functions/_shared/push-utils.ts` — `sendPush({ targetUserId, title, body, app, data })` (POSTs `https://api.onesignal.com/notifications` with `include_aliases.external_id:[userId]`, the RAW Supabase UUID — **NO `consumer:`/`business:` prefix on the user id**; app routing is purely the `type`-prefix rule in `resolveOneSignalApp` → RSVP types route to the **consumer** app via `ONESIGNAL_APP_ID`/`ONESIGNAL_REST_API_KEY`). `rsvp-notify` ALREADY calls `sendPush({…, app:"consumer"})` and mirror-inserts a `public.notifications` inbox row (`user_id,type,title,body,deep_link,data,brand_id,related_id,related_type:'rsvp_event'`). **Reuse that exact call — do not add a OneSignal path.**
- **Targets:** the PRIMARY when it is a signed-in app user (`event_rsvps.user_id IS NOT NULL`) + EVERY plus-one with a non-null `matched_user_id` (§J.2). Each `sendPush({ targetUserId: <user_id or matched_user_id>, app:"consumer", title:"You're going to {eventName}", body:"Find your RSVP + entry QR in your Calendar.", data:{ deepLink:<rsvp/event deep link>, type:"rsvp_pass" } })` + the mirror `public.notifications` insert (same shape `rsvp-notify` uses today). type prefix = plain `rsvp_pass` (no `business.`/`stripe.`) → consumer app, correct.
- **Unmatched plus-ones get NO push** (they have no Mingla account/`matched_user_id`) — they got the email (§J.4). Preference + quiet-hours gating is inherited from the existing `notify-dispatch`/`rsvp-notify` path (no new gating). The mirror inbox row makes the RSVP appear in the in-app notification center for matched users.

### J.6 The matched plus-one's OWN Calendar card (extend the §I read — return BOTH primary AND matched-guest rows)
**Goal:** if a plus-one matches a Mingla consumer account, the event appears in THAT account's consumer Calendar tab as an RSVP card with the plus-one's OWN per-guest QR (its `event_rsvp_guests.qr_code`) — mirroring the primary's card (§I.4). EXTEND the §I.3 read so `useMyGoingRsvps(userId)` returns a UNION of:
- **(a) primary rows** — `event_rsvps` where `user_id = userId` AND `rsvp_status='going'` (the §I.3 query, unchanged; QR = `event_rsvps.qr_code`, the user is the primary).
- **(b) matched-guest rows** — `event_rsvp_guests` where `matched_user_id = userId` AND the PARENT `event_rsvps.rsvp_status='going'` AND `approval_status IN ('approved','pending')`, embedding the parent rsvp's `events`(+brand) the same way; QR = the GUEST row's `qr_code`, the display name = the guest's own `name`, and a "Invited by {primary guest_name}" subline distinguishes it from a primary card.
- **Read shape (binding):** rather than two round-trips, add a SECURITY-DEFINER read RPC **`fetch_user_going_rsvps(p_user_id uuid)`** (the §I.3 select is anon-RLS-safe for (a) but (b) needs the guest→rsvp→event join with `matched_user_id = auth.uid()`) returning a unified `ConsumerRsvpRow[]` with a `role: 'primary' | 'guest'` discriminator + the right `qrCode`/`displayName`/`invitedBy`. `CalendarService.fetchUserGoingRsvps` calls this RPC. RLS alternative (no RPC): the §J.1 `event_rsvp_guests_owner_read` `OR matched_user_id = auth.uid()` policy already lets a matched user read its guest row directly, so the client CAN do the two PostgREST selects + merge — implementor picks the RPC (preferred, one round-trip, server-merged sort) OR the two-select-merge; either way the union is the contract.
- **Card parity:** the `kind:"rsvp"` `UnifiedRow` (§I.4) + `RsvpCalendarRow`/`RsvpPassSheet` are UNCHANGED in shape; they just also render matched-guest rows. The `RsvpPassSheet` shows the matched plus-one's OWN `qrCode` ("Show at door"), its own status (Going / Pending), and — for a guest role — DISABLES the primary's change/cancel-all action (a plus-one can't cancel the whole party's RSVP; a guest-role card's cancel is OUT of scope this leg → show "Ask {primary} to update" or hide the cancel CTA; FLAG as a tiny follow-on if Seth wants per-guest self-decline).

### J.7 Capacity + privacy + single-owner (UNCHANGED — preserved)
- **Capacity:** plus-ones STILL count via `SUM(1 + plus_count)` (ORCH-1150). Minting per-guest tokens + matching accounts does NOT change the capacity integer. Maybe stays cap-neutral; per-guest tokens/email/push fire ONLY on `going` (a `maybe` mints no QR, sends no pass email/push — match may still resolve for a future going upgrade).
- **Privacy:** the per-guest pass email/Calendar card respect address privacy identically to the primary (city-only when `hide_address_until_ticket` and the recipient has no own going/maybe). Social-proof anon rules (§A.5) unchanged — guest names appear ONLY to the host (RLS host-read) + on each guest's OWN pass/card, never in public social proof.
- **Single owner:** email = the existing `rsvp-notify`/`_shared/email` path; push = the existing `_shared/push-utils.ts`+`notifications` path; match = the existing `trustedCallerEmail.ts`/`auth.identities` pattern. NO new notification system, NO duplicate matcher. The write path single owner (`submit_event_rsvp` → `public-submit-rsvp`) absorbs the mint+match+dispatch.

---

## E. DRAFT invariants (register DRAFT in this SPEC; flip ACTIVE at CLOSE)
- **I-PROPOSED-1163-RSVP-ONE-SHARED-BODY** — the public RSVP page body is ONE shared `RsvpOfferingBody` in `packages/offering-rendering`, rendered identically on buyer-web + business iOS/Android + consumer iOS/Android. No per-surface RSVP body fork (the `RsvpPublicBody` web/business body + the `ConsumerEventDetailScreen` RSVP hand-mirror are retired — do not reintroduce). *Enforcement:* package-isolation gate + a strict-grep gate asserting no RSVP body lives outside `packages/offering-rendering` + the offering-rendering RSVP render tests; fails-on-revert.
- **I-PROPOSED-1163-RSVP-SHELL-AGNOSTIC** — `RsvpOfferingBody` hosts NO scroll root and NO cover host; the cover is a surface-pinned sibling and the decision dock is surface-pinned. The body must never wrap `ParallaxCoverShell` (re-triggers the gorhom freeze on consumer). *Enforcement:* a grep/AST gate asserting `RsvpOfferingBody.tsx` does not import/render `ParallaxCoverShell`; the consumer parallax-layering safety-net test.
- **I-PROPOSED-1163-RSVP-ONE-READ-PATH** — the public RSVP page reads through exactly ONE canonical anon RPC `pg_public_rsvp_by_slug` across every surface; no surface re-derives the page payload from a second query path. *Enforcement:* the migration applied to prod + recorded in `schema_migrations`; single-owner read; live-smoke-verified.
- **I-PROPOSED-1163-RSVP-COVER-IMPERATIVE-VIDEO** — the RSVP cover video on web is rendered via the imperative-DOM `document.createElement('video')` primitive (reusing `EventCoverMedia`), never a React-rendered `<video>` (DEC-189 WebKit denial). *Enforcement:* the ORCH-0978 web-video gate (already updated to accept the imperative-DOM primitive) covers the RSVP cover path; live WebKit deploy verification.
- **I-PROPOSED-1163-RSVP-CANONICAL-9-SECTION-ORDER** — the public RSVP page renders Seth's canonical 9-section order (§0) byte-identically on every surface: cover → name → full-width date row → solid-fill pills row (format/ALL vibes/ALL party-types/ALL music-genres, NO tickets-left pill) → inline Going/Maybe/Not-going box → Presented By → About toggle → Where-you'll-be static map → floating decision button. Party chips live in the canonical pills row, NOT nested in the momentum unit. *Enforcement:* offering-rendering render tests asserting the ordered testIDs (`orch-1167-date-row` parity, pills row, inline `RsvpMomentumDecision`, brand, about, where-map, `orch-1157-rsvp-floating-dock`); a grep gate asserting no party-chip `styles.chips` block renders inside `RsvpMomentumDecision` (promoted out).
- **I-PROPOSED-1163-RSVP-GOING-CONFIRM-MAYBE-DIRECT** — tapping Going opens the shared `RsvpGoingConfirmDialog` and a successful confirm opens `RsvpSuccessPopup` with the reservation details; Maybe and Not-going record directly with NO dialog. Both dialog + popup are package-isolated (no app-`src/` / `designSystem` import). *Enforcement:* offering-rendering interaction tests (Going→dialog→onSubmit→popup; Maybe/Not-going→onSubmit directly, no dialog); package-isolation gate covers the two new files.
- **I-PROPOSED-1163-RSVP-PLUS-ONE-PER-GUEST-CONTACT** — every plus-one persists a name+email+phone in the `event_rsvp_guests` child table (NOT a count, NOT a JSONB blob); `guests.length === plus_count`; each guest contact required+validated at body, edge-fn, and RPC layers. *Enforcement:* the migration applied + recorded; RPC `rsvp_guest_count_mismatch`/`rsvp_guest_contact_required` raises; edge-fn 400s; body `contactReady` extended; grep gate asserting no plus-one JSONB blob.
- **I-PROPOSED-1163-RSVP-GOING-CALENDAR-QR** — a signed-in consumer's GOING RSVP surfaces in the Calendar tab as a `kind:"rsvp"` `UnifiedRow` carrying a signed `mingla:v1:rsvp:<id>:sig:<hmac>` entry token rendered as a QR (`react-native-qrcode-svg`), minted by `submit_event_rsvp` into `event_rsvps.qr_code` using the shared pepper helpers, ONLY for `going`. The bare rsvp id is never the QR value. *Enforcement:* the migration (qr_token_hash/qr_code columns + minting) applied + recorded; `fetchUserGoingRsvps` read; CalendarTab `rsvp`-kind render test; a grep/SQL assertion that the QR payload is the signed `mingla:v1:rsvp:` form.
- **I-PROPOSED-1163-RSVP-PLUS-ONE-PER-GUEST-PASS** — on a `going` resolution, EVERY `event_rsvp_guests` row (each plus-one) is minted its OWN signed `mingla:v1:rsvp:<guest_id>:sig:<hmac>` token into `event_rsvp_guests.qr_code` via the SAME shared pepper helpers as the primary (`biz_ticket_checkout_token_hash`/`biz_rsvp_qr_payload`); a party of N produces N distinct passes (primary on `event_rsvps.qr_code` + one per guest). No guest's QR value is the bare guest id; tokens mint ONLY for `going` (NULL for maybe/not_going). *Enforcement:* the migration (per-guest `qr_token_hash`/`qr_code` cols + per-guest minting in `submit_event_rsvp`) applied + recorded; RPC test asserts N guests → N signed `mingla:v1:rsvp:` codes; SQL assertion the payload is the signed form keyed on `guest_id`.
- **I-PROPOSED-1163-RSVP-GUEST-NOTIFY-EMAIL-PUSH** — after a successful `going` submit, the `public-submit-rsvp` edge fn dispatches a pass EMAIL (with the recipient's own QR, via the EXISTING `rsvp-notify` + `_shared/email`/`_shared/ticketPdf` infra — NO new email function) to EVERY plus-one (matched or not) + the primary, and a PUSH (via the EXISTING `_shared/push-utils.ts` `sendPush({app:"consumer"})` + `public.notifications` inbox mirror — NO new OneSignal path) to every plus-one with a non-null `matched_user_id` + the signed-in primary. Email is idempotent per recipient (`rsvp_pass:<rsvp_id>:<guest_id|primary>`); unmatched plus-ones get email only (no push). *Enforcement:* edge-fn dispatch test (N guests → N pass emails + matched-only pushes); grep gate asserting no NEW email/OneSignal client is introduced (reuse-only — references `rsvp-notify`/`push-utils.ts`/`_shared/email`); `rsvp_notifications` idempotency-key uniqueness.
- **I-PROPOSED-1163-RSVP-MATCHED-GUEST-CALENDAR** — a plus-one whose email and/or phone VERIFIED-matches a Mingla consumer account (via the ORCH-1111/1112 `auth.identities` verified-email + `auth.users.phone_confirmed_at` verified-phone pattern — `trustedCallerEmail.ts`/`biz_resolve_verified_user`, NEVER `user_metadata`) gets `event_rsvp_guests.matched_user_id` set at submit, and the GOING event appears in THAT account's consumer Calendar tab as a `kind:"rsvp"` row carrying the plus-one's OWN per-guest QR. `useMyGoingRsvps` returns BOTH (a) rows where the user is the primary AND (b) `event_rsvp_guests` rows where `matched_user_id = auth.uid()` (parent going), each with the correct per-guest token + name + "Invited by {primary}". The match is verified-only (no metadata); back-match of a later-joining guest is a flagged follow-on. *Enforcement:* migration (`matched_user_id` col + index + resolver) applied + recorded; resolver test (verified email/phone match → user_id; unverified → NULL); `fetch_user_going_rsvps` (or the two-select union) returns matched-guest rows scoped to `auth.uid()`; CalendarTab renders a guest-role rsvp row with the guest's own qrCode; grep gate asserting the matcher reads `auth.identities`/`phone_confirmed_at`, never `user_metadata`.

---

## F. Affected Surfaces
**IN scope:** iOS-consumer, Android-consumer, business-iOS, business-Android, buyer-web.
**NOT in scope:** admin-web; trip leg; experience leg (their own META-ORCH-1166 legs); the host console/wizard authenticated screens (`mingla-business/app/rsvp/[id]/{index,edit,guests,create}.tsx`, `RsvpCreatorWizard.tsx`) — only the public `preview.tsx` is touched; **host-side RSVP scanning/check-in (§I.5 / §J.5 follow-on `ORCH-XXXX rsvp-host-checkin`)**; **back-match of a later-joining guest (§J.2 follow-on `ORCH-XXXX rsvp-guest-backmatch`)**; **per-guest self-decline from a guest-role Calendar card (§J.6 tiny follow-on)**. No widening: RSVP-only, no trip/experience/standard-event changes beyond reusing the now-single `@mingla/offering-rendering` primitives + the existing notify/email/push/identity-match infra (REUSE, not re-author).

### F.1 File manifest (the exact touch list)
**`packages/offering-rendering/` (new/changed):** `RsvpOfferingBody.tsx` (new shared body, exports `RsvpOfferingDecisionDock`), `RsvpGoingConfirmDialog.tsx` (new, §G), `RsvpSuccessPopup.tsx` (new, §G), `RsvpMomentumDecision.tsx` (extend: promote party chips OUT to the pills row; per-guest plus-one mini-form §H.5), `index.ts` (barrel exports). Reuse: `EventCoverMedia`, `resolveRsvpCta`, `themePalette`, `buildStaticMapUrl`, `RsvpField`.
**Read path:** `app-mobile/src/hooks/usePublicRsvpBySlug.ts` (new), `mingla-business/src/services/publicEventsService.ts` (read same RPC for RSVP). Migration: `…_orch_1163_pg_public_rsvp_by_slug.sql` (new).
**Write path (§H/§I):** Migration `…_orch_1163_event_rsvp_guests.sql` (new: child table + `event_rsvps.qr_token_hash`/`qr_code` cols + **per-guest `qr_token_hash`/`qr_code`/`matched_user_id` cols (§J.1)** + redefined `submit_event_rsvp` (per-guest mint + `biz_resolve_verified_user` match, §J.3) + `biz_rsvp_qr_payload` + **`biz_resolve_verified_user(p_email,p_phone)` resolver (§J.2)** + **`fetch_user_going_rsvps(p_user_id)` read RPC (§J.6)**). `supabase/functions/public-submit-rsvp/index.ts` (accept `guests`, pepper, return `rsvpId`/`confirmationToken`; **§J.4/§J.5: after a `going` submit, enqueue per-recipient `rsvp_pass` email + push to matched guests + primary**). `mingla-business/src/services/rsvpEvents.ts` (`submitPublicRsvp` +guests/+rsvpId). `app-mobile/src/services/rsvpDeckService.ts` (`submitDeckRsvp` +guests/+rsvpId).
**Notify path (§J — REUSE, no new system):** `supabase/functions/rsvp-notify/index.ts` (add the `rsvp_pass` template branch + per-recipient fan-out using its EXISTING `sendPush`/`_shared/email`/`rsvp_notifications` machinery). `supabase/functions/_shared/email/copy.ts` (add `rsvp_pass` subject/preheader/body copy) + a thin `buildRsvpPassPdf` modeled on `_shared/ticketPdf.ts` (`qrPayloadAsPngBytes` primitive, RSVP copy, no order/price). REUSE (do NOT modify): `supabase/functions/_shared/push-utils.ts` (`sendPush`/`resolveOneSignalApp`), `supabase/functions/_shared/email/{shell,senders,index,genericBody}.ts`, `supabase/functions/_shared/trustedCallerEmail.ts` (verified-identity match), `public.notifications` inbox table.
**Surface wiring:** `mingla-business/src/components/event/PublicEventPage.tsx` (mount `FoundationRsvpPreview`), new `FoundationRsvpPreview.tsx`, DELETE `mingla-business/src/components/event/RsvpPublicBody.tsx`, `mingla-business/app/rsvp/[id]/preview.tsx` (mount wrapper). `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` (RSVP branch → `RsvpOfferingBody`).
**Calendar (§I, consumer-only):** `app-mobile/src/services/calendarService.ts` (`fetchUserGoingRsvps` + `ConsumerRsvpRow`), `app-mobile/src/hooks/useCalendarEntries.ts` (`useMyGoingRsvps` + `useRsvpsRealtimeSubscription`), `app-mobile/src/components/activity/CalendarTab.tsx` (`kind:"rsvp"` `UnifiedRow` + sort-merge), `app-mobile/src/components/activity/RsvpCalendarRow.tsx` (new), `app-mobile/src/components/activity/RsvpPassSheet.tsx` (new). Reuse `react-native-qrcode-svg` (already a dep).

---

## K. Test plan skeleton
**Package (offering-rendering, jest, source-of-truth render assertions):**
- `RsvpOfferingBody` renders sections 2–9 in the locked order (brand → momentum → date → doors → venue → about) for phone + desktop variants; omits empty sections (rule 9: no doors when no start, no about when empty, no party chips when none).
- Shell-agnostic: `RsvpOfferingBody` does NOT render/import `ParallaxCoverShell` (grep + render assert); the body's first child is bare content.
- Decision is the shared `RsvpMomentumDecision` (not a re-rolled control); `resolveRsvpCta` drives ctaState; A4-NEW contact gate blocks Going/Maybe until contactReady; not_going bypasses.
- Address privacy: hidden → City/Country + unlock caption, `venueMapsQuery` null; revealed (going/maybe) → exact street + maps link.
- `testID` preservation: `orch-1150-rsvp-going/maybe/not-going`, `orch-1157-rsvp-floating-dock`, `orch-1157-rsvp-address-unlock-caption`, contact field IDs — all present.
**Read path (RPC + hook):**
- `pg_public_rsvp_by_slug` returns the RSVP payload for an `event_type='rsvp'` row; returns null for an `event_type='event'`/missing/unpublished row; OMITS `address`+`location_geo` and returns `city_geo` when `hide_address_until_ticket`; never emits an exact pin for a hidden RSVP.
- `usePublicRsvpBySlug` maps the json → `{event, brand, config}`; web/business adapter reads the SAME RPC.

**Flow A — Going confirmation (offering-rendering jest):**
- Going tap (inline AND dock) with `contactReady` → `RsvpGoingConfirmDialog` opens; Going tap without contactReady → no dialog, contact errors shown.
- Confirm → `onSubmit({rsvpStatus:'going', guests})` called once; on resolve → dialog closes, `RsvpSuccessPopup` opens with eventName/dateLine/venueLine/guestName/plus-one names/status from the RESOLVED result; on reject → dialog stays open, mapped errorText shown.
- Maybe / Not-going → `onSubmit` called directly, NO dialog, NO popup. Popup title flips for resolved waitlisted/pending.
- Package isolation: `RsvpGoingConfirmDialog`/`RsvpSuccessPopup` import no `designSystem`/app-`src/`.

**Flow B — per-guest plus-ones (jest + RPC + edge):**
- Body: incrementing plus-ones reveals a name/email/phone mini-form per guest; `contactReady` blocks Going/Maybe until every guest + primary is valid; decrement removes the last guest; `guests.length === plusCount`.
- Edge fn: going/maybe with `plusCount>0` and `guests.length !== plusCount` → 400 `rsvp_guest_count_mismatch`; missing/invalid guest contact → 400 `rsvp_guest_contact_required`/`rsvp_guest_phone_invalid`; not_going forces `guests=[]`.
- RPC: `submit_event_rsvp` delete-then-insert into `event_rsvp_guests` is idempotent across re-submit; count-mismatch/contact raises; child rows match the resolved `plus_count`; capacity math (`SUM(1+plus_count)`) unchanged.
- Migration: `event_rsvp_guests` created with FK CASCADE + RLS (host-read via event_manager, owner-read via `user_id`); no anon/authenticated table write grant.

**Flow C — Calendar RSVP card + QR (jest + RPC + read):**
- RPC mints `event_rsvps.qr_code` = `mingla:v1:rsvp:<id>:sig:<64hex>` ONLY for `going` (NULL for maybe/not_going); re-submit doesn't re-mint the PRIMARY (idempotent on `qr_token_hash IS NULL`); uses the shared pepper helpers (`rsvp_token_pepper_missing` when pepper absent).
- `fetchUserGoingRsvps` returns the user's going RSVPs with event/brand/plus-one-names/qrCode; RLS scopes to `user_id = auth.uid()`.
- `CalendarTab` renders a `kind:"rsvp"` `UnifiedRow` (Active/Archive bucketed by master date); `RsvpCalendarRow` + `RsvpPassSheet` show the QR (`react-native-qrcode-svg`, value = `rsvp.qrCode`) + guest/plus-one names + status + change/cancel action; cancel submits `not_going` and invalidates `["myGoingRsvps"]`. No PDF affordance. Standard ticket/reservation rows unchanged.

**§J — per-guest pass + notify + matched-guest Calendar (RPC + edge + jest):**
- **Per-guest mint:** `submit_event_rsvp` with N plus-ones on a `going` submit writes N `event_rsvp_guests` rows EACH with a signed `event_rsvp_guests.qr_code` = `mingla:v1:rsvp:<guest_id>:sig:<64hex>` (distinct per guest, distinct from the primary); maybe/not_going → all guest `qr_code` NULL; delete-then-insert re-mint on re-submit; pepper-missing raises.
- **Verified match:** `biz_resolve_verified_user(email,phone)` returns a user_id for a VERIFIED `auth.identities` email OR a `phone_confirmed_at`-confirmed phone; returns NULL for an unverified/metadata-only contact (assert it never reads `user_metadata`/`raw_user_meta_data`); `submit_event_rsvp` sets `event_rsvp_guests.matched_user_id` accordingly.
- **Notify (edge):** after a `going` submit, `public-submit-rsvp`/`rsvp-notify` enqueues exactly ONE `rsvp_pass` email per recipient (primary + each guest, matched or not) with that recipient's own QR (PDF via the reused `qrPayloadAsPngBytes`), idempotency-keyed `rsvp_pass:<rsvp_id>:<guest_id|primary>`; PUSH fires ONLY for the signed-in primary + guests with non-null `matched_user_id` (via the reused `sendPush({app:"consumer"})` + `public.notifications` inbox insert), NOT for unmatched guests. Reuse gate: no new email/OneSignal client introduced.
- **Matched-guest Calendar:** `fetch_user_going_rsvps(user)` (or the two-select union) returns BOTH primary rows AND `event_rsvp_guests` rows where `matched_user_id = user` (parent going), each tagged `role:'primary'|'guest'` with the right `qrCode`/`displayName`/`invitedBy`; RLS/`event_rsvp_guests_owner_read OR matched_user_id=auth.uid()` scopes a guest to its OWN row only. `CalendarTab` renders a guest-role `kind:"rsvp"` row showing the guest's OWN qrCode + "Invited by {primary}"; the guest-role card hides the cancel-all CTA.
- **Capacity preserved:** minting + matching does NOT change `SUM(1+plus_count)`; maybe still cap-neutral + mints no QR/email/push.
**Surface wiring (consumer/business jest + retargeted existing tests):**
- `ConsumerEventDetailScreen` RSVP branch mounts `RsvpOfferingBody` inside `BottomSheetScrollView`; no bespoke `rsvpDock`/`rsvpMomentumUnit` remain; standard-event `EventOfferingBody` branch unchanged.
- `submitPublicRsvp` (web/business) and `submitDeckRsvp` (consumer) both satisfy `onSubmit`; maybe rides through; error codes map to copy.
- Retarget `RsvpPublicBody.maybeCta.orch1150r2`, `RsvpPublicBody.parallaxLayering.orch1150r2`, `orch_1157_rsvp_consumer`, `preview.test.tsx` to the new body/wrapper.
**Live-fire (REQUIRED for verdict above "suspected" — DEC-189 lesson):**
- The ONLY faithful WebKit cover-autoplay verification is a real Vercel/prod deploy, NOT a local harness. If RSVP rows have video covers, verify on a deployed buyer-web RSVP page in headless WebKit (`paused:false`) + Chromium (no regression). Device-verify the consumer gorhom RSVP sheet on a physical iOS + Android (no freeze, dock on-screen above the home indicator). Verify business native RSVP preview on device.
- **Explicit note:** do not mark cover-autoplay PASS off a local bed; rounds R5–R7 of ORCH-1167 false-passed exactly that way. Deploy, then verify.

---

## 13. Build/apply notes (carry the DEC-189 hazards)
- Deploy nothing from a stale worktree; **TWO migrations** are applied via the Supabase Management API (CLI is drift-wedged; MCP read-only), browser UA, then recorded in `schema_migrations`: (1) `pg_public_rsvp_by_slug` read RPC (§C); (2) `event_rsvp_guests` child table + `event_rsvps.qr_token_hash`/`qr_code` columns + **per-guest `qr_token_hash`/`qr_code`/`matched_user_id` columns (§J.1)** + redefined `submit_event_rsvp` RPC (per-guest mint + match) + `biz_rsvp_qr_payload` + **`biz_resolve_verified_user` resolver (§J.2)** + **`fetch_user_going_rsvps` read RPC (§J.6)** + the §J.1 RLS extension (`event_rsvp_guests_owner_read OR matched_user_id=auth.uid()`). (Stays TWO migration FILES — all §J SQL folds into mig 2.) `$function$` terminator before GRANT; DROP FUNCTION before re-CREATE (the `submit_event_rsvp` param list changes — DROP mandatory; the two NEW functions need no DROP). `biz_resolve_verified_user`/`fetch_user_going_rsvps` are SECURITY DEFINER, STABLE, `SET search_path=public`, GRANT EXECUTE TO `authenticated`/`service_role`, `NOTIFY pgrst`. `react-native-qrcode-svg` is already a dep (ticket QR) — no native build.
- **The `public-submit-rsvp` edge fn IS now touched** (accept `guests` + return `rsvpId`/`confirmationToken`; pass the pepper to the RPC; **§J.4/§J.5: after a `going` submit, enqueue the per-recipient `rsvp_pass` email + matched-guest/primary push**). **`rsvp-notify` is ALSO touched** (add the `rsvp_pass` template branch + `buildRsvpPassPdf`; it ALREADY owns the `sendPush`+`_shared/email`+`rsvp_notifications` machinery — extend, do NOT fork). Deploy BOTH from MERGED main (clobber hazard); both run `verify_jwt=false` under service-role. The QR pepper comes from `qrTokenPepper()` (same env secret `ticket-checkout-confirm` uses) — confirm set. The OneSignal env (`ONESIGNAL_APP_ID`/`ONESIGNAL_REST_API_KEY`) + Resend env (`RESEND_API_KEY`/`RESEND_TICKET_FROM`) are ALREADY set for the consumer-app push + ticket email — no new secrets. NO new edge function (scanner is OUT §I.5; back-match is OUT §J.2). **REUSE-ONLY for notify/match — do NOT add a parallel email/OneSignal/matcher client.**
- No native build needed (no new native dep) — OTA pure-JS per platform on close (biz runtime 1.0.0, app runtime 1.1.0; `npx -y eas-cli@latest update`, per-platform, never `--platform all`).
- buyer-web ships via Vercel `[deploy]` (mind the `[deploy]`-gate cancel trap — a non-`[deploy]` commit after yours cancels the web build; push an empty `[deploy]` commit if needed). buyer-web CANNOT be OTA'd. NOTE: buyer-web RSVP guests are anon (no Calendar/QR — flow C is consumer-app only; the success popup omits the Calendar nudge when `!isLoggedIn`).

---

## OPEN QUESTIONS / blocking unknowns for Seth
1. **OQ-1 (read-path approval):** confirm NEW `pg_public_rsvp_by_slug` (recommended) vs branching `pg_public_event_by_slug` on `event_type`. Spec assumes NEW. *(Low risk; pattern-consistent.)*
2. **OQ-2 (post-RSVP street reveal):** the client reveals the exact street once the viewer's own RSVP is going/maybe, but the anon RPC returns city-only. For a TRULY anon (logged-out) going/maybe guest, the street is only in client state after submit — confirm whether the body should re-fetch a server-authenticated unlock (OUT of scope here, mirrors ORCH-1167 OQ-2) or keep the existing client-reveal behavior (spec assumes KEEP — no regression from today).
3. **OQ-3 (wrapper naming/location):** confirm the thin surface wrapper name `FoundationRsvpPreview` (mirrors `FoundationEventPreview`) and that `RsvpPublicBody.tsx` is DELETED (not kept as a re-export). Spec assumes DELETE.
4. **OQ-4 (video covers on RSVP):** do RSVP rows actually carry video covers in prod today? If none exist yet, the imperative-video invariant is preventative (still required); flag if a synthetic video-cover RSVP fixture is needed to live-verify WebKit autoplay.
5. **OQ-5 — LOCKED ✅ YES (Seth-confirmed):** per-guest name+email+phone is **UNIVERSAL**, including the ANON buyer-web Going guest (3 fields PER plus-one, vs the old single integer). FULL contact (name + email + phone, same `EMAIL_RE`/`PHONE_RE` regex as the primary) is required for EVERY plus-one on EVERY surface — NOT name-only for anon. This is intentional friction: each plus-one is now a first-class invited guest who receives their own ticket/pass (§J). No further product call needed.
6. **OQ-6 — LOCKED ✅ host-scanner is a registered FOLLOW-ON (Seth-confirmed):** this leg MINTS the per-guest `mingla:v1:rsvp:` tokens NOW (primary + every plus-one) and renders them as QRs; full host-side scanning/check-in (a `biz_rsvp_scan` RPC + a payload-kind switch in the `tickets`-only scanner + a host RSVP-scanner entry point) is a discrete follow-on **`ORCH-XXXX rsvp-host-checkin`** the orchestrator must register. Tokens are minted in the correct signed format so the follow-on is drop-in. (§I.5 / §J unchanged.)
7. **OQ-7 — LOCKED ✅ cancel = soft submit `not_going` (Seth-confirmed):** the Calendar `RsvpPassSheet` change/cancel action submits `not_going` (cap-neutral, removes from going) — NOT a hard delete of the `event_rsvps` row. Preserves history + the ORCH-1150 non-terminal model. On a `not_going` cancel the parent row stays (history preserved) and is no longer `going`, so all passes (primary + per-guest) are inert. The PRIMARY token persists idempotently (`event_rsvps.qr_token_hash IS NULL` gate, §I.2); per-guest child rows + their tokens follow the §H.4 delete-then-insert lifecycle on any later re-submit (a re-`going` re-mints fresh per-guest passes — see §J.4). Either way no stale pass admits a cancelled party.
