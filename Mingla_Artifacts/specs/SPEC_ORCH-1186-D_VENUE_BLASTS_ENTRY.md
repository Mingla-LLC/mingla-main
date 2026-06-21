# SPEC — ORCH-1186-D: Blasts entry point in the venue tab

**META:** META-ORCH-1186 (Venue Unification) · **Leg 4 of 4** (smallest; REUSE ONLY)
**Mode:** SPEC · **Author:** mingla-forensics · **Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify` (at origin/main `89ab7f3ff`, incl. venue command-center desktop redesign #580)
**Charter:** `Mingla_Artifacts/specs/CHARTER_META-ORCH-1186_VENUE_UNIFICATION.md` (DEC-D: blasts already exist — Leg 4 only SURFACES the existing composer)

> **Comms scan:** read `COMMS_LEDGER.md` on entry. No BLOCK entry targets `mingla-forensics`, `ORCH-1186`, or `ALL`. WARN entries COMMS-0040/0041 concern public RSVP/experience **page-body** standardization (`RsvpPublicBody`, `ExperiencePreview`, `packages/offering-rendering`) — NOT blasts/marketing/venue-suite; not relevant to this leg, no files overlap. Noted, not acted on. META-ORCH-1161 (notifications/channels standardization) is the live sibling for blast CHANNEL direction — coordinate (§4 alignment note), do not block.

---

## 1. Executive summary

A venue owner managing their venue in the business app (Hub → Venue tab → venue suite) currently has **no way to message their guests from inside the venue suite**. The blast/marketing composer already exists and is fully shipped (Marketing Hub + per-brand + per-event Blasts surfaces), and the composer accepts a pre-selected audience via a query param. This leg adds **one blast action** in the venue suite (the **Settings module**, command band) that deep-links into the **existing** composer with the venue's audience pre-selected. No new composer, no new send/dispatch code, no new tables, no new audience-resolver query — pure navigation + audience pre-selection through the existing `?audience={kind}:{id}` contract.

**The one open dependency (see §10 OQ-1):** the existing pre-selectable brand audience (`brand_buyers`) is **orders-derived** (ticket buyers only). A pure-reservations venue that has never sold event tickets resolves to an **empty** audience. Surfacing the entry point is in-scope and cheap; making the audience *cover reservation guests* would require a NEW audience kind (new resolver + new param kind) — explicitly OUT of this REUSE-ONLY leg. Flagged for Seth's decision before/at implement.

---

## 2. Scope & non-goals

### In scope
- Add **one** "Message your guests" / "Send a blast" action inside the venue suite, hosted in the **Settings module** (`VenueSettingsModule.tsx`), command band.
- Tapping it navigates to the **existing** composer route `/marketing/campaigns/compose?audience=brand:{brandId}` (the venue's own brand id), using the **existing** `?audience={kind}:{id}` pre-fill contract.
- Add **one** tiny pure href-builder helper (`buildComposeAudienceHref`) so the entry point — and the 3 existing call sites — share a single, testable URL string (regression anchor; §9).
- A light happy-path regression test that proves the venue entry navigates with the correct `audience=brand:{brandId}` param and fails-on-revert.

### Non-goals (explicit)
- **NO** new composer, editor, review sheet, send path, or dispatch code. The composer (`app/(tabs)/marketing/campaigns/compose.tsx`) and its send pipeline are reused verbatim, untouched.
- **NO** new database tables, columns, RLS, migrations, or edge functions.
- **NO** new audience kind / new audience resolver. The leg reuses `audience=brand:{brandId}` → `ensureBrandBuyersAudience` → `resolveBrandBuyers` exactly as-is.
- **NO** change to `parseAudienceParam` (kinds stay `brand | event`), `BlastCustomersCta`, `marketingAudienceService`, or any composer hook/service.
- **NO** standalone full-screen venue "Blasts" list route (like `/brand/[id]/blasts`). The dispatch + charter ask only for an *entry point* in the venue tab; a full buyer-list surface already exists at `/brand/[id]/blasts` and is reachable from the Marketing Hub. (If Seth later wants the list reachable from the venue tab too, that's a one-line nav to that existing route — noted OQ-2.)
- **NO** reservation-guest audience (see OQ-1 — a dependency, NOT built here).

### Assumptions
- A venue IS a brand row: the venue suite is keyed on `brandId` (`VenueSuiteShell({ brandId })` → `VenueSettingsModule({ brandId })`), so the venue's brand id is already in hand at the entry point. **Verified** `VenueSettingsModule.tsx:` takes `brandId` and already imports `useRouter` from `expo-router`.
- The composer's `brand` audience kind keys on the brand id (`ensureBrandBuyersAudience({ brand_id })`), so `audience=brand:{brandId}` is the correct venue-scoped audience under the REUSE-ONLY constraint.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

The venue suite is a **business-app** surface (Hub → Venue tab). The composer is business-app + business-web. Parity is **automatic** — `VenueSettingsModule` is one shared RN component rendered on iOS, Android, and business web; the composer route is shared. No consumer / buyer-web / admin involvement.

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile`) | NO | n/a — venue management is business-app only | none | n/a |
| 2 | Consumer Android (`app-mobile`) | NO | n/a | none | n/a |
| 3 | Buyer/anon Web (`mingla-business` public) | NO | n/a — public venue page reads hours/menu (other legs), not blasts | none | n/a |
| 4 | Business iOS | YES | New "Message your guests" action in the venue Settings module → opens existing composer pre-scoped to this venue's brand audience | `VenueSettingsModule.tsx` (+1 helper, +1 test) | Automatic (shared RN component + shared composer route) |
| 5 | Business Android | YES | Same as iOS | same | Automatic (shared) |
| 6 | Admin Web (`mingla-admin`, adjacent) | NO | n/a | none | n/a |
| 7 | Business Web preview (adjacent) | YES (free) | Same action renders on business web; the composer already supports wide-desktop | same (shared) | Automatic (shared) |

