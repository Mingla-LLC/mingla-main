# COPY — ORCH-1144 Experience-Create Chooser (business app)

**Skill:** mingla-product · **Date:** 2026-06-15 · **Surface:** Mingla Business app (`mingla-business/`, RN on iOS + Android; business web preview adjacent)
**Status:** Copy deliverable only. No code. Strings below are ready for the forensics SPEC → implementor build.

## What this covers

ORCH-1144 removes the category-gated Hub banner ("Snap your menu to generate experiences") and replaces it with a **pre-step chooser** reached from the top-bar **+** → Create Experience. Three options, **flat equal order, shown to EVERY brand unconditionally** (no venue-type gating, no verification gate):

1. Snap a restaurant / food menu → **Ve5** parser
2. Snap a play / activities menu → **Ve6** parser
3. Create manually → existing manual experience wizard

The Experiences tab also becomes a plain drafts/live list (like Trips/Events), so it needs a fresh empty state.

## Voice + honesty guardrails applied to every string

- Mingla business voice: *"Your Place Deserves to Be Found."* — confident, plain, warm, founder-to-owner, never corporate.
- **No brand-type jargon** (no "venue category", no "this is a restaurant"). The food vs. play labels are **self-selecting**: the user picks the one that matches the menu *they* are holding. A bowling alley with a snack menu can legitimately pick either — both are open.
- **Honesty preserved:** AI *suggests* drafts you **accept, edit, or reject**. Never "AI builds your experiences for you," never an accuracy promise.
- Reality-anchored: Ve5 + Ve6 parsers and the manual wizard all ship today (META-ORCH-1059, live). Nothing here markets an unbuilt feature.
- Each string ships a **Primary** (recommended) + one **Alternate** for Seth to pick.

---

## Section 1 — Chooser sheet: title + subtitle

**UI location:** Header of the create-experience chooser sheet (opens after +→Create Experience, before any of the 3 paths).

### Title
- **Primary:** `Start a new experience`
- **Alternate:** `How do you want to build this?`

### Subtitle (one line, optional but recommended)
- **Primary:** `Snap a menu and let Mingla draft it for you, or build it yourself.`
- **Alternate:** `Pick the fastest way to get this experience live.`

> Rationale: The title stays an action ("Start"), not a question, so it reads fast on a sheet. The subtitle is where we surface the "snap a menu" shortcut WITHOUT implying the brand must be a restaurant — "a menu" is neutral, and "or build it yourself" sets up option 3 as a peer, not a fallback.

---

## Section 2 — The three option cards

Each card: **label/title** + **one-line helper** + **button verb**. Order is fixed: food menu, play/activities menu, manual. All three always visible.

### Option 1 — Snap a restaurant / food menu (→ Ve5)

- **Label / title**
  - **Primary:** `Snap a food menu`
  - **Alternate:** `From a food or drinks menu`
- **Helper (one line)**
  - **Primary:** `Photo or PDF of your food or drinks menu. Mingla suggests experiences you can accept, edit, or reject.`
  - **Alternate:** `Got a dining or drinks menu? Mingla turns it into draft experiences for you to review.`
- **Button verb**
  - **Primary:** `Snap menu`
  - **Alternate:** `Use a menu`

### Option 2 — Snap a play / activities menu (→ Ve6)

- **Label / title**
  - **Primary:** `Snap an activities menu`
  - **Alternate:** `From an activities or packages sheet`
- **Helper (one line)**
  - **Primary:** `Photo or PDF of your activities, packages, or rates — bowling, arcade, escape room, mini-golf. Mingla suggests experiences you can accept, edit, or reject.`
  - **Alternate:** `Got a list of activities, lanes, or packages? Mingla turns it into draft experiences for you to review.`
- **Button verb**
  - **Primary:** `Snap activities`
  - **Alternate:** `Use a sheet`

### Option 3 — Create manually (→ existing wizard)

- **Label / title**
  - **Primary:** `Build it yourself`
  - **Alternate:** `Start from scratch`
- **Helper (one line)**
  - **Primary:** `No menu handy? Set up your experience step by step — full control over every detail.`
  - **Alternate:** `Write it your way. You set the details, photos, dates, and price.`
- **Button verb**
  - **Primary:** `Build manually`
  - **Alternate:** `Start fresh`

> Rationale for the food-vs-play split: "food menu" and "activities menu" are the two nouns an owner already uses for the paper they're holding, so the choice is self-evident with zero brand-type framing. The helpers each lead with the concrete artifact ("Photo or PDF of your food/drinks menu" vs. "activities, packages, or rates — bowling, arcade…") so a non-technical owner instantly recognizes which one matches their sheet. Listing the example play venues inline (bowling, arcade, escape room, mini-golf) is the fastest disambiguator and matches what the Ve6 parser actually handles. Every helper repeats the honest "accept, edit, or reject" so expectations are set before the camera opens. Option 3's helper opens with "No menu handy?" to make manual a deliberate equal choice, not a consolation.

---

## Section 3 — Snap-flow screen headers (reached via the chooser)

**UI location:** Title + subtitle on the camera/upload screen for each parser. These replace the old category-gated banner strings (`RESTAURANT_COPY.ctaTitle/ctaBody` and `PLAY_COPY.ctaTitle/ctaBody` in `mingla-business/app/(tabs)/hub/experiences.tsx`). The old `unverifiedHint` strings are **retired** (no verification gate anymore) and should be deleted, not reworded.

### Food-menu snap screen (Ve5)

- **Title**
  - **Primary:** `Snap your food menu`
  - **Alternate:** `Add your food menu`
