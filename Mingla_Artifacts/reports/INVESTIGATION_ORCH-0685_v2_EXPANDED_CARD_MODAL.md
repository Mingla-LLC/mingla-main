# INVESTIGATION — ORCH-0685 v2 — ExpandedCardModal opened from a shared-card chat bubble

**Mode:** INVESTIGATE-ONLY
**Severity:** S1-high (degrades the surface where users actually evaluate a shared experience)
**Confidence:** HIGH on root causes, field-shape gap, IMPL step 7c skip, dead-tap. MEDIUM on the user-reported "slug shows" symptom — visible category chip IS translated; the user-perceived slug-leak is most likely sub-component or fallback noise rather than the primary chip.
**Date:** 2026-04-26
**Investigator:** Mingla Forensics (orchestrator-dispatched after v1 scope correction)
**Dispatch:** [prompts/FORENSICS_ORCH-0685_v2_EXPANDED_CARD_MODAL.md](../prompts/FORENSICS_ORCH-0685_v2_EXPANDED_CARD_MODAL.md)
**Prior art:** [reports/INVESTIGATION_ORCH-0685_SHARED_CARD_BUBBLE_DETAILS.md](INVESTIGATION_ORCH-0685_SHARED_CARD_BUBBLE_DETAILS.md) (v1 — bubble; accepted as fact, not re-litigated), [specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md), [outputs/IMPLEMENTATION_ORCH-0667_SHARE_SAVED_CARD_REPORT.md](../outputs/IMPLEMENTATION_ORCH-0667_SHARE_SAVED_CARD_REPORT.md)

---

## 1 — Layman summary

When a user shares a saved card in a 1:1 chat and the recipient (or sender) taps the bubble, the modal that opens is the same `ExpandedCardModal` used everywhere else in the app — but it's being fed a 12-field "snapshot" instead of the 30+ field rich card object it expects. The result is a modal that *looks* working but is silently missing entire sections: no weather, no busyness/popular-times, no booking options, no distance pill, no opening-hours expander. These sections are all gated on a `location` lat/lng that the snapshot doesn't carry. Recipient and sender see the same incomplete modal — symmetric, not asymmetric.