Because surfaces 4/5/7 are one shared component + one shared route, success criteria are **NOT** split per-surface (parity is automatic, not manual).

---

## 4. Layered specification

Only two layers are touched (UI + a pure util). DB / edge / service / hook / realtime layers are **unaffected and explicitly NOT touched** (the entire point of REUSE-ONLY).

### 4.1 Utility (NEW — tiny, pure, testable)

**File:** `mingla-business/src/utils/composeAudienceHref.ts` (NEW)

```ts
// Single source of truth for the composer deep-link (I-PROPOSED-BU param shape).
export function buildComposeAudienceHref(kind: "brand" | "event", id: string): string
```
- Returns exactly `` `/marketing/campaigns/compose?audience=${kind}:${id}` ``.
- Pure, no RN/expo imports (jest-testable in isolation, mirroring `parseAudienceParam.ts`).
- Mirrors `parseAudienceParam`'s kind union (`"brand" | "event"`) so the produced URL always round-trips through the parser. (Importing `AudienceKind` from `parseAudienceParam.ts` is allowed and preferred to keep the union in lockstep.)
- This helper is the **regression anchor** (§9): the existing 3 hand-built call sites (`brand/[id]/blasts.tsx:73`, `event/[id]/blasts/index.tsx:66`, `(tabs)/marketing/audiences/index.tsx:49/62/70`) MAY be refactored to call it (recommended, low-risk, byte-identical output) but that refactor is **optional** and must NOT change their behavior. The venue entry point MUST use it.

### 4.2 Component — venue Settings module (the entry point)

**File:** `mingla-business/src/components/venue/VenueSettingsModule.tsx` (MODIFY)

Add ONE action row in the command-band Settings module (it already hosts venue profile / policies actions, already has `brandId` + `useRouter`):

- **Action row:** label **"Message your guests"**, supporting line **"Email or text the people who've bought from this venue."** (copy honest about the orders-derived audience — see OQ-1). Use the module's existing row/Pressable pattern (it already renders `Pressable` rows per `VenueSettingsModule.tsx:22`). Reuse an existing list-row/section primitive already in the file — do NOT introduce a new card style.
- **Handler:**
  ```ts
  const handleBlast = useCallback(() => {
    if (brandId === null) return;
    router.push(buildComposeAudienceHref("brand", brandId) as never);
  }, [router, brandId]);
  ```
