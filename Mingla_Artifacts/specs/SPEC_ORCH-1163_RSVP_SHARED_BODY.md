# SPEC — ORCH-1163 · [rsvp-shared-body] · ONE shared shell-agnostic RSVP body

**META:** META-ORCH-1166 — public offering-page single source of truth. **LEG 2 of 4 (RSVP).**
**Pattern source (binding precedent):** ORCH-1167 [event-page-canonical] / DEC-189 — LEG 1 (standard ticketed event). This spec REPLICATES that proven playbook for `event_type='rsvp'`.
**Inputs read:** `INVESTIGATE_ORCH-1163_RSVP_PUBLIC_PAGE_SOT.md` (3 render paths, 2 bodies), DEC-189, the live `RsvpPublicBody.tsx` / `EventOfferingBody.tsx` / `usePublicEventBySlug.ts` / `pg_public_event_by_slug.sql` / `ConsumerEventDetailScreen.tsx` RSVP branch / `rsvpDeckService.ts`.
**Status:** SPEC — binding contract. DO NOT implement from this header; implement from §3–§13.
**Branch/worktree:** `ORCH-1163-rsvp-shared-body` off latest merged main (one rendering package `@mingla/offering-rendering`; `event-rendering` dissolved by ORCH-1169).

---

## 1. Problem (one line)
The RSVP public page has THREE render paths but TWO distinct bodies: buyer-web + business share `mingla-business/src/components/event/RsvpPublicBody.tsx`; the consumer app FORKS it as a hand-mirrored RSVP branch in `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`; and the read path is split (web reads `business_public_events_view` via the adapter; consumer reads the same view via `rsvpDeckService.fetchRsvpMomentum` + builds props from the deck seed). The body lives in `mingla-business/src/` so `app-mobile` cannot import it → forced fork → drift risk. This is the exact gap ORCH-1167 already solved for the standard event.

## 2. Goal (the contract, in one paragraph)
Promote `RsvpPublicBody` into `packages/offering-rendering` as ONE shared, **shell-agnostic** RSVP body named **`RsvpOfferingBody`**, rendered byte-identically on buyer-web + business iOS/Android + consumer iOS/Android. RETIRE the consumer hand-mirror (the `ConsumerEventDetailScreen` RSVP branch mounts `RsvpOfferingBody`). UNIFY the read path behind ONE canonical anon RPC `pg_public_rsvp_by_slug`. PRESERVE every single-owner already in place: the shared `RsvpMomentumDecision`, `resolveRsvpCta`, the `submitPublicRsvp → public-submit-rsvp` write path, the ORCH-1150 maybe=cap-neutral/auto-approve rules, and the ORCH-1157 Direction-C momentum redesign. NO ticket box (RSVP is money-free); the decision surface stays the Going/Maybe/Can't `RsvpMomentumDecision` + the contact/submit flow.

---

## 3. Current `RsvpPublicBody.tsx` SECTION LIST (the exact thing to preserve)
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
  // contact + submit (the SINGLE write path — see §D):
  onSubmit: (input: {
    rsvpStatus: "going" | "not_going" | "maybe";
    guestName: string;
    guestEmail: string;
    guestPhone: string;
    plusCount: number;
  }) => Promise<{
    status: "going" | "not_going" | "waitlisted" | "maybe";
    approvalStatus: "pending" | "approved";
  }>;
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

## E. DRAFT invariants (register DRAFT in this SPEC; flip ACTIVE at CLOSE)
- **I-PROPOSED-1163-RSVP-ONE-SHARED-BODY** — the public RSVP page body is ONE shared `RsvpOfferingBody` in `packages/offering-rendering`, rendered identically on buyer-web + business iOS/Android + consumer iOS/Android. No per-surface RSVP body fork (the `RsvpPublicBody` web/business body + the `ConsumerEventDetailScreen` RSVP hand-mirror are retired — do not reintroduce). *Enforcement:* package-isolation gate + a strict-grep gate asserting no RSVP body lives outside `packages/offering-rendering` + the offering-rendering RSVP render tests; fails-on-revert.
- **I-PROPOSED-1163-RSVP-SHELL-AGNOSTIC** — `RsvpOfferingBody` hosts NO scroll root and NO cover host; the cover is a surface-pinned sibling and the decision dock is surface-pinned. The body must never wrap `ParallaxCoverShell` (re-triggers the gorhom freeze on consumer). *Enforcement:* a grep/AST gate asserting `RsvpOfferingBody.tsx` does not import/render `ParallaxCoverShell`; the consumer parallax-layering safety-net test.
- **I-PROPOSED-1163-RSVP-ONE-READ-PATH** — the public RSVP page reads through exactly ONE canonical anon RPC `pg_public_rsvp_by_slug` across every surface; no surface re-derives the page payload from a second query path. *Enforcement:* the migration applied to prod + recorded in `schema_migrations`; single-owner read; live-smoke-verified.
- **I-PROPOSED-1163-RSVP-COVER-IMPERATIVE-VIDEO** — the RSVP cover video on web is rendered via the imperative-DOM `document.createElement('video')` primitive (reusing `EventCoverMedia`), never a React-rendered `<video>` (DEC-189 WebKit denial). *Enforcement:* the ORCH-0978 web-video gate (already updated to accept the imperative-DOM primitive) covers the RSVP cover path; live WebKit deploy verification.

---