- **Subtitle**
  - **Primary:** `Photo or PDF works. Mingla reads it and suggests experiences you can accept, edit, or reject.`
  - **Alternate:** `Take a clear photo or upload a PDF — we'll draft experiences from it for you to review.`

### Play / activities snap screen (Ve6)

- **Title**
  - **Primary:** `Snap your activities menu`
  - **Alternate:** `Add your activities or packages`
- **Subtitle**
  - **Primary:** `Photo or PDF works. Mingla reads it and suggests experiences you can accept, edit, or reject.`
  - **Alternate:** `Take a clear photo or upload your packages list — we'll draft experiences from it for you to review.`

### Reusable in-flow microcopy (unchanged-intent, kept for completeness)

These existing strings stay accurate and need no change beyond the gentle wording below if Seth wants consistency:

| Moment | UI location | Primary | Alternate |
|---|---|---|---|
| Loading (food) | parser progress | `Reading your menu…` | `Looking through your menu…` |
| Loading (play) | parser progress | `Reading your activities…` | `Looking through your activities…` |
| No items found (food) | toast | `We couldn't find menu items in that file. Try a clearer photo of your menu.` | `Hmm — we couldn't read that menu. Try a clearer, well-lit photo.` |
| No items found (play) | toast | `We couldn't find activities in that file. Try a clearer photo of your activities list.` | `Hmm — we couldn't read that list. Try a clearer, well-lit photo.` |
| Parse error (food) | fallback | `Couldn't read your menu. Try again.` | `Something went wrong reading your menu. Give it another go.` |
| Parse error (play) | fallback | `Couldn't read your activities list. Try again.` | `Something went wrong reading that list. Give it another go.` |

> Rationale: Subtitles now say "Photo or PDF works" up front because the chooser already told them what they're doing — the snap screen's job is to lower the friction ("just snap it, any format") and re-state the honesty line one more time at the moment of capture. Titles drop "to generate experiences" since the chooser already framed intent; the screen is just "snap your [thing]."

---

## Section 4 — Experiences tab empty state + helper (redesigned list)

**UI location:** Experiences tab when the brand has zero experiences (drafts or live), now a plain list like Trips/Events. Replaces the old `emptyListHint: "No experiences yet"` + banner combo.

### Empty-state headline
- **Primary:** `No experiences yet`
- **Alternate:** `Your experiences live here`

### Empty-state body (one to two lines, nudges to +→Create)
- **Primary:** `Tap + to create your first one. Snap a menu and Mingla drafts it for you, or build it yourself.`
- **Alternate:** `Snap a menu to get drafts in seconds, or build one by hand. Tap + above to start.`

### Empty-state button (if the design includes a CTA button, not just the top-bar +)
- **Primary:** `New experience`
- **Alternate:** `Create experience`

### List helper / section subtitle (optional, shown above a populated list)
- **Primary:** `Your drafts and live experiences, all in one place.`
- **Alternate:** `Everything you've created — drafts up top, live below.`

> Rationale: The empty state's one job is to point at the new + flow and re-surface the "snap OR build" choice so the shortcut isn't buried inside the sheet. It mirrors the Trips/Events empty-state pattern (plain list, "No X yet, tap + to create") so the business app feels consistent across offering types. "Snap a menu" stays neutral here too — no assumption the brand is a restaurant.

---

## Recommended primary set (quick reference for the SPEC)

| # | UI location | Recommended string |
|---|---|---|
| 1 | Chooser title | `Start a new experience` |
| 1 | Chooser subtitle | `Snap a menu and let Mingla draft it for you, or build it yourself.` |
| 2 | Option 1 label | `Snap a food menu` |
| 2 | Option 1 helper | `Photo or PDF of your food or drinks menu. Mingla suggests experiences you can accept, edit, or reject.` |
| 2 | Option 1 button | `Snap menu` |
| 2 | Option 2 label | `Snap an activities menu` |
| 2 | Option 2 helper | `Photo or PDF of your activities, packages, or rates — bowling, arcade, escape room, mini-golf. Mingla suggests experiences you can accept, edit, or reject.` |
| 2 | Option 2 button | `Snap activities` |
| 2 | Option 3 label | `Build it yourself` |
| 2 | Option 3 helper | `No menu handy? Set up your experience step by step — full control over every detail.` |
| 2 | Option 3 button | `Build manually` |
| 3 | Food snap title | `Snap your food menu` |
| 3 | Food snap subtitle | `Photo or PDF works. Mingla reads it and suggests experiences you can accept, edit, or reject.` |
| 3 | Play snap title | `Snap your activities menu` |
| 3 | Play snap subtitle | `Photo or PDF works. Mingla reads it and suggests experiences you can accept, edit, or reject.` |
| 4 | Empty headline | `No experiences yet` |
| 4 | Empty body | `Tap + to create your first one. Snap a menu and Mingla drafts it for you, or build it yourself.` |
| 4 | Empty button | `New experience` |
| 4 | List helper | `Your drafts and live experiences, all in one place.` |

## Implementation notes for downstream forensics/implementor

- Existing source of the strings being replaced: `mingla-business/app/(tabs)/hub/experiences.tsx` (`RESTAURANT_COPY` / `PLAY_COPY` blocks, lines ~72–98).
- **Delete** both `unverifiedHint` strings — the verification gate is removed in ORCH-1144; there is no "once Mingla verifies your venue claim" state anymore.
- The `coming-soon.tsx` "powered by AI that reads your menu / tasting menu" copy (`mingla-business/app/experience/coming-soon.tsx:52`) should be reconciled or retired if that screen is superseded by the live chooser — flag for the SPEC.
- All three options are unconditional: do NOT re-introduce any `venueCategory` / verification branching around which card shows.