- **States:**
  - **Enabled** (default when `brandId !== null`): tappable, navigates.
  - **Disabled** (`brandId === null`): row rendered disabled (dimmed, no tap), same convention the module already uses for unavailable actions. (Defensive only — Settings is not reachable without a brand.)
  - **No loading/error/empty state needed** — navigation is synchronous; the composer owns its own audience-load skeleton + error toast (verified `compose.tsx:650` pre-fill skeleton + `compose.tsx:216` audience-load error banner).
- **a11y:** `accessibilityRole="button"`, `accessibilityLabel="Message your guests"`, `accessibilityState={{ disabled }}`. Hit target ≥44pt (the module's row primitive already satisfies this; verify).
- **Placement:** within the venue-profile / actions section of Settings (a "command" action), beneath the existing profile/policy rows. Exact section TBD by the implementor against the file's current structure — it must be a peer of the existing action rows, NOT a new floating CTA, and must NOT disturb the reservations toggle / fee / policy controls.

### 4.3 Layers explicitly NOT touched
- **Database / RLS / migrations:** none. `marketing_campaigns / _audiences / _messages / _clicks` and `brands` unchanged.
- **Edge functions:** none (`marketing-send`, `track-click`, `unsubscribe` untouched).
- **Service:** `marketingAudienceService.ts`, `marketingCampaignService.ts` untouched.
- **Hooks:** `useResolveAudience`, `parseAudienceParam`, `useBrandCustomers` untouched.
- **Composer:** `app/(tabs)/marketing/campaigns/compose.tsx`, `BlastCustomersCta.tsx`, all `ComposerV2/*` untouched.

---

## 5. Success criteria

- **SC-1** — A venue owner on the Venue tab → Settings module sees a **"Message your guests"** action row (enabled when the venue has a brand id). *(Observable: row present + tappable in `VenueSettingsModule`.)*
- **SC-2** — Tapping it calls `router.push("/marketing/campaigns/compose?audience=brand:{brandId}")` with **this venue's brand id**. *(Observable: navigation arg equals the exact string; verified by unit test on the handler/helper.)*
- **SC-3** — On arrival, the existing composer pre-selects the brand audience: the Who row shows "All brand buyers" and reach counts (this is **existing** composer behavior via `ensureBrandBuyersAudience` at `compose.tsx:198`, reused — NOT re-implemented). *(Observable: composer Who row populated; no new code proves this — it is the existing contract.)*
- **SC-4** — `buildComposeAudienceHref("brand", id)` returns exactly `/marketing/campaigns/compose?audience=brand:{id}`, and that output parses back via `parseAudienceParam` to `{ kind: "brand", id }`. *(Observable: round-trip unit test.)*
- **SC-5** — Disabled state: when `brandId === null`, the row is non-interactive (no navigation fires). *(Observable: handler early-returns; row `accessibilityState.disabled === true`.)*
- **SC-6** — No regression to the existing 3 composer entry points (brand blasts, event blasts, audiences) — their produced URLs are byte-identical whether or not refactored onto the helper. *(Observable: existing composer-entry tests still green; if refactored, the new helper produces the same string.)*

---

## 6. Invariants

### Preserved
- **I-PROPOSED-BU** (audience pre-fill param shape `{kind}:{id}`): the venue entry produces a URL that conforms exactly; `buildComposeAudienceHref` + the §9 round-trip test enforce it. The new helper does not widen the kind union.
- **I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE** (`venueModules.test.ts`): UNAFFECTED — the blast action lives **inside** the Settings module body, NOT in the module registry (`venueModules.ts` is NOT touched), so the booking-band gate is untouched. **Hard guard:** do NOT add a `"blasts"` module to `VENUE_MODULES` / `deriveVenueModules` — that would alter the rail and flip the gate test. The blast action is an in-Settings row, not a rail module.
- Constitution #9 (no fabricated affordance): the action is real and its downstream (composer) is fully built. Copy is honest about the orders-derived audience (OQ-1) so a zero-buyer venue isn't promised a non-empty audience.

### New
- **I-PROPOSED-1186-D-BLAST-REUSE-ONLY** (DRAFT — flips ACTIVE on META close): the venue blast entry point navigates to the existing `/marketing/campaigns/compose` route via the shared `?audience={kind}:{id}` param and introduces NO new composer/send/dispatch code, NO new audience kind, and NO new tables. Enforced by: (a) the §9 helper round-trip test; (b) allowlist (§ allowlist) forbidding edits to composer/service/migration files.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-1 (happy) | Build venue blast href | `buildComposeAudienceHref("brand", "<uuid>")` | `"/marketing/campaigns/compose?audience=brand:<uuid>"` | util |
| T-2 (round-trip) | Helper output parses back | parse output of T-1 with `parseAudienceParam` | `{ kind: "brand", id: "<uuid>" }` | util |
| T-3 (event parity) | Helper covers existing event kind | `buildComposeAudienceHref("event", "<uuid>")` | `"/marketing/campaigns/compose?audience=event:<uuid>"` | util |
| T-4 (entry nav) | Tap venue blast row with a brand id | render `VenueSettingsModule` with `brandId="<uuid>"`, press the row | `router.push` called once with `"/marketing/campaigns/compose?audience=brand:<uuid>"` | component |
| T-5 (disabled) | No brand id | render with `brandId={null}`, press the row | `router.push` NOT called; row `accessibilityState.disabled === true` | component |
| T-6 (no-regress) | Existing entries unchanged | run existing composer-entry / `parseAudienceParam` tests | all green; produced URLs identical | component/util |

---

## 8. Implementation order

1. **Util:** create `mingla-business/src/utils/composeAudienceHref.ts` (`buildComposeAudienceHref`), importing `AudienceKind` from `src/hooks/marketing/parseAudienceParam.ts`.
2. **Test:** create `mingla-business/src/utils/__tests__/composeAudienceHref.test.ts` (T-1..T-3 + round-trip via `parseAudienceParam`).
3. **Component:** modify `mingla-business/src/components/venue/VenueSettingsModule.tsx` — add the "Message your guests" action row + `handleBlast` using the helper, matching the file's existing row primitive + disabled convention.
4. **Component test:** add/extend a `VenueSettingsModule` test (or a focused new test) for T-4/T-5 (mock `expo-router` `useRouter`, assert `push` arg).
5. *(Optional, recommended)* refactor the 3 existing hand-built call sites onto `buildComposeAudienceHref` — byte-identical output, no behavior change. Skip if it risks scope; the helper does not require it.

---

## 9. Regression prevention (fails-on-revert)

**Structural safeguard:** the composer deep-link URL is centralized in `buildComposeAudienceHref` (one place), and the venue entry point MUST route through it.

**Fails-on-revert test contract:**
- **T-1/T-2** in `composeAudienceHref.test.ts`: assert the exact URL string AND that it parses back through `parseAudienceParam`. If someone reverts the helper to a malformed/changed shape (e.g. drops the `audience=` key, or changes `{kind}:{id}` separator), T-1 fails; if the param shape diverges from the parser, T-2 fails. Restoring the correct shape makes both pass.
- **T-4** in the `VenueSettingsModule` test: asserts `router.push` is called with the brand-scoped href. If the entry point is removed or wired to the wrong audience (e.g. `event:` or a hardcoded id), T-4 fails. Restoring the correct wiring passes.

**Protective comment** (in the helper + at the venue handler): *"ORCH-1186-D / I-PROPOSED-BU: the composer deep-link param shape `?audience={kind}:{id}` is a binding contract with `parseAudienceParam`. Do not inline a divergent URL — use `buildComposeAudienceHref` so the round-trip test guards it."*

---

## 10. Open questions

- **OQ-1 (DEPENDENCY — needs Seth's decision before/at implement):** the reused `brand` audience (`brand_buyers`) is **orders-derived** — `resolveBrandBuyers` (`marketingAudienceService.ts:119`) returns "every distinct buyer of any event under that brand (paid/partial_refund)". A **pure-reservations venue** that has never sold event tickets resolves to an **EMPTY** audience, and reservation guests (who live in the ORCH-1148 reservations table, `20261012000001_orch_1148_2_2_reservations_guest_fields.sql`, NOT in `orders`) are **not reachable** through this entry point today.
  - **Under DEC-D (REUSE ONLY), this leg ships the entry point as-is** (audience = the brand's ticket buyers), with honest copy ("…people who've bought from this venue"). For ticket-selling venues this is fully correct and useful immediately.
  - **A "reservation guests" audience is a NEW audience kind** = a new `parseAudienceParam` kind + a new resolver (mirroring `resolveRsvpGuests`, which ORCH-1150 added for the RSVP gap) + a new `ensure*Audience` seeder. That is **new code, OUT of this REUSE-ONLY leg.** **FLAGGED for your decision:** (a) ship the entry point now against `brand_buyers` only (this SPEC), and file the reservation-guest audience as a separate follow-on ORCH; or (b) hold Leg 4 until a `venue_reservation_guests` audience kind is built first. Recommend (a) — it satisfies the charter's "blast entry point" goal immediately and keeps Leg 4 cheap; the reservation-guest audience is a clean, well-scoped follow-on that also benefits the Marketing Hub.
- **OQ-2 (minor):** should the venue tab ALSO expose the existing full buyer-list Blasts surface (`/brand/[id]/blasts`) — e.g. a "View / message buyers" link — or is the direct-to-composer entry enough? Direct-to-composer is the cheaper, charter-minimal answer; the list is one extra nav line to an existing route if wanted.
- **OQ-3 (META-ORCH-1161 alignment):** the composer now has a channel selector (Email · SMS · RCS, `ChannelTabs`, `compose.tsx:704`) from META-ORCH-1161. This leg lands the venue owner on that same composer, so channel direction is inherited automatically — **no channel work in this leg.** Confirm 1161 does not change the `?audience=` param contract (it has not as of `89ab7f3ff`).

---

## 11. Downstream routing

**Next = mingla-implementor (business side).** Working tree: `~/Desktop/mingla-orchs/1186-[venue-unify]` on branch `1186-venue-unify`. Build per §8 (util + helper test → `VenueSettingsModule` row + component test), honoring the allowlist + do-not-touch below; prove §9 fails-on-revert; do NOT touch `venueModules.ts` (booking-gate invariant) or any composer/service/migration file. **Blocked on OQ-1 decision** — implementor should proceed with option (a) (entry point against `brand_buyers`, honest copy) unless Seth directs otherwise. Then → mingla-tester (adversarial: confirm nav arg + composer pre-fill + disabled state + no booking-rail regression) → orchestrator CLOSE (flip `I-PROPOSED-1186-D-BLAST-REUSE-ONLY` ACTIVE). This is the smallest leg; sequencing per charter DEC-A is Leg 1 → 2 → **4** → 3.

---

## Scoped allowlist + DO-NOT-TOUCH

### Allowlist (implementor MAY create/modify ONLY these)
- `mingla-business/src/utils/composeAudienceHref.ts` (NEW)
- `mingla-business/src/utils/__tests__/composeAudienceHref.test.ts` (NEW)
- `mingla-business/src/components/venue/VenueSettingsModule.tsx` (MODIFY — add one action row + handler)
- `mingla-business/src/components/venue/__tests__/VenueSettingsModule.*.test.tsx` (NEW or extend, for T-4/T-5)
- *(OPTIONAL, byte-identical refactor only)* `mingla-business/app/brand/[id]/blasts.tsx`, `mingla-business/app/event/[id]/blasts/index.tsx`, `mingla-business/app/(tabs)/marketing/audiences/index.tsx` — only to route through the new helper; behavior MUST be unchanged.

### DO-NOT-TOUCH (stop-and-amend before any edit)
- `mingla-business/src/components/venue/venueModules.ts` + its test — touching the module registry flips I-PROPOSED-1148-RESERVATION-TOGGLE-GATES-SUITE. The blast action is an in-Settings row, NOT a rail module.
- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx` and all `mingla-business/src/components/marketing/**` (composer, `BlastCustomersCta`, `ComposerV2/*`).
- `mingla-business/src/services/marketing/**`, `mingla-business/src/hooks/marketing/**` (incl. `parseAudienceParam.ts` — read/import only, do NOT modify the kind union).
- `supabase/migrations/**`, `supabase/functions/**` — no DB / edge changes.
- `VenueSuiteShell.tsx` — the entry lives in `VenueSettingsModule`, not the shell. (Touch only if the implementor finds the Settings module genuinely cannot host an action row — in which case stop-and-amend with evidence.)