## F. Affected Surfaces
**IN scope:** iOS-consumer, Android-consumer, business-iOS, business-Android, buyer-web.
**NOT in scope:** admin-web; trip leg; experience leg (their own META-ORCH-1166 legs); the host console/wizard authenticated screens (`mingla-business/app/rsvp/[id]/{index,edit,guests,create}.tsx`, `RsvpCreatorWizard.tsx`) — only the public `preview.tsx` is touched. No widening: RSVP-only, no trip/experience/standard-event changes beyond reusing the now-single `@mingla/offering-rendering` primitives.

---

## G. Test plan skeleton
**Package (offering-rendering, jest, source-of-truth render assertions):**
- `RsvpOfferingBody` renders sections 2–9 in the locked order (brand → momentum → date → doors → venue → about) for phone + desktop variants; omits empty sections (rule 9: no doors when no start, no about when empty, no party chips when none).
- Shell-agnostic: `RsvpOfferingBody` does NOT render/import `ParallaxCoverShell` (grep + render assert); the body's first child is bare content.
- Decision is the shared `RsvpMomentumDecision` (not a re-rolled control); `resolveRsvpCta` drives ctaState; A4-NEW contact gate blocks Going/Maybe until contactReady; not_going bypasses.
- Address privacy: hidden → City/Country + unlock caption, `venueMapsQuery` null; revealed (going/maybe) → exact street + maps link.
- `testID` preservation: `orch-1150-rsvp-going/maybe/not-going`, `orch-1157-rsvp-floating-dock`, `orch-1157-rsvp-address-unlock-caption`, contact field IDs — all present.
**Read path (RPC + hook):**
- `pg_public_rsvp_by_slug` returns the RSVP payload for an `event_type='rsvp'` row; returns null for an `event_type='event'`/missing/unpublished row; OMITS `address`+`location_geo` and returns `city_geo` when `hide_address_until_ticket`; never emits an exact pin for a hidden RSVP.
- `usePublicRsvpBySlug` maps the json → `{event, brand, config}`; web/business adapter reads the SAME RPC.
**Surface wiring (consumer/business jest + retargeted existing tests):**
- `ConsumerEventDetailScreen` RSVP branch mounts `RsvpOfferingBody` inside `BottomSheetScrollView`; no bespoke `rsvpDock`/`rsvpMomentumUnit` remain; standard-event `EventOfferingBody` branch unchanged.
- `submitPublicRsvp` (web/business) and `submitDeckRsvp` (consumer) both satisfy `onSubmit`; maybe rides through; error codes map to copy.
- Retarget `RsvpPublicBody.maybeCta.orch1150r2`, `RsvpPublicBody.parallaxLayering.orch1150r2`, `orch_1157_rsvp_consumer`, `preview.test.tsx` to the new body/wrapper.
**Live-fire (REQUIRED for verdict above "suspected" — DEC-189 lesson):**
- The ONLY faithful WebKit cover-autoplay verification is a real Vercel/prod deploy, NOT a local harness. If RSVP rows have video covers, verify on a deployed buyer-web RSVP page in headless WebKit (`paused:false`) + Chromium (no regression). Device-verify the consumer gorhom RSVP sheet on a physical iOS + Android (no freeze, dock on-screen above the home indicator). Verify business native RSVP preview on device.
- **Explicit note:** do not mark cover-autoplay PASS off a local bed; rounds R5–R7 of ORCH-1167 false-passed exactly that way. Deploy, then verify.

---

## 13. Build/apply notes (carry the DEC-189 hazards)
- Deploy nothing from a stale worktree; the RPC migration is applied via the Supabase Management API (CLI is drift-wedged; MCP read-only), browser UA, then recorded in `schema_migrations`. `$function$` terminator before GRANT; DROP before CREATE.
- No new edge function (the write path `public-submit-rsvp` is untouched). No native build needed unless a native dep changes (none here) — OTA pure-JS per platform on close (biz runtime 1.0.0, app runtime 1.1.0; `npx -y eas-cli@latest update`, per-platform, never `--platform all`).
- buyer-web ships via Vercel `[deploy]` (mind the `[deploy]`-gate cancel trap — a non-`[deploy]` commit after yours cancels the web build; push an empty `[deploy]` commit if needed). buyer-web CANNOT be OTA'd.

---

## OPEN QUESTIONS / blocking unknowns for Seth
1. **OQ-1 (read-path approval):** confirm NEW `pg_public_rsvp_by_slug` (recommended) vs branching `pg_public_event_by_slug` on `event_type`. Spec assumes NEW. *(Low risk; pattern-consistent.)*
2. **OQ-2 (post-RSVP street reveal):** the client reveals the exact street once the viewer's own RSVP is going/maybe, but the anon RPC returns city-only. For a TRULY anon (logged-out) going/maybe guest, the street is only in client state after submit — confirm whether the body should re-fetch a server-authenticated unlock (OUT of scope here, mirrors ORCH-1167 OQ-2) or keep the existing client-reveal behavior (spec assumes KEEP — no regression from today).
3. **OQ-3 (wrapper naming/location):** confirm the thin surface wrapper name `FoundationRsvpPreview` (mirrors `FoundationEventPreview`) and that `RsvpPublicBody.tsx` is DELETED (not kept as a re-export). Spec assumes DELETE.
4. **OQ-4 (video covers on RSVP):** do RSVP rows actually carry video covers in prod today? If none exist yet, the imperative-video invariant is preventative (still required); flag if a synthetic video-cover RSVP fixture is needed to live-verify WebKit autoplay.
