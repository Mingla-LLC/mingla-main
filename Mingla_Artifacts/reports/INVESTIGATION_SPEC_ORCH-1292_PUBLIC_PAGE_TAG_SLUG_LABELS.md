# INVESTIGATION + SPEC — ORCH-1292 [public-page-tag-slug-labels]

- **ORCH-ID:** ORCH-1292
- **Label:** [public-page-tag-slug-labels]
- **Classification:** `bug` + `ux`
- **Severity:** S2-medium
- **Status:** in spec (INVESTIGATE complete → SPEC written; next = implementor)
- **Working tree:** `~/Desktop/mingla-orchs/ORCH-1292-[public-page-tag-slug-labels]/` on branch `ORCH-1292-public-page-tag-slug-labels` (rebased on origin/main, HEAD `359ce621a`)
- **Anchor (never edited):** `~/Desktop/mingla-main`
- **Author:** mingla-forensics
- **Date:** 2026-07-03

---

## 1. Layman summary

On a public event page, the little tag pills under the event name are printing the raw
computer code for each tag instead of the friendly words. A pool-party event shows
`pool-party`, `afrobeats`, `hiphop-rap`, `rnb-soul` instead of "Pool Party", "Afrobeats",
"Hip-Hop/Rap", "R&B/Soul".

The friendly names already exist — Mingla keeps a canonical list that pairs every tag's code
(`pool-party`) with its display name ("Pool Party"). The public page just never looks the name
up; it prints the code verbatim. The exact same page-body code is shared by all five public
surfaces (buyer web, consumer iOS/Android, business iOS/Android preview), so **one fix in one
shared place corrects every surface at once** — and one shared fix also makes it impossible to
fix one surface and forget another.

The catch: the shared page-body package is walled off by design (invariant
I-MOR-0827-PACKAGE-ISOLATION) and is not allowed to reach into the apps to borrow their copy of
the name list. So the fix adds a tiny self-contained name-resolver **inside** the shared package,
plus a CI guard that fails the build if that in-package list ever drifts from the canonical
source. Unknown/future tags fall back to a tidy Title-Case of the code (so a brand-new tag never
prints raw kebab-case again).

This is display-only. No database, no network, no pricing, no filtering logic is touched — those
all run upstream on separate values and keep using the raw slugs exactly as they do today.

---

## 2. Root cause — with file:line evidence

The shared, props-only package `@mingla/offering-rendering` renders the taxonomy **slug** arrays
directly as pill/chip text, never resolving them to their labels.

### F-1 — `EventOfferingBody.tsx` pills row renders raw slugs (CONFIRMED ROOT CAUSE)

`packages/offering-rendering/EventOfferingBody.tsx`

```
244:  const vibeTags = event.vibeTags ?? [];
245:  const partyTypes = event.partyTypes ?? [];
246:  const musicGenres = event.musicGenres ?? [];
...
337:        {vibeTags.map((tag, i) => (
338:          <Pill key={`vibe-${i}`} palette={palette} surface={surface} font={boldFamily}>
339:            {tag}            // ← raw slug, e.g. "laid-back"
340:          </Pill>
341:        ))}
342:        {partyTypes.map((tag, i) => (
343:          <Pill key={`party-${i}`} palette={palette} surface={surface} font={boldFamily}>
344:            {tag}            // ← raw slug, e.g. "pool-party"
345:          </Pill>
346:        ))}
347:        {musicGenres.map((tag, i) => (
348:          <Pill key={`music-${i}`} palette={palette} surface={surface} font={boldFamily}>
349:            {tag}            // ← raw slug, e.g. "hiphop-rap"
350:          </Pill>
351:        ))}
```

`Pill` (defined at `EventOfferingBody.tsx:827-846`) is a pure `<View><Text>{children}</Text></View>`
wrapper — it renders whatever child string it is given, verbatim. `{tag}` is the raw slug.
**Mechanism:** the slug array reaches the pills row and is printed unmapped → the user sees
`pool-party` where "Pool Party" is expected.

### F-2 — `RsvpOfferingBody.tsx` pills row renders raw slugs (CONFIRMED ROOT CAUSE)

`packages/offering-rendering/RsvpOfferingBody.tsx`