On top of the missing sections, the Save button is **dead-tapped** in the chat-mounted modal: tapping it calls a deliberate no-op handler and produces no feedback (Constitution #1 violation).

The category chip itself IS translated correctly (via `CardInfoSection`'s call to `getReadableCategoryName`). The user-reported "slug shows" symptom is real but appears to come from one of: (a) sub-features that fall through to slug-string-contains fallback paths (icon resolution), (b) sub-components like `WeatherSection`/`TimelineSection` that *receive* the raw slug as a prop (currently not user-visible there but a latent leak), or (c) cases where the card's category is not in the user's locale's `common.json` and `getReadableCategoryName` falls back to title-casing the slug. The visible primary chip is not the leak site.

The structural cause is unambiguous: **IMPL step 7c was skipped.** Spec §9.6 explicitly required the implementor to verify `ExpandedCardModal` compatibility with `CardPayload` and either widen the payload, add null-safe defaults, or document the missing fields as a known v1 gap. The implementation report has **zero mention** of step 7c. The unsafe cast `payload as unknown as ExpandedCardData` ships unverified.

---

## 2 — Symptom summary

| Field | Value |
|-------|-------|
| **Expected** | Tapping a shared-card chat bubble opens the same rich modal users see when tapping a card in the deck or saved tab — full title/image, translated category, price tier, rating, address, weather strip, busyness/popular times, opening hours, booking options, navigation/share/save CTAs that work. |
| **Actual** | Modal opens. Title + image + translated category chip + tags + rating + address + price-tier render correctly via `CardInfoSection`. **Missing entirely:** weather strip (location-gated, silently skipped), busyness section (location-gated), booking options (location-gated), opening-hours expander (depends on `openingHours` field which CardPayload doesn't carry). **Dead:** Save button always renders + always enabled but is wired to a no-op (`onSave={async () => { /* no-op */ }}`). **Not rendered for any card** (pre-existing): `reviewCount`, `highlights`, `fullDescription`, `matchScore`, `matchFactors`, `socialStats`. |
| **Reproduction** | 100% deterministic. Every chat-shared card opens the same incomplete modal regardless of card type, sender locale, or recipient device. |
| **Bisect** | Missing-feature class — modal compatibility was never verified at ORCH-0667 implementation. The mount + cast + no-op shipped together in commit `1db3d80e` (Wave 3 chat-domain bundle, 2026-04-25). No regression — this has been broken since the feature shipped. |

---

## 3 — Investigation manifest

| # | File | Why |
|---|------|-----|
| 1 | [Mingla_Artifacts/specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md](../specs/SPEC_ORCH-0667_SHARE_SAVED_CARD.md) §9.6 | The verbatim acceptance instruction for IMPL step 7c |
| 2 | [Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0667_SHARE_SAVED_CARD_REPORT.md](../outputs/IMPLEMENTATION_ORCH-0667_SHARE_SAVED_CARD_REPORT.md) | Confirm step 7c verification status (PERFORMED / PARTIAL / SKIPPED / NOT MENTIONED) |
| 3 | [app-mobile/src/components/MessageInterface.tsx:942-948](../../app-mobile/src/components/MessageInterface.tsx#L942-L948) | The unsafe cast site `payload as unknown as ExpandedCardData` |
| 4 | [app-mobile/src/components/MessageInterface.tsx:1378-1389](../../app-mobile/src/components/MessageInterface.tsx#L1378-L1389) | The chat-mounted modal mount with no-op `onSave` and hardcoded `currentMode="solo"` |
| 5 | [app-mobile/src/components/ExpandedCardModal.tsx](../../app-mobile/src/components/ExpandedCardModal.tsx) (2646 lines) | Field-read inventory + category-render audit + Constitution #9 audit + sub-feature dependency audit |
| 6 | [app-mobile/src/components/expandedCard/CardInfoSection.tsx:8,12,42,64-99,120](../../app-mobile/src/components/expandedCard/CardInfoSection.tsx) | Confirm `getReadableCategoryName` is called for the visible category chip |
| 7 | [app-mobile/src/components/expandedCard/WeatherSection.tsx:11](../../app-mobile/src/components/expandedCard/WeatherSection.tsx) | Confirm `category` prop is received but not user-rendered |
| 8 | [app-mobile/src/components/expandedCard/TimelineSection.tsx:15,49,114](../../app-mobile/src/components/expandedCard/TimelineSection.tsx) | Confirm `category` prop is passed to `generateTimeline` (planning-only, not user-rendered) |
| 9 | [app-mobile/src/services/messagingService.ts:12-88](../../app-mobile/src/services/messagingService.ts#L12-L88) | `CardPayload` interface + trim function field inventory |
| 10 | [app-mobile/src/types/expandedCardTypes.ts:8-173](../../app-mobile/src/types/expandedCardTypes.ts#L8-L173) | `ExpandedCardData` interface — required vs optional fields |
| 11 | [app-mobile/src/utils/categoryUtils.ts:50-117](../../app-mobile/src/utils/categoryUtils.ts#L50-L117) | `getReadableCategoryName` signature, legacy resolution, i18n fallback |

---

## 4 — Findings

### 🔴 RC-1 — Field-shape gap: `CardPayload` is a strict 12-field subset of `ExpandedCardData` (30+ fields with ~14 required); modal silently skips entire sections when fed a chat-shared card

| Field | Evidence |
|-------|----------|
| **File + line** | [MessageInterface.tsx:942-948](../../app-mobile/src/components/MessageInterface.tsx#L942-L948) (cast site) + [MessageInterface.tsx:1378-1389](../../app-mobile/src/components/MessageInterface.tsx#L1378-L1389) (mount site) |
| **Exact code (cast)** | `onCardBubbleTap={(payload) => {`<br>`  setExpandedCardFromChat(payload as unknown as ExpandedCardData);`<br>`  setShowExpandedCardFromChat(true);`<br>`}}` |
| **Exact code (mount)** | `<ExpandedCardModal`<br>`  visible={showExpandedCardFromChat}`<br>`  card={expandedCardFromChat}`<br>`  onClose={...}`<br>`  onSave={async () => { /* no-op in chat-mounted modal */ }}`<br>`  currentMode="solo"`<br>`/>` |
| **What it does** | Casts a 12-field `CardPayload` to `ExpandedCardData` (30+ fields) using TypeScript's escape-hatch double-cast. The runtime object retains the 12 fields it had; the cast just suppresses type errors. Modal then reads from a shape it believes is rich but isn't. |
| **What it should do** | Per spec §9.6: implementor "MUST either (a) widen `CardPayload`, (b) provide null-safe defaults inside `ExpandedCardModal`, or (c) document the missing field as a known v1 gap." Whatever path was chosen should be documented in the implementation report. None was. |
| **Causal chain** | User taps shared-card chat bubble → `MessageBubble.tsx:240-241` `onPress` fires `onCardBubbleTap?.(payload)` → handler at MessageInterface.tsx:942-948 sets state with unsafe cast → modal mounts at MessageInterface.tsx:1378-1389 with `card={expandedCardFromChat}` → modal reads `card.location` at lines 1343, 1361, 1382 and silently skips weather/busyness/booking fetches → modal renders with empty sections where rich data should appear → user sees "missing key details." |
| **Verification** | Confirmed direct read of [ExpandedCardModal.tsx:1343-1394](../../app-mobile/src/components/ExpandedCardModal.tsx#L1343-L1394): three location-gated `if (card.location)` blocks. CardPayload interface ([messagingService.ts:12-28](../../app-mobile/src/services/messagingService.ts#L12-L28)) has no `location` field. Therefore: chat-shared cards always have `card.location === undefined`, all three fetches silently skip, all three sections (weather/busyness/booking) render in their default empty/hidden states. **Confidence: HIGH.** |

### 🔴 RC-2 — IMPL step 7c (modal compatibility verification) was completely skipped at ORCH-0667 implementation

| Field | Evidence |
|-------|----------|
| **File + line** | [Mingla_Artifacts/outputs/IMPLEMENTATION_ORCH-0667_SHARE_SAVED_CARD_REPORT.md](../outputs/IMPLEMENTATION_ORCH-0667_SHARE_SAVED_CARD_REPORT.md) — full file scan |
| **Spec verbatim ask (§9.6)** | "If `ExpandedCardModal` reads any field NOT in `CardPayload`, the implementor MUST either (a) widen `CardPayload`, (b) provide null-safe defaults inside `ExpandedCardModal`, or (c) document the missing field as a known v1 gap. **Track this verification as IMPL step 7c.**" |
| **Implementation report search** | Grep for `7c`, `step 7c`, `step-7c`, `verify.*ExpandedCardModal`, `null-safe.*default`, `widen CardPayload`, `known v1 gap`, `v1 gap`, `modal.*compat` returns **2 unrelated matches** (line 59 about `connectionsService.ts` typing + line 61 about `MessageBubble.tsx`). **Zero matches** specific to step 7c, modal compatibility, field-widening, null-safe defaults, or v1 gap documentation. The phrase "modal" appears at line 34 (one row in the spec-compliance crosswalk) marked ✅ for `§9.5 / §9.6 Local ExpandedCardModal mount` — but ✅ refers only to the *mount* and *tap-wiring*, not to the field-shape verification step the spec explicitly required. |
| **What it does** | Implementor shipped the modal mount + the unsafe cast + the no-op `onSave` with zero documented compatibility verification. The cast acknowledges shape mismatch but no code path resolves it. |
| **What it should do** | Implementation report should contain a §step-7c entry that either: (i) names every field the modal reads that CardPayload doesn't carry, classifies each as widen/default/document, and shows the diff; OR (ii) explicitly documents "The following fields are known v1 gaps: [list]; chat-shared modals will render empty for these sections by design." Neither exists. |
| **Causal chain** | Implementor read spec §9.6 (or did not — uncertain), shipped the §9.5/§9.6 ✅ checkmark referring only to the mount, did not perform the field-by-field audit, did not widen CardPayload, did not add null-safe defaults to the modal, did not document a v1 gap. ORCH-0667 went through tester (Wave 4 bundled tester) which ran T-11 ("Tap bubble opens modal" — passed because the modal *opens*) but did not enumerate which sections render in the chat-shared variant. ORCH-0667 closed Grade A CONDITIONAL. The defect shipped to production. User reported the defect at 2026-04-25 → ORCH-0685 v1 → v1 misidentified the bubble → user clarified → v2. |
| **Verification** | Direct read of implementation report. Tally of crosswalk row §9.5/§9.6 = ✅ (mount), no row for §step-7c (verification). **Confidence: HIGH.** |

**Classification rationale (RC-1 vs RC-2):** RC-1 is the *mechanism* (field-shape gap manifests at runtime). RC-2 is the *upstream cause* (no one verified). Both are root causes by the orchestrator's "root cause or nothing" prime directive: a fix that addresses RC-1 without RC-2 leaves the program-level process unchanged and the same class of defect can ship again at the next spec-style integration.

---

### 🟠 CF-1 — `ExpandedCardModal` does not import `getReadableCategoryName` directly; visible chip translation is inherited from a single sub-component (`CardInfoSection`)

| Field | Evidence |
|-------|----------|
| **File + line** | Grep of `app-mobile/src/components/ExpandedCardModal.tsx` for `getReadableCategoryName`: **zero matches**. |
| **Where translation actually happens** | [app-mobile/src/components/expandedCard/CardInfoSection.tsx:8](../../app-mobile/src/components/expandedCard/CardInfoSection.tsx#L8) imports the helper; line 120 calls `<Text style={styles.categoryText}>{getReadableCategoryName(category)}</Text>`. |
| **What this means** | The visible category chip in the modal *is* translated. The slug → label conversion happens once, inside `CardInfoSection`. |
| **Why classified as Contributing Factor** | The translation is one-deep. Three other sites in the modal pass `card.category` raw to child components (`WeatherSection` line 1874, `TimelineSection` lines 1994 + 2008). Currently those children don't render the slug to the user (verified) — but if any future maintainer adds a category text render to those components, the slug leaks. The architecture is fragile: the translation happens at a single descendant, not at the source. Spec writer should consider centralizing the translation at the modal level (or at the CardPayload boundary). |
| **Confidence** | **HIGH** that the modal does not import the helper. **HIGH** that CardInfoSection is the only translating consumer. |

### 🟠 CF-2 — Save button is dead-tapped in the chat-mounted modal (Constitution #1 violation)

| Field | Evidence |
|-------|----------|
| **File + line** | [MessageInterface.tsx:1387](../../app-mobile/src/components/MessageInterface.tsx#L1387) (no-op handler) + ActionButtons component renders Save unconditionally |
| **Exact code** | `onSave={async () => { /* no-op in chat-mounted modal */ }}` |
| **What it does** | The chat-mounted modal passes a no-op as `onSave`. ActionButtons renders the Save button regardless of whether `onSave` is meaningful. User taps Save → no-op fires → no feedback → Save button still says "Save" (no transition to "Saved"). |
| **What it should do** | One of three: (a) hide the Save button entirely in the chat-mounted modal (cleanest, but requires a prop like `hideSaveButton` or detection of the no-op), (b) replace the no-op with a real "save the shared card to my own collection" handler that calls `savedCardsService.saveCard(currentUserId, payload)`, or (c) replace with a toast-on-tap explaining the limitation. Constitution #1 demands one of these. |
| **Causal chain** | User taps a shared-card bubble in chat → modal opens → user is impressed by the place and wants to save it → taps Save → no-op fires → button text doesn't change → user re-taps thinking they missed → still nothing → user concludes the app is broken or the share was somehow incomplete. |
| **Confidence** | **HIGH** that the no-op exists and is wired. **HIGH** that ActionButtons unconditionally renders Save. |

### 🟠 CF-3 — Stroll/Picnic type detection at modal level uses legacy English display names, not canonical slugs

| Field | Evidence |
|-------|----------|
| **File + line** | [ExpandedCardModal.tsx:1503-1510](../../app-mobile/src/components/ExpandedCardModal.tsx#L1503-L1510) |
| **Exact code** | `const isStrollCard = !isCuratedCard && (card.category === "Take a Stroll" || card.category?.toLowerCase().includes("stroll"));`<br>`const isPicnicCard = !isCuratedCard && card.category === 'Picnic Date';` |
| **What it does** | Detects card type by string-matching `card.category` against legacy display names. |
| **Why it's a contributing factor (not just an observation)** | Post-ORCH-0434 canonical slugs are like `nature` (used for both stroll and picnic), `casual_food`, `drinks_and_music`, etc. None of these contain the substring `"stroll"`. None equal `"Picnic Date"`. So even for a card that genuinely is a stroll-type or picnic-type card, `isStrollCard` and `isPicnicCard` are likely both `false` for any post-ORCH-0434 saved card. The Stroll/Picnic-specific timeline UI never renders for shared cards. (For non-shared cards too, depending on what `card.category` actually is at runtime — this is not chat-specific.) |
| **Why hidden flaw class is wrong** | This actively affects today's user-visible behavior, not just future maintenance — but it's a contributing factor (not root cause) because chat-shared cards lack `strollData`/`picnicData` anyway, so the gating is moot for the chat-share path. The defect is real for the non-chat path. **Recommend orchestrator file as a separate ORCH** for follow-up audit. |
| **Confidence** | **HIGH** on the code. **MEDIUM** on the runtime impact (depends on actual `category` values flowing in saved cards — would need a SQL probe to confirm distribution). |

---

### 🟡 HF-1 — `MatchFactorsBreakdown` is imported in `ExpandedCardModal.tsx` but never rendered; `matchFactors` is dropped at render for all cards

| Field | Evidence |
|-------|----------|
| **File + line** | `ExpandedCardModal.tsx` imports `MatchFactorsBreakdown` at the top of the file (per Explore audit line 40); zero render-site for it in the modal body. |
| **Implication** | `matchFactors` is a REQUIRED field on `ExpandedCardData` ([expandedCardTypes.ts:55-61](../../app-mobile/src/types/expandedCardTypes.ts#L55-L61)). Modal asks consumers to provide it but never renders it. For chat-shared cards, this is moot (CardPayload doesn't carry it anyway). For non-chat cards, this is a pre-existing dead-import that quietly drops valuable user-facing data. |
| **Why hidden flaw, not contributing factor** | Doesn't cause the user's reported symptom. But shipping a required field that's never rendered is a maintenance trap and signals decay. Recommend orchestrator triage. |
| **Confidence** | **HIGH** on the dead import (can be re-verified by searching the modal body for `<MatchFactorsBreakdown`). |

### 🟡 HF-2 — `reviewCount`, `highlights`, `fullDescription`, `socialStats` are persisted in `card_payload` (or required by ExpandedCardData) but never rendered by the modal

| Field | Evidence |
|-------|----------|
| **File + line** | Field-read inventory — none of these have a render-site in `ExpandedCardModal.tsx` (Explore audit confirmed; verified by grep for `card.reviewCount`, `card.highlights`, `card.fullDescription`, `card.socialStats` returning zero direct read sites in the modal's render branches). |
| **Implication** | These fields are paid for at storage and bandwidth (CardPayload persists `reviewCount`, `highlights`; ExpandedCardData declares `fullDescription`, `socialStats` required) but the modal does not display them. Spec writer should NOT widen `CardPayload` to include these fields without first adding render sites. |
| **Why hidden flaw** | Pre-existing for all cards, not chat-share-specific. But relevant context for spec-writer: don't assume "field exists in CardPayload → field renders in modal." |
| **Confidence** | **HIGH.** |

### 🟡 HF-3 — `BusynessSection` renders literal `"N/A"` when `travelTime` is undefined and busyness data is loaded — Constitution #9 risk for non-chat path

| Field | Evidence |
|-------|----------|
| **File + line** | Per Explore audit, BusynessSection.tsx:70 renders `busynessData.trafficInfo?.currentTravelTime || travelTime || "N/A"` |
| **Why hidden flaw, not contributing factor for chat-share** | For the chat-shared modal: `card.location` is undefined, so busyness fetch is skipped at ExpandedCardModal.tsx:1361, so `busynessData` is null, so `BusynessSection` renders nothing or its loading-default. The "N/A" literal does NOT surface for chat-shared cards. **For non-chat cards** with location but no travelTime, the literal does surface — Constitution #9 fabrication risk in the non-chat path. |
| **Why bundle anyway** | If the spec eventually widens CardPayload to include `location`, the busyness section starts firing for chat-shared cards too, and the "N/A" would surface. Spec writer should preempt by removing the `\|\| "N/A"` fallback or replacing with a hidden-pill conditional. |
| **Confidence** | **MEDIUM** — recipe sourced from Explore agent; have not directly read BusynessSection.tsx in this pass. Spec writer should re-verify before binding. |

---

### 🔵 OBS-1 — Sender vs recipient render through the same chat-mounted modal mount; no asymmetry

| Field | Evidence |
|-------|----------|
| **File + line** | [MessageInterface.tsx:1378-1389](../../app-mobile/src/components/MessageInterface.tsx#L1378-L1389) — single mount instance |
| **Detail** | Both sides reach the same mount with the same `expandedCardFromChat` state, populated from the same `cardPayload` that flowed through `transformMessage` at [ConnectionsPage.tsx:947-966](../../app-mobile/src/components/ConnectionsPage.tsx#L947-L966). Both pass through the same unsafe cast. Both render against the same modal code. **One bug. One render path. Two perspectives, identical experience.** |
| **Confidence** | **HIGH.** |

### 🔵 OBS-2 — Visible category chip IS translated correctly via `CardInfoSection`; the user-perceived "slug shows" symptom is most likely a sub-feature fallback or locale-key-missing fallback, not the primary chip

| Field | Evidence |
|-------|----------|
| **File + line** | [CardInfoSection.tsx:120](../../app-mobile/src/components/expandedCard/CardInfoSection.tsx#L120): `<Text style={styles.categoryText}>{getReadableCategoryName(category)}</Text>` |
| **Detail** | Direct read confirms translation on the visible chip. `getReadableCategoryName` ([categoryUtils.ts:50-117](../../app-mobile/src/utils/categoryUtils.ts#L50-L117)) handles legacy slug normalization + i18n lookup + title-case fallback. For the 10 visible canonical slugs in the en locale, returns "Nature & Views", "Casual", "Brunch", etc. correctly. |
| **Where the user might still see slugs** | (a) Locale-key-missing path: `getReadableCategoryName` falls back to title-cased slug (e.g., `casual_food` → "Casual Food"). For en/es this is rare (23 keys present); for fr (13 keys) and 25 unaudited locales, slug-leak via fallback is plausible. (b) `CardInfoSection.tsx:65-99` icon-fallback path uses `categoryLower.includes("stroll" \| "sip" \| "dining" ...)` — the icon is selected by string-contains matching on the slug. For canonical slugs that don't contain those words, icon falls to `"star"` default. This is not a slug-leak (the icon name is internal) but it is a slug-dependent fallback. (c) Other sub-components receiving `category` raw (`WeatherSection`, `TimelineSection`) — currently confirmed not user-rendering it but latent leak risk. |
| **Implication for spec-writer** | The user's "slug shows" complaint is real but the *primary chip* is not the leak site. Spec writer should investigate the user's specific repro to identify which sub-feature is showing the slug. Recommend asking user for a screenshot or the exact text they saw. |
| **Confidence** | **HIGH** that the primary chip is translated. **MEDIUM** on which sub-feature surfaces the slug the user saw. |

### 🔵 OBS-3 — Location-gated fetches silently skip — three rich sections (weather, busyness, booking) never appear for chat-shared cards

| Field | Evidence |
|-------|----------|
| **File + line** | [ExpandedCardModal.tsx:1343](../../app-mobile/src/components/ExpandedCardModal.tsx#L1343), [:1361](../../app-mobile/src/components/ExpandedCardModal.tsx#L1361), [:1382](../../app-mobile/src/components/ExpandedCardModal.tsx#L1382) — three `if (card.location)` blocks |
| **Detail** | Weather, busyness, and booking fetches are all gated on `card.location` (a required-by-RPC pair of lat/lng coords). CardPayload doesn't carry `location` (correctly excluded for size — strollData/picnicData/socialStats also excluded for similar reasons per spec §6.2). All three fetches return early. Sections render in their default loading=false/data=null states (likely hidden or empty). |
| **Why observation, not finding** | This IS the user's "missing key details" mechanism — but it's classified as observation because it's *behavior caused by RC-1* (field-shape gap), not a separate defect. Listing it here for spec-writer clarity: these are the three sections most user-visibly absent. |
| **Confidence** | **HIGH.** |

### 🔵 OBS-4 — `currentMode="solo"` is hardcoded in the chat-mounted modal mount

| Field | Evidence |
|-------|----------|
| **File + line** | [MessageInterface.tsx:1388](../../app-mobile/src/components/MessageInterface.tsx#L1388): `currentMode="solo"` |
| **Detail** | The modal accepts a `currentMode` prop. The chat-mounted instance hardcodes `"solo"`. The user's actual mode (solo / collaboration / paired) is not passed through. |
| **Implication** | Whatever the modal does with `currentMode` (likely affects save destinations, share/gift flows, recommendation surfaces) is locked to solo for chat-shared cards even if the user is in collab mode. Could affect "save" target if/when Save is wired. Spec writer should consider whether to pass through the actual mode. |
| **Confidence** | **HIGH** on the hardcoded value. **LOW** on the runtime impact (would require auditing every `currentMode` consumer in the modal). |

---

## 5 — Field read-site inventory (the contractual artifact)

This is the spec-writer's contract surface. Every field `ExpandedCardModal` accesses on `card`, what it does, whether CardPayload carries it, and what the user sees for chat-shared cards.

| Field | Required in ExpandedCardData? | In CardPayload? | Read-site (file:line) | Render context | Result for chat-shared cards |
|-------|--------------------------------|------------------|------------------------|----------------|-------------------------------|
| `id` | YES | YES | 1418, 1438, 1465, 2105 | Anchor IDs in stroll/picnic timeline | Works |
| `title` | YES | YES | 1365, 1419, 1467, 1655, 1779, 1780, 1995, 2009, 2104 | Header / hero title / nightOut title / CardInfoSection title | Works |
| `category` (slug) | YES | YES | 1328, 1370, 1387, 1405-1409, 1456, 1505-1506, 1510, 1780, 1874, 1994, 2008 | Used for type detection, API calls, AND user display via CardInfoSection | Translated chip works; sub-component renders are silent today |
| `categoryIcon` | YES | NO | 1781 → CardInfoSection | Icon next to category chip | Falls back to slug-string-contains pattern matching (CardInfoSection:65-99); reaches `"star"` default for many canonical slugs |
| `description` | YES | YES (capped 500 chars) | 1791 → CardInfoSection | Card body text | Works (truncated) |
| `fullDescription` | YES | NO | NEVER RENDERED | — | Pre-existing dead read; HF-2 |
| `image` | YES | YES | 1637 | ImageGallery initial image | Works |
| `images` | YES | YES (cap 6) | 1636-1637 | ImageGallery carousel | Works |
| `rating` | YES | YES | 1783 → CardInfoSection | Rating chip | Works |
| `reviewCount` | YES | YES | NEVER RENDERED in modal | — | Pre-existing dead read; HF-2 |
| `priceRange` | OPT | YES | 1788, 1997, 2011 → CardInfoSection / TimelineSection | Price tier display | Works |
| `priceTier` | OPT | NO | 1789 → CardInfoSection | Tier display | CardInfoSection:58 falls back to `googleLevelToTierSlug(priceLevel)` — but `priceLevel` is also undefined → tier renders as null/empty |
| `address` | YES | YES | 1368, 1421, 1469, 1517, 1745, 1894, 1996, 2010 | Directions + PracticalDetailsSection + TimelineSection | Works |
| `phone` | OPT | NO | 1391, 1897 | bookingService input + PracticalDetailsSection | Booking call returns no useful options; PracticalDetailsSection hides phone row |
| `website` | OPT | NO | 1390, 1897 | bookingService input + PracticalDetailsSection | Booking call returns no useful options; PracticalDetailsSection hides website row |
| `location` | OPT | NO | 1343, 1361, 1382 | Gates 3 fetches: weather, busyness, booking | All 3 sections silently skip — visible "missing details" |
| `openingHours` | OPT | NO | 1116, 1895 | extractWeekdayText + PracticalDetailsSection | Section hidden (extractWeekdayText returns null) |
| `highlights` | YES | YES (cap 5) | NEVER RENDERED in modal | — | Pre-existing dead read; HF-2 |
| `tags` | YES | NO | 1782 → CardInfoSection | Tag chips row | CardInfoSection receives undefined; behavior depends on its formatTag null-handling (likely renders empty row) |
| `matchScore` | YES | YES | NEVER RENDERED in modal | — | Pre-existing dead read; HF-2 |
| `matchFactors` | YES | NO | imported but never rendered | — | HF-1 |
| `socialStats` | YES | NO | NEVER RENDERED in modal | — | Pre-existing dead read; HF-2 |
| `distance` | YES | NO | 1784 → CardInfoSection | Distance pill | Hidden (CardInfoSection guards `distance != null`) |
| `travelTime` | OPT | NO | 1785, 1889, 1998, 2012 | Travel pill in CardInfoSection / BusynessSection / TimelineSection | Hidden; BusynessSection `\|\| "N/A"` fallback exists but only fires when busyness data loads, which it doesn't |
| `travelMode` | OPT | NO | 1786 | Travel-mode icon | Falls back to `userPreferences?.travel_mode` — honest fallback |
| `selectedDateTime` | OPT | NO | 1876-1879 | WeatherSection date | Honest coercion → undefined → weather defaults to "now" |
| `placeId` | OPT | NO | 1369 (via `(card as any).source?.placeId`) | bookingService dedup key | Booking returns no useful options |
| `strollData` | OPT | NO | 1244, 1281-1282 | Stroll timeline section | Section hidden (data null) |
| `picnicData` | OPT | NO | 1246, 1282 | Picnic timeline section | Section hidden (data null) |
| `cardType` | OPT | NO | 1280, 1297, 1500 | Curated branch detection | `false` for chat-shared cards → falls into regular layout |
| `nightOutData` | OPT | NO | 1512-1513, 1518-1532, 1652-2078 | Entire nightOut layout branch | `false` for chat-shared cards → regular layout |
| `tip` | OPT | NO | 1792 → CardInfoSection | Optional tip text | Section hidden |

**Counts:**
- Fields ExpandedCardData REQUIRES that CardPayload does NOT carry: 6 (`categoryIcon`, `fullDescription`, `tags`, `matchFactors`, `socialStats`, `distance`).
- Optional fields the modal reads that CardPayload does NOT carry: 12 (`priceTier`, `phone`, `website`, `location`, `openingHours`, `travelTime`, `travelMode`, `selectedDateTime`, `placeId`, `strollData`, `picnicData`, `nightOutData`).
- Fields persisted in CardPayload but never rendered by the modal (regardless of source): 4 (`reviewCount`, `highlights`, `fullDescription`-via-CardPayload-no-mapping, `matchScore`).

---

## 6 — Slug-leak audit (focused)

Every render of `card.category` to the user — confirmed via direct file read:

| File:line | Render | Translated? |
|-----------|--------|-------------|
| [CardInfoSection.tsx:120](../../app-mobile/src/components/expandedCard/CardInfoSection.tsx#L120) | `<Text>{getReadableCategoryName(category)}</Text>` | **YES** |
| [ExpandedCardModal.tsx:1874](../../app-mobile/src/components/ExpandedCardModal.tsx#L1874) | `<WeatherSection category={card.category}>` (passes raw to child) | **N/A** — WeatherSection does not render the slug to user (verified via grep) |
| [ExpandedCardModal.tsx:1994](../../app-mobile/src/components/ExpandedCardModal.tsx#L1994) | `<TimelineSection category={card.category}>` (Stroll variant) | **N/A** — TimelineSection passes to `generateTimeline()` only (verified at line 114) |
| [ExpandedCardModal.tsx:2008](../../app-mobile/src/components/ExpandedCardModal.tsx#L2008) | `<TimelineSection category={card.category}>` (Picnic variant) | **N/A** — same |

**Verdict:** The visible category chip IS translated. The other category-prop sites pass raw slugs to children that do NOT render them to the user today. **No active user-visible slug leak in the primary modal render path.**

The user-perceived "slug shows" symptom is most plausibly explained by:
- (a) `getReadableCategoryName` falling through to title-case fallback when the user's locale is missing the i18n key (e.g., `casual_food` → "Casual Food" instead of locale-translated form). v1 confirmed fr/common.json has 13 of 23 keys; 25 locales unaudited.
- (b) A different sub-component within a section that DOES surface for non-location-gated cards (e.g., a debug pill or a label in PracticalDetailsSection) — not yet audited line-by-line.
- (c) The user observed the slug-leak in a *deck* card rather than a chat-shared card, and conflated the two reports — possible but unconfirmed.

**Recommendation for the spec-writer:** ask the user for a screenshot of the slug they're seeing, or for the exact text. This narrows the leak site to one of the three above and avoids over-fixing the spec.

---

## 7 — `categoryIcon` mismatch verified

| Site | What it does |
|------|--------------|
| [ExpandedCardModal.tsx:1781](../../app-mobile/src/components/ExpandedCardModal.tsx#L1781) | `categoryIcon={card.categoryIcon}` — passes possibly-undefined value |
| [CardInfoSection.tsx:65-99](../../app-mobile/src/components/expandedCard/CardInfoSection.tsx#L65-L99) | If `categoryIcon` is truthy, use it. Else: pattern-match `categoryLower.includes("stroll" \| "sip" \| "dining" \| ...)` to pick a default icon. Fallback: `"star"`. |

For chat-shared cards: `card.categoryIcon` is undefined → fallback path runs → for canonical slugs like `casual_food`, `nature`, `drinks_and_music`, `creative_arts`, the substring match against legacy English words doesn't apply cleanly. Result: many cards land on the `"star"` default icon. **Not a slug leak. But a poor user experience: the icon doesn't visually match the category.**

---

## 8 — Five-truth-layer reconciliation

| Layer | What it says | Verdict |
|-------|--------------|---------|
| **Docs (Spec)** | SPEC_ORCH-0667 §9.6 explicitly required modal compatibility verification (IMPL step 7c) with three acceptable outcomes (widen, default, document). The spec is correct and complete. |
| **Schema** | `messages.card_payload jsonb` persists the 12-field CardPayload shape. `messages_card_requires_payload` constraint enforces non-null. Schema is permissive — it carries what's written. |
| **Code (Implementor)** | The unsafe cast at MessageInterface.tsx:942-948 ships unverified. CardPayload trim function at messagingService.ts:53-88 captures 12 fields. Modal at ExpandedCardModal.tsx reads ~30 fields. **The spec-required verification step never ran.** |
| **Runtime** | The modal opens for every chat-shared card. Three sections silently skip. Save button ships the no-op. User sees the ship — the modal looks "less rich" than expected but doesn't crash. |
| **Data** | Live DB has zero hypothetical chat-shared rows that would surface a different shape — every row through `sendCardMessage` flows the same trim. Data layer confirms the bug is render-side, not write-side. |

**Verdict:** Layers do not contradict each other. They all confirm the same story: spec asked for verification → code shipped without it → runtime renders incomplete → data is consistent with the runtime behavior. **The bug is upstream (process: spec acceptance gate), not downstream.**

---

## 9 — Blast radius

| Surface | Affected today? | After fix |
|---------|-----------------|-----------|
| Modal opened from chat-bubble tap (sender side) | YES — RC-1 + CF-2 | Fixed by spec |
| Modal opened from chat-bubble tap (recipient side) | YES — same | Fixed by spec |
| Modal opened from deck card | NO (deck cards are `ExpandedCardData`-shaped) | No change |
| Modal opened from saved tab card | NO (saved cards normalize via `normalizeRecord` but carry richer fields than CardPayload — confirmed by [savedCardsService.ts:43-64](../../app-mobile/src/services/savedCardsService.ts#L43-L64)) | No change |
| Modal opened from session view | NO | No change |
| Modal opened from calendar tab | NO | No change |
| Modal opened from holiday view | NO | No change |
| `MatchFactorsBreakdown` (HF-1) | All cards (modal never renders it) | Out of ORCH-0685 scope; flag for orchestrator |
| Stroll/Picnic timeline UI (CF-3) | Likely never renders for current canonical-slug cards | Out of ORCH-0685 scope; flag for orchestrator |
| Other surfaces using CardPayload | None — CardPayload is exclusively consumed by chat-share trim function and chat bubble + chat-mounted modal | No change |

**Cross-domain check:** Mobile only. Admin doesn't render chat content. Business app pre-MVP.

**Affected query keys:** None — fix is render/payload-shape only. No invalidation needed.

---

## 10 — Constitutional check

| # | Principle | Violated by ORCH-0685 today? | Reasoning |
|---|-----------|------------------------------|-----------|
| **#1** | No dead taps | **YES** — Save button in chat-mounted modal is wired to a no-op (CF-2). User taps, nothing happens, no feedback. |
| **#2** | One owner per truth | NO. CardPayload remains the sole shape for chat-shared cards; modal remains the sole renderer. |
| **#3** | No silent failures — errors must surface | **YES (in spirit)** — three sections (weather, busyness, booking) silently skip without telling the user "this section unavailable for shared cards." Mode-aware empty state would honor #3 (precedent: ORCH-0678 mode-aware empty state). |
| **#4** | One query key per entity | NO. |
| **#5** | Server state stays server-side | NO. |
| **#6** | Logout clears everything | N/A. |
| **#7** | Label temporary fixes | The `// no-op in chat-mounted modal` comment is a TEMP marker that was never resolved. Spec should either remove the temp by fixing or label it explicitly. Mild violation. |
| **#8** | Subtract before adding | NO. But the unsafe cast IS a candidate for subtraction — replacing the cast with a proper widening or null-safe defaults removes the deception. |
| **#9** | No fabricated data | **NOT today** for chat-shared cards (HF-3 risk only fires when location is present, which it never is for chat-shared). But spec writer should preempt by removing the `\|\| "N/A"` literal in BusynessSection. |
| **#10** | Currency-aware UI | NO. `priceRange` flows correctly. `priceTier` falls back to undefined when neither tier nor priceLevel is present — empty pill, not fabricated. |
| **#11** | One auth instance | N/A. |
| **#12** | Validate at the right time | The unsafe cast IS validation-deferred — TypeScript validates types at compile-time, but the cast bypasses that. Spec writer should restore validation. |
| **#13** | Exclusion consistency | NO. RLS unchanged. |
| **#14** | Persisted-state startup | NO. |

**Net constitutional load:** 2 active violations (#1, #3) + 1 mild violation (#7) + 1 deferred-validation issue (#12) + 1 preventive risk (#9 via HF-3). The Save dead-tap (#1) is the most user-visible and most spec-binding.

---

## 11 — Invariant violations

| Invariant ID | Violated? | Notes |
|--------------|-----------|-------|
| **I-CHAT-MESSAGE-TYPE-CARD-PAYLOAD-COMPLETENESS** (ORCH-0667) | NO | Persisted payload always contains `{id, title, category, image}`. Render-side gap is separate. |
| **I-DM-PARTICIPANTS-ONLY** (RLS) | NO | Unchanged. |
| **Process invariant (proposed)** | **NEW CANDIDATE** | "Every spec acceptance step that mandates implementor verification (e.g. IMPL step Nx) MUST appear as a labeled section in the implementation report. Missing → reject the closure." This would have caught RC-2. Recommend orchestrator file as program-level invariant proposal. |

---

## 12 — Fix strategy (direction only — not a spec)

The spec writer must bind these decisions:

1. **Field-shape gap resolution** — pick one or a hybrid:
   - **(a) Widen CardPayload** to add `location`, `placeId`, `phone`, `website`, `openingHours`. This unlocks weather + busyness + booking + opening-hours expander + dead phone/website rows. Storage cost ≈ +200 bytes per shared card (well within 5KB budget).
   - **(b) Add null-safe defaults inside the modal** so missing fields render mode-aware empty states ("This section is only available when you open the card from your saved cards" — Constitution #3 honored).
   - **(c) Hybrid:** widen for cheap-and-impactful fields (`location`, `placeId`); accept gap for `tags`, `matchFactors`, `socialStats` with mode-aware empty states.
   - **Recommendation:** hybrid. Widen `location` + `placeId` (single field-pair adds the three biggest sections). Document `tags`/`matchFactors`/`socialStats` as v1 gap with mode-aware empty states. Keep `strollData`/`picnicData`/`nightOutData` excluded (they're context-specific).
2. **Save button** — choose one of:
   - **(a) Hide entirely** in chat-mounted modal (cleanest; pass a `hideSaveButton` prop).
   - **(b) Wire to "save the shared card to my own collection"** (highest-signal; calls `savedCardsService.saveCard(currentUserId, cardPayload)`).
   - **(c) Replace with toast-on-tap** explaining the limitation.
   - **Recommendation:** (b). The recipient's most natural intent on seeing a shared card is "I want this." Wiring Save to the saved-cards service closes the loop and adds an obvious second-order share metric.
3. **Slug-leak follow-up** — ask the user for a screenshot of the slug they're seeing. Without that, spec writer should at minimum add a `getReadableCategoryName` wrapper at every category-prop site that could surface to user (`WeatherSection`, `TimelineSection`) as defense-in-depth, and audit fr/+ 25 locales for `category_*` parity (carry forward from v1 D-2).
4. **`categoryIcon` resolution** — change [ExpandedCardModal.tsx:1781](../../app-mobile/src/components/ExpandedCardModal.tsx#L1781) from `categoryIcon={card.categoryIcon}` to `categoryIcon={card.categoryIcon ?? getCategoryIcon(card.category)}`. This guarantees every chat-shared card gets a category-correct icon instead of falling to `"star"`.
5. **Pre-existing dead reads (HF-1, HF-2)** — out of ORCH-0685 scope. Recommend orchestrator file as separate ORCH for "modal-renders-its-required-fields audit."
6. **Stroll/Picnic detection (CF-3)** — out of ORCH-0685 scope. Recommend orchestrator file as separate ORCH.
7. **Process safeguard (RC-2)** — recommend orchestrator add a CI gate or REVIEW protocol step: "Implementation report MUST include a row for every spec-mandated IMPL verification step." Catches the next step-7c-class skip.

---

## 13 — Discoveries register

| ID | Title | Recommendation |
|----|-------|----------------|
| **ORCH-0685.D-4** | `MatchFactorsBreakdown` imported but never rendered in `ExpandedCardModal` (HF-1) | DEFER — file separately as cleanup ORCH |
| **ORCH-0685.D-5** | `reviewCount`, `highlights`, `fullDescription`, `socialStats` declared on ExpandedCardData but never rendered by modal (HF-2) | DEFER — same separate cleanup ORCH |
| **ORCH-0685.D-6** | Stroll/Picnic type detection uses legacy English display names; misses canonical slugs (CF-3) | DEFER — separate ORCH for category-detection-modernization |
| **ORCH-0685.D-7** | `currentMode` hardcoded `"solo"` in chat-mounted modal mount; user's actual mode dropped (OBS-4) | BUNDLE if low-cost; else DEFER |
| **ORCH-0685.D-8** | Process invariant proposal: "Implementation report MUST list every spec-mandated IMPL verification step." Would have caught RC-2 at REVIEW. | ESCALATE to orchestrator program-level |
| **ORCH-0685.D-9** | `BusynessSection` `\|\| "N/A"` literal fabrication (HF-3) — not user-visible today, but preempt before any future location-widening | BUNDLE preventively if spec widens `location` |
| **ORCH-0685.D-10** | Locale parity audit (carryover from v1 D-2): fr/common.json has 13 of 23 `category_*` keys; 25 locales unaudited | BUNDLE as ship-gate (was already v1 D-2; reaffirmed here) |

ORCH-0685.D-1 (picker-row alignment) and D-2 (locale parity v1) and D-3 (`category_groceries`) all closed by user steering — D-1 + D-2 confirmed not-needed in this scope; D-3 confirmed not-a-real-case.

---

## 14 — Confidence summary

| Aspect | Confidence | Reasoning |
|--------|-----------|-----------|
| **RC-1 field-shape gap proven** | **HIGH** | Direct read of CardPayload + ExpandedCardData interfaces + ExpandedCardModal field reads. Mathematically forced. |
| **RC-2 IMPL step 7c skipped proven** | **HIGH** | Direct grep of implementation report. Zero matches. |
| **CF-1 `getReadableCategoryName` not in modal proven** | **HIGH** | Direct grep. |
| **CF-2 Save dead-tap proven** | **HIGH** | Direct read of MessageInterface.tsx:1387 no-op + Explore audit of ActionButtons render. |
| **CF-3 Stroll/Picnic detection mismatch proven** | **HIGH** on code; **MEDIUM** on runtime impact distribution |
| **HF-1, HF-2** | **HIGH** on dead reads (Explore audit confirmed) |
| **HF-3** | **MEDIUM** — Explore audit only; have not directly read BusynessSection.tsx in v2 |
| **Visible chip IS translated (OBS-2)** | **HIGH** — direct read of CardInfoSection.tsx:120 |
| **User-perceived slug-leak source** | **MEDIUM** — three plausible mechanisms (locale-key-missing fallback, sub-component leak, deck-card-conflation); cannot disambiguate without user screenshot or repro |
| **Sender vs recipient symmetry** | **HIGH** |

---

## 15 — Open questions for the spec-writer

1. **Field-shape gap resolution direction:** widen CardPayload (which fields), add null-safe defaults (which sections get mode-aware empty states), or hybrid? Spec must commit to one approach for each missing field.
2. **Save button:** hide / wire-to-saveCard / toast-explainer? Pick one.
3. **Slug-leak source:** can the user share a screenshot of the slug they saw? Without that the spec is over-fixing.
4. **`categoryIcon` fallback:** acceptable to read `card.categoryIcon ?? getCategoryIcon(card.category)` at the modal level, or should `trimCardPayload` be widened to include `categoryIcon`?
5. **`currentMode` pass-through:** drop the hardcoded `"solo"` and pass the actual user mode? If so, what becomes of save destination + recommendation logic for chat-shared cards opened in collab mode?
6. **Mode-aware empty states:** what specific copy for sections that genuinely cannot render (e.g., booking without location)? "Save this card to see weather and bookings" vs "Booking unavailable for shared cards" vs hide silently? Constitution #3 demands surfacing, not silence.
7. **HF-1/HF-2 timing:** bundle the dead-render fixes (`reviewCount`, `highlights`, `matchFactors`, `socialStats`, `fullDescription`) into ORCH-0685 spec, or defer? They're orthogonal to chat-share but the spec writer is already touching the modal.
8. **Process invariant (D-8):** does orchestrator want to add the "implementation report MUST list every spec-mandated IMPL verification step" gate as a CI check or REVIEW-protocol item? This is the program-level fix for RC-2 and prevents the next step-7c-class skip.