```
918:  const vibeTags = event.vibeTags ?? [];
919:  const partyTypes = event.partyTypes ?? [];
920:  const musicGenres = event.musicGenres ?? [];
...
1015:      <View style={styles.pillsRow} testID="orch-1167-pills-row">
1016:        <Pill palette={palette} font={boldFamily}>{formatLabel}</Pill>
1017:        {vibeTags.map((tag, i) => (
1018:          <Pill key={`vibe-${i}`} palette={palette} font={boldFamily}>{tag}</Pill>   // ← raw slug
1019:        ))}
1020:        {partyTypes.map((tag, i) => (
1021:          <Pill key={`party-${i}`} palette={palette} font={boldFamily}>{tag}</Pill>  // ← raw slug
1022:        ))}
1023:        {musicGenres.map((tag, i) => (
1024:          <Pill key={`music-${i}`} palette={palette} font={boldFamily}>{tag}</Pill>  // ← raw slug
1025:        ))}
```

`Pill` here is defined at `RsvpOfferingBody.tsx:1180`. Same defect as F-1: raw slug rendered.
**Mechanism:** identical to F-1, on the RSVP variant of the public page.

### F-3 — `RsvpMomentumDecision.tsx` chips render a **humanized** (not canonical) label — CORRECTION to the orchestrator's lead (SECONDARY ROOT CAUSE)

The orchestrator's dispatch stated site #3 "renders `{slug}` raw". **Evidence refutes that**: it
renders `partyTypeLabel(slug)`, a humanizer — not the raw slug.

`packages/offering-rendering/RsvpMomentumDecision.tsx`

```
65:import { deriveMomentum, partyTypeLabel } from "./rsvpMomentum";
...
312:    partyTypes.length > 0 ? (
314:        {partyTypes.map((slug) => (
...
326:              {partyTypeLabel(slug)}   // ← humanized, NOT raw, NOT canonical
```

`partyTypeLabel` (`packages/offering-rendering/rsvpMomentum.ts:90-95`):

```
90:export const partyTypeLabel = (slug: string): string =>
91:  slug
92:    .split("-")
93:    .filter((w) => w.length > 0)
94:    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
95:    .join(" ");
```

This capitalizes only the FIRST word: `"rooftop-party" → "Rooftop party"` (canonical is "Rooftop
Party"), `"pool-party" → "Pool party"` (canonical "Pool Party"), `"hiphop-rap" → "Hiphop rap"`
(canonical "Hip-Hop/Rap"). Its own Deno test asserts exactly this humanized behavior
(`packages/offering-rendering/__tests__/orch_1157_rsvp_momentum.test.ts:94-98`).

**Mechanism:** the RSVP momentum chips show a lightly-humanized label that is INCONSISTENT with
the canonical labels the fixed pills row will show, and wrong for multi-word / punctuated labels.
This is a lesser defect than F-1/F-2 (not raw kebab), but it is in the same taxonomy family, on
the same page, and is explicitly listed by the dispatch as an in-scope render site. The fix routes
it through the same canonical resolver so the whole page is consistent.

> **Note on live-fire (Prime Directive 7):** this is a pure display-logic defect in a shared,
> props-only package proven by source. The public buyer-web `/e/...` route is anon-reachable, but
> the authed business-web runtime is capped per `feedback_biz_web_authed_runtime_unreachable_cap_claims`.
> Confidence is **proven** at the source layer (the raw-`{tag}` render is unambiguous and the Pill
> is a verbatim text wrapper); a runtime screenshot is recommended for the tester but the causal
> chain does not require it. See §5 for the surface-by-surface reachability.

### The canonical labels already exist (the fix's source of truth)

`supabase/functions/_shared/eventTaxonomy.ts:46-98` defines `PARTY_TYPES`, `VIBE_TAGS`,
`MUSIC_GENRES`, each entry carrying `{ slug, label }`. This module is triplicated byte-for-byte
across `supabase/functions/_shared/eventTaxonomy.ts`, `mingla-business/src/constants/eventTaxonomy.ts`,
`app-mobile/src/constants/eventTaxonomy.ts` (parity-locked by CI gate
`orch-0824-event-taxonomy-parity.mjs`). The full label table is transcribed verbatim in §7.

---

## 3. Complete render-site census

**Method:** monorepo-wide grep for every `.map` / property access of `vibeTags` / `partyTypes` /
`musicGenres`, and for every consumer of the `PARTY_TYPES` / `VIBE_TAGS` / `MUSIC_GENRES` label
maps, across `app-mobile`, `mingla-business`, `mingla-admin`, `packages` (source only, tests
excluded).

### Sites that RENDER the party/vibe/music taxonomy as visible pills/chips/text — EXACTLY THREE

| # | File:line | What it renders today | In scope |
|---|-----------|-----------------------|----------|
| 1 | `packages/offering-rendering/EventOfferingBody.tsx:337-351` | `{tag}` raw slug in `<Pill>` for vibe/party/music | YES |
| 2 | `packages/offering-rendering/RsvpOfferingBody.tsx:1017-1025` | `{tag}` raw slug in `<Pill>` for vibe/party/music | YES |
| 3 | `packages/offering-rendering/RsvpMomentumDecision.tsx:314-326` | `partyTypeLabel(slug)` humanized (party only) in accent-wash chip | YES |

The `.map`-render grep returned **only** these three sites. No other component renders these three
fields via `.map`, `.join`, `.slice`, or single-value text.

### Sites confirmed NOT to render these fields (ruled out with evidence)

- **`ChipGroup.tsx`** (`packages/offering-rendering/ChipGroup.tsx`) — renders `chip.label` for
  Included/Not-included inclusion chips (refunds/inclusions), a DIFFERENT data model. Not taxonomy.
- **CREATE wizard** — `mingla-business/src/components/event/CreatorStep1Basics.tsx:207-253` maps
  `PARTY_TYPES` / `VIBE_TAGS` / `MUSIC_GENRES` (the option objects) and renders `opt.label` with
  `selected={draft.partyTypes.includes(opt.slug)}`. This is the authoring/selection flow, already
  shows labels, is not a public page. **OUT of scope; not broken.**
- **Discover filter** — `app-mobile/src/components/DiscoverScreen.tsx` uses these arrays as filter
  SELECTION state and for Ticketmaster suppression / cache signatures (slugs), never as display
  pills. Not a render site.
- **Deck seed / compact cards** (`SwipeableCards.tsx`, `useConsumerEventFoundation.ts`,
  `ConnectionsPage.tsx`, `venueExperienceMapping.ts`, `tripToLiveEvent.ts`) — pass empty arrays or
  build payloads (slugs) that flow INTO the shared body; none render pills themselves.
- **Adapters / services / stores / validation / search** — `publicEventsService.ts`,
  `usePublicEventBySlug.ts`, `useConsumerEventFoundation.ts`, `usePublicRsvpBySlug.ts`,
  `liveEventAdapter.ts`, `serverDraftEventMapper.ts`, `businessEvents.ts`, `draftEventValidation.ts`,
  `liveEventStore.ts`, `draftEventStore.ts`, `lib/search/adapters.ts` — all move slug arrays around
  (snake_case DB cols ↔ camelCase). None display them as labels. (Data-flow detail in §4.)

### `ExperienceOfferingBody` — a SEPARATE taxonomy, OUT of scope (confirmed)

`packages/offering-rendering/ExperienceOfferingBody.tsx:89-104` owns `EXPERIENCE_VIBE_LABELS`
(`adventurous` / `first-date` / `romantic` / `group-fun`) — the experience **intent** ids that
mirror DB CHECK `events_experience_intents_chk`. This is a DIFFERENT taxonomy from Seth's
party/vibe/music slugs, it already resolves to labels via `experienceVibeLabels(...)` (which drops
unknown ids), and none of Seth's seven example slugs belong to it. **OUT of scope.**

---

## 4. Data-flow + downstream-slug-dependency proof

**Claim to prove:** the three arrays arrive at the body layer as SLUG arrays, and nothing at or
below the body layer depends on them being slugs (they are display-only there) — so resolving them
to labels at render is safe, and confirms Option B (resolve-at-render) is equivalent-and-safer than
Option A (convert-at-adapter).

### 4a. They arrive as slug arrays at every host adapter

- **Buyer/anon WEB** (`mingla-business`): `publicEventsService.ts`
  - `publicEventViewRowToEvent` (`:1082-1088`): `partyTypes: Array.isArray(row.party_types) ? row.party_types : []`, same for `vibe_tags` / `music_genres` — raw DB slug arrays.
  - `detailFromRow` (`:1188-1190`): `asStringArray(payload.partyTypes)` etc. — RPC payload slugs.
  - canonical merge (`:1323-1332`): still slug arrays.
  - `PublicEventPage.tsx:197-200`: `partyTypes: event.partyTypes ?? []` → passed to `EventOfferingBody`.
- **Consumer iOS/Android** (`app-mobile`):
  - `usePublicEventBySlug.ts:145-147`, `usePublicRsvpBySlug.ts:102-104`,
    `useConsumerEventFoundation.ts:167-169` — all `asStringArray(...)` / `Array.isArray(...)` slug arrays.
  - `ConsumerEventDetailScreen.tsx:186-188`: `card.partyTypes ?? []` → payload → `EventOfferingBody` (`:834`) / `RsvpOfferingBody` (`:858`).
- **Business iOS/Android preview** (`mingla-business`):
  - `liveEventAdapter.ts:54-56`: `partyTypes: e.partyTypes ?? []` (slugs) → `FoundationEventPreview.tsx:142` `<EventOfferingBody>` / `FoundationRsvpPreview.tsx:197` `<RsvpOfferingBody>`.

Every path delivers **raw slug arrays** to the body.

### 4b. At the body layer they are display-only

Grep of every line touching the three vars inside each body:

- `EventOfferingBody.tsx`: declared `:244-246`, used ONLY at the pills `.map` `:337-351`. No other use.
- `RsvpOfferingBody.tsx`: declared `:918-920`, used ONLY at the pills `.map` `:1017-1025`. (Note `:775` passes `partyTypes={[]}` to the decision unit — an empty literal, not these vars.)
- `RsvpMomentumDecision.tsx`: prop `partyTypes` (`:94`) used ONLY at the chips `.map` `:312-331`.

**Conclusion:** at and below the body layer the slugs feed nothing but the Pill/chip text. All
slug-consuming logic (RLS/DB writes, Discover filtering, Ticketmaster suppression at
`eventTaxonomy.ts:116` `mapMinglaMusicGenresToTmSlugs`, search-index spreads, publish validation)
runs UPSTREAM on separate variables and is untouched by a render-time label swap. Converting at the
render site is therefore safe and is the minimal, single-owner change. (Converting at each adapter —
Option A — would also be data-safe, but see §7 for why it loses single-owner and risks a missed
entry point.)

---

## 5. Affected surfaces table

All five in-scope surfaces render through the SAME two shared bodies (`EventOfferingBody`,
`RsvpOfferingBody`) with NO per-surface fork and NO `.web.tsx` variant — parity is **automatic**
via shared code (upheld by invariant I-PROPOSED-1167-SHELL-AGNOSTIC-BODY).

| # | Surface | Mount site | Covered | Parity | Runtime reachability |
|---|---------|-----------|:-------:|--------|----------------------|
| 1 | Consumer iOS | `app-mobile/.../ConsumerEventDetailScreen.tsx:834` (Event) / `:858` (Rsvp) | YES | shared code (auto) | iOS sim |
| 2 | Consumer Android | same file (shared RN) | YES | shared code (auto) | Android emu |
| 3 | Buyer/anon WEB (`/e/{brandSlug}/{eventSlug}`) | `mingla-business` `PublicEventPage.tsx` → `EventOfferingBody` | YES | shared code (auto) | anon-reachable (curl/browser) |
| 4 | Business iOS | `mingla-business/.../FoundationEventPreview.tsx:142` / `FoundationRsvpPreview.tsx:197` | YES | shared code (auto) | authed biz-web runtime capped; native rides next build |
| 5 | Business Android | same files (shared RN) | YES | shared code (auto) | as #4 |
| 6 | Admin Web (`mingla-admin`) | — | NO | n/a | Admin does not render these public event pills — out of scope (confirmed: no `mingla-admin` render site in census) |
| 7 | Business Web preview (adjacent) | `FoundationEventPreview` / `FoundationRsvpPreview` on web export | YES | shared code (auto) | same as #4 (ships via Vercel `[deploy]`) |

**Verdict:** the orchestrator's "buyer/anon WEB + consumer iOS/Android + business iOS/Android
preview; admin NOT in scope" assessment is **CONFIRMED**. All covered surfaces are covered by the
single shared-package fix; no surface needs a separate change.

**Delivery note:** buyer-web + business-web-preview ship via Vercel `[deploy]`; native (consumer +
business iOS/Android) ride their next respective builds — this is a pure-JS package change, and
business OTA is prohibited (COMMS-0052/0063). This is a delivery fact for CLOSE, not a scope change.

---

## 6. CI-gate compatibility analysis

Two existing gates guard this area; the fix must keep both green. A third (new) gate is the drift
guard (spec'd in §7).

### 6a. `orch-1167-canonical-9-section-order.mjs` — STAYS GREEN

Read in full. It anchors on first-occurrence order of section-comment strings and two testIDs in
`EventOfferingBody.tsx` ONLY:

```
["(4) Pills row", 'testID="orch-1167-pills-row"'],
["(5) TICKET BOX", 'testID="orch-1167-ticket-box"'],
...
```

It checks ORDER, not pill CONTENT. The fix changes only the Pill *children* (`{tag}` →
`{taxonomyLabel(tag)}`); it does NOT move, rename, or remove the `(4) Pills row` comment, the
`testID="orch-1167-pills-row"` wrapper, or any section anchor. **Requirement to stay green:** keep
the `testID="orch-1167-pills-row"` `<View>` and every section-order comment/testID byte-identical;
keep the `<Pill>` structure. The edit satisfies this.

### 6b. `orch-0824-event-taxonomy-parity.mjs` — STAYS GREEN

Read in full. It asserts byte-for-byte equivalence of the THREE canonical `eventTaxonomy.ts` copies
only. The fix does NOT touch any of the three canonical files, so this gate is untouched and green.
**Requirement:** do not edit `supabase/functions/_shared/eventTaxonomy.ts`,
`mingla-business/src/constants/eventTaxonomy.ts`, or `app-mobile/src/constants/eventTaxonomy.ts`.

### 6c. CI test-execution reality (drives the regression-test design)

Investigated how the package's `__tests__` run in CI:
- Both Deno workflows (`supabase-migrations-and-stripe-deno.yml`) use HARD-CODED file lists, not a
  glob — they do NOT run `packages/offering-rendering/__tests__/*`.
- No root `package.json` test script, no `deno.json` task, no `jest.config.*` picks up the package
  `__tests__`. The files use the `Deno.test` global (so jest would not run them anyway).
- The only CI that runs on `packages/**` PRs is the **strict-grep gate registry**
  (`strict-grep-mingla-business.yml`, which is `paths:`-triggered on `packages/**`).

**Consequence:** the CI-ENFORCED fails-on-revert regression guard for this fix MUST be a
strict-grep gate (`.mjs`), consistent with the HARD-MUST memory rule
`feedback_close_tester_regression_protection_hard_must` and `feedback_strict_grep_registry_pattern`.
The Deno unit test is still authored (developer-run + documents correctness), but the CI teeth come
from the gate. This is spec'd in §7.

---

## 7. SPEC — recommended design, exact edits, canonical labels, drift-guard, tests

### 7.0 Recommended design — Option B (in-package resolver) + new drift gate

**Chosen: Option B (refined).** Add a small, dep-free label resolver INSIDE
`@mingla/offering-rendering` and call it at all three render sites; add a CI drift-gate that fails
if the in-package label map diverges from the canonical `eventTaxonomy.ts` labels; include a
Title-Case fallback for unknown slugs.

Why not the others:
- **Option A (resolve at each host adapter):** would spread the mapping across ≥6 entry points
  (`publicEventsService.ts`, `usePublicEventBySlug`, `usePublicRsvpBySlug`,
  `useConsumerEventFoundation`, `ConsumerEventDetailScreen`, `liveEventAdapter`, …). It violates
  single-owner, and a future new host that forgets to convert re-introduces the bug silently. Data-
  safe (per §4) but structurally worse.
- **Option C (label-resolver function passed as a prop):** adds a required prop to the shared body
  API and forces every host to supply the same function — more surface area, more parity risk, and
  the resolver would still need to live somewhere isolation-safe. No benefit over B.
- **Option B** keeps the label logic where the render happens (one owner), respects
  I-MOR-0827-PACKAGE-ISOLATION (self-contained; no app `src/` import), and the drift-gate makes the
  in-package copy provably in-sync with canonical. There is already precedent for a package-local
  label helper (`partyTypeLabel` in `rsvpMomentum.ts`) — B generalizes it to canonical labels.

### 7.1 New file — `packages/offering-rendering/taxonomyLabels.ts`

Dep-free (NO react / react-native import) so it is Deno-unit-testable, mirroring `rsvpMomentum.ts`.

Exports (exact):

- `export const TAXONOMY_LABELS: Readonly<Record<string, string>>` — a single flat map of ALL 45
  party+vibe+music canonical `slug → label` pairs (transcribed verbatim from
  `supabase/functions/_shared/eventTaxonomy.ts`; §7.4). Cross-taxonomy slugs are unique (verified:
  45 slugs, 45 unique, zero collisions), so a flat map is safe and unambiguous.
- `export const taxonomyLabel = (slug: string): string => …` — returns `TAXONOMY_LABELS[slug]` when
  present; else a **Title-Case fallback**: split on `-`, upper-case the first character of each word,
  join with a space (`"foo-bar" → "Foo Bar"`). The fallback guarantees an unknown/future slug never
  renders as raw kebab-case. (Illustrative ≤3 lines — the implementor writes the final body:)

  ```ts
  export const taxonomyLabel = (slug: string): string =>
    TAXONOMY_LABELS[slug] ??
    slug.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  ```

  Edge behavior the implementor must preserve: empty string in → empty string out (no crash); a
  slug already in canonical form returns its exact canonical label including punctuation
  (`"hiphop-rap" → "Hip-Hop/Rap"`, `"rnb-soul" → "R&B/Soul"`, `"electronic-edm" → "Electronic/EDM"`).

### 7.2 Export from the package barrel — `packages/offering-rendering/index.ts`

Add a new export block (place near the existing `rsvpMomentum` / `ExperienceOfferingBody` exports):

```ts
export { taxonomyLabel, TAXONOMY_LABELS } from "./taxonomyLabels";
```

Do NOT remove or alter the existing `export { deriveMomentum, partyTypeLabel, RSVP_CLUSTER_SHOWN } from "./rsvpMomentum";`
(lines 65-69). `partyTypeLabel` stays exported for backward-compat and keeps its Deno test green.

### 7.3 Exact edits at the three render sites

**Site 1 — `packages/offering-rendering/EventOfferingBody.tsx`**
- Add import (top of file, with the other package-local imports): `import { taxonomyLabel } from "./taxonomyLabels";`
- Line 339: `{tag}` → `{taxonomyLabel(tag)}`
- Line 344: `{tag}` → `{taxonomyLabel(tag)}`
- Line 349: `{tag}` → `{taxonomyLabel(tag)}`
- Do NOT change the `.map((tag, i) => …)` shape, the `key`, the `<Pill>` props/structure, the
  `testID="orch-1167-pills-row"` wrapper, or any section comment.

**Site 2 — `packages/offering-rendering/RsvpOfferingBody.tsx`**
- Add import: `import { taxonomyLabel } from "./taxonomyLabels";`
- Line 1018: `{tag}` → `{taxonomyLabel(tag)}`
- Line 1021: `{tag}` → `{taxonomyLabel(tag)}`
- Line 1024: `{tag}` → `{taxonomyLabel(tag)}`
- Keep the `testID="orch-1167-pills-row"` wrapper and `<Pill>` structure intact.

**Site 3 — `packages/offering-rendering/RsvpMomentumDecision.tsx`**
- Line 65: change `import { deriveMomentum, partyTypeLabel } from "./rsvpMomentum";` →
  `import { deriveMomentum } from "./rsvpMomentum";`
- Add import: `import { taxonomyLabel } from "./taxonomyLabels";`
- Line 326: `{partyTypeLabel(slug)}` → `{taxonomyLabel(slug)}`
- Keep the `testID="orch-1157-rsvp-chips"` wrapper and chip structure intact. This upgrades the RSVP
  momentum chips from humanized ("Rooftop party") to canonical ("Rooftop Party"), matching the pills
  row. `partyTypeLabel` becomes unused by components but stays exported + tested (no regression).

**Do NOT touch** `rsvpMomentum.ts` or `__tests__/orch_1157_rsvp_momentum.test.ts` (the
`partyTypeLabel` humanizer + its function-level test remain valid and green).

### 7.4 Canonical label table — copy VERBATIM from `eventTaxonomy.ts` (do NOT invent)

Source: `supabase/functions/_shared/eventTaxonomy.ts:46-98`. All 45 entries below go into
`TAXONOMY_LABELS`.

**PARTY_TYPES (15)** — `eventTaxonomy.ts:46-62`

| slug | label |
|------|-------|
| birthday-party | Birthday Party |
| rooftop-party | Rooftop Party |
| club-night | Club Night |
| house-party | House Party |
| warehouse-party | Warehouse Party |
| beach-party | Beach Party |
| pool-party | Pool Party |
| boat-party | Boat Party |
| themed-party | Themed Party |
| corporate-event | Corporate Event |
| graduation-party | Graduation Party |
| holiday-party | Holiday Party |
| networking-event | Networking Event |
| rave | Rave |
| festival | Festival |

**VIBE_TAGS (16)** — `eventTaxonomy.ts:64-81`

| slug | label |
|------|-------|
| energetic | Energetic |
| chill | Chill |
| intimate | Intimate |
| wild | Wild |
| classy | Classy |
| casual | Casual |
| upscale | Upscale |
| underground | Underground |
| mainstream | Mainstream |
| artsy | Artsy |
| social | Social |
| exclusive | Exclusive |
| laid-back | Laid-back |
| vibrant | Vibrant |
| retro | Retro |
| futuristic | Futuristic |

**MUSIC_GENRES (14)** — `eventTaxonomy.ts:83-98`

| slug | label |
|------|-------|
| electronic-edm | Electronic/EDM |
| hiphop-rap | Hip-Hop/Rap |
| pop | Pop |
| rock | Rock |
| latin | Latin |
| afrobeats | Afrobeats |
| rnb-soul | R&B/Soul |
| disco-funk | Disco/Funk |
| reggae-dancehall | Reggae/Dancehall |
| indie | Indie |
| country | Country |
| jazz | Jazz |
| classical | Classical |
| mixed-variety | Mixed/Variety |

**Seth's 7 examples resolve as:** `laid-back → Laid-back`, `exclusive → Exclusive` (VIBE);
`pool-party → Pool Party` (PARTY); `afrobeats → Afrobeats`, `hiphop-rap → Hip-Hop/Rap`, `pop → Pop`,
`rnb-soul → R&B/Soul` (MUSIC). All match Seth's requested display strings exactly.

### 7.5 Drift-guard — new strict-grep gate `orch-1292-taxonomy-label-parity.mjs`

New file `.github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs` + a new job
`orch-1292-taxonomy-label-parity` in `.github/workflows/strict-grep-mingla-business.yml`
(self-test step + real-run step, matching the existing gate pattern). Register it in the gate list
comment block. The gate runs from repo root (`process.cwd()`), like the sibling gates.

The gate MUST assert all of:
1. **No drift from canonical:** parse `PARTY_TYPES` / `VIBE_TAGS` / `MUSIC_GENRES` `{ slug, label }`
   pairs out of `supabase/functions/_shared/eventTaxonomy.ts`, parse `TAXONOMY_LABELS` out of
   `packages/offering-rendering/taxonomyLabels.ts`, and assert every canonical `slug → label` pair
   is present byte-exact in `TAXONOMY_LABELS` (label string identical). Fail listing any missing or
   mismatched slug. (This is the ORCH-0824-style parity extension, semantic not byte-equal, since
   the package file is structured differently.)
2. **Every canonical slug is covered** (count match: `TAXONOMY_LABELS` has ≥ the 45 canonical
   entries; extra keys are allowed only if they too are canonical — enforce set-equality on the
   union of the three canonical slug sets).
3. **Render sites resolve, not raw (fails-on-revert):** assert `EventOfferingBody.tsx` and
   `RsvpOfferingBody.tsx` each contain `taxonomyLabel(tag)` inside the pills map and do NOT contain
   the bare `>{tag}<` / `>\n            {tag}\n` raw-slug render in the pills row; assert
   `RsvpMomentumDecision.tsx` contains `taxonomyLabel(slug)` and not `partyTypeLabel(slug)` in the
   chip. (Comment-stripped matching to avoid false hits.)
4. **`--self-test`:** synthesize a GOOD fixture (map matches canonical; sites call `taxonomyLabel`)
   → passes; and BAD fixtures → fail: (a) a canonical label dropped/renamed in `TAXONOMY_LABELS`,
   (b) a render site reverted to raw `{tag}`. Self-test exits non-zero if GOOD trips or any BAD
   passes.

This gate is BOTH the drift guard (keeps the in-package map == canonical, closing the
I-MOR-0827 isolation trade-off) AND the CI-enforced fails-on-revert regression guard for the render
sites (per §6c, the only CI that runs on `packages/**`).

### 7.6 Mandatory regression tests

**(a) Implementor happy-path — Deno unit test**
`packages/offering-rendering/__tests__/orch_1292_taxonomy_labels.test.ts` (Deno, dep-free, mirrors
`orch_1157_rsvp_momentum.test.ts`). Must assert:
- Each of Seth's 7 example slugs → its exact canonical label (the §7.4 strings).
- A representative slug from EACH taxonomy maps correctly (party/vibe/music) — at minimum
  `pool-party → Pool Party`, `laid-back → Laid-back`, `hiphop-rap → Hip-Hop/Rap`,
  `rnb-soul → R&B/Soul`, `electronic-edm → Electronic/EDM`.
- An UNKNOWN slug (`"unknown-future-slug"`) → Title-Case fallback (`"Unknown Future Slug"`), never
  raw kebab.
- Empty string → empty string (no throw).
- `TAXONOMY_LABELS` contains all 45 canonical pairs (loop the three canonical lists).
- Fails-on-revert expectation documented: reverting `taxonomyLabel` to return the raw slug makes the
  7-example assertions fail.

**(b) Tester adversarial — distinct angle** (Deno and/or the gate self-test):
- **Empty group omission:** with `partyTypes: []` (and vibe/music `[]`), the pills row renders no
  taxonomy pills and does not crash (assert the body's `?? []` + `.map` yields zero pills; source-
  level assertion acceptable given the biz-web authed-runtime cap, plus the anon-web `/e/...` route
  can be curled for a live-fire pill screenshot).
- **Slug present in one taxonomy but absent in another:** e.g. `pop` (music) is NOT a party/vibe
  slug — confirm `taxonomyLabel("pop") === "Pop"` and that a party-only slug like `pool-party`
  still resolves (the flat map + no-collision proof).
- **Mixed known + unknown in one array:** `["afrobeats","totally-made-up"]` → `["Afrobeats","Totally Made Up"]`
  (canonical + fallback in the same row).
- **Parity-gate self-test:** run `orch-1292-taxonomy-label-parity.mjs --self-test` and prove the BAD
  fixtures (dropped canonical label; render site reverted to `{tag}`) FAIL, and that removing a
  canonical `slug→label` pair from `TAXONOMY_LABELS` trips the drift assertion.
- **RSVP consistency:** confirm the RSVP momentum chip now emits the canonical label (via
  `taxonomyLabel`) and no longer the humanized `partyTypeLabel` output.

---

## 8. Out-of-scope declarations

- **`ExperienceOfferingBody` / experience intents** (`EXPERIENCE_VIBE_LABELS`,
  `adventurous`/`first-date`/`romantic`/`group-fun`) — a separate taxonomy, already label-resolved.
  NOT touched.
- **The three canonical `eventTaxonomy.ts` copies** — not edited (would risk the ORCH-0824 parity
  gate). The fix reads canonical labels only to seed the in-package map + drive the drift gate.
- **CREATE wizard / Discover filter chips** — already show labels (`opt.label`) or use slugs for
  filtering; not public-page pills. NOT touched.
- **`partyTypeLabel` humanizer + its test** (`rsvpMomentum.ts`, `orch_1157_rsvp_momentum.test.ts`) —
  left intact for backward-compat; superseded for rendering by `taxonomyLabel` but not removed.
- **Any data-flow / adapter / service / store / RLS / edge / migration** — untouched; this is a
  render-layer, display-only change (proven §4).
- **Admin web** — does not render these public-event pills; NOT in scope.
- **Section order / testIDs / Pill structure** — preserved exactly (keeps the ORCH-1167 gate green).

### Allowlist (implementor may change ONLY these)
- `packages/offering-rendering/taxonomyLabels.ts` (NEW)
- `packages/offering-rendering/index.ts` (add one export line)
- `packages/offering-rendering/EventOfferingBody.tsx` (1 import + 3 one-token edits)
- `packages/offering-rendering/RsvpOfferingBody.tsx` (1 import + 3 one-token edits)
- `packages/offering-rendering/RsvpMomentumDecision.tsx` (2 import lines + 1 one-token edit)
- `.github/scripts/strict-grep/orch-1292-taxonomy-label-parity.mjs` (NEW gate)
- `.github/workflows/strict-grep-mingla-business.yml` (add one job + one registry-comment line)
- `packages/offering-rendering/__tests__/orch_1292_taxonomy_labels.test.ts` (NEW test)

### DO-NOT-TOUCH
- `supabase/functions/_shared/eventTaxonomy.ts`, `mingla-business/src/constants/eventTaxonomy.ts`,
  `app-mobile/src/constants/eventTaxonomy.ts` (ORCH-0824 parity).
- `packages/offering-rendering/rsvpMomentum.ts` + its test (leave `partyTypeLabel` intact).
- `orch-1167-canonical-9-section-order.mjs`, `orch-0824-event-taxonomy-parity.mjs` (gates unchanged).
- All host adapters/services/hooks/stores (`publicEventsService.ts`, `usePublicEventBySlug.ts`,
  `usePublicRsvpBySlug.ts`, `useConsumerEventFoundation.ts`, `liveEventAdapter.ts`, etc.).

### Proposed invariant (DRAFT → ACTIVE at CLOSE)
`I-PROPOSED-1292-TAXONOMY-LABEL-AT-RENDER` (DRAFT): public event/RSVP pages resolve party/vibe/music
slugs to canonical labels via the in-package `taxonomyLabel` at every render site; the in-package
`TAXONOMY_LABELS` map stays in set-equality + label-parity with the canonical `eventTaxonomy.ts`
labels; unknown slugs Title-Case-fallback, never raw kebab. Enforced by
`orch-1292-taxonomy-label-parity.mjs` (self-tested, fails-on-revert).

### Downstream routing
Next = **mingla-implementor** (execute §7 exactly, run the new gate `--self-test` + real-run + the
Deno unit test locally, prove fails-on-revert). Then **mingla-tester** (§7.6b adversarial + anon-web
`/e/...` live-fire pill screenshot). Then **mingla-orchestrator** CLOSE (flip the invariant ACTIVE,
Vercel `[deploy]` for web; native rides next builds; no OTA).
