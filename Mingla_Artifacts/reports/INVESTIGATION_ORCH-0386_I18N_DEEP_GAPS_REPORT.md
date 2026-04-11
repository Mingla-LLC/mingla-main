# ORCH-0386 — Deep Gap Investigation: Remaining i18n Issues

**Date:** 2026-04-11
**Confidence:** HIGH

---

## Layman Summary

The automated audit missed three categories of gaps that only show up during real device testing:

1. **Intent/experience type labels on cards** — "Adventurous", "Romantic" etc. appear in English on every card because they come from API data or hardcoded lookup tables, not from the i18n system. This affects the swipe deck, expanded cards, saved cards, and board cards.

2. **Category names from API data** — The audit fixed category constants, but cards receive `card.category` as an English string from the API. At least 5 card components render this directly without translation.

3. **Partially-translated modals** — CollaborationSessions has 10+ untranslated alerts/labels despite importing useTranslation. NotificationsModal has untranslated filter tabs, action labels, and time formatting. PreferencesSheet has untranslated title, buttons, and section headers.

**Root cause pattern:** Components that import `useTranslation` but only apply it to SOME strings (the easy ones), leaving alerts, fallbacks, and data-driven labels hardcoded.

---

## Finding 1: Intent/Experience Type Labels — ZERO Translation (P0)

Intent labels ("Adventurous", "First Dates", "Romantic", etc.) are defined in 4+ places and NONE use i18n:

| Render Site | File | How It Gets Label | i18n? |
|-------------|------|-------------------|-------|
| Curated swipe card badge | CuratedExperienceSwipeCard.tsx:57 | `card.categoryLabel \|\| 'Adventurous'` | NO |
| Board session card badge | board/SwipeableSessionCards.tsx:272-334 | `cardData.categoryLabel \|\| "Adventurous"` | NO |
| Saved tab curated badge | activity/SavedTab.tsx:1689-1728 | Local `EXPERIENCE_LABELS` lookup (hardcoded English) | NO |
| Expanded card (night out genre) | ExpandedCardModal.tsx:1652-1665 | `nightOut.genre` / `nightOut.subGenre` from API | NO |
| Preferences sheet mood selector | PreferencesSheet.tsx:76-81 | Local `experienceTypes` array (hardcoded English labels) | NO |

**Root cause:** `categoryLabel` comes from the curated card API response as an English string. There's also a local `EXPERIENCE_LABELS` lookup in SavedTab and an `experienceTypes` array in PreferencesSheet — all hardcoded English with no `t()`.

**Fix approach:** Add intent translation keys to `common.json` (matching the pattern used for categories: `intent_adventurous`, `intent_first_date`, etc.). Replace all render sites with `t('common:intent_${experienceType}')` where `experienceType` is the kebab-case ID. For API-sourced `categoryLabel`, ignore it and derive from the `experienceType` ID instead.

---

## Finding 2: Category Names from API Data — 5 Render Sites (P0)

The audit fix-up translated category constants, but cards receive `card.category` as an English string directly from the API response and render it without translation.

| Render Site | File:Line | Code | i18n? |
|-------------|-----------|------|-------|
| Board cards (brief) | SwipeableBoardCards.tsx:244 | `{card.category}` | NO |
| Board cards (expanded) | SwipeableBoardCards.tsx:382 | `{card.category}` | NO |
| Session cards | board/SwipeableSessionCards.tsx:461 | `{categoryLabel}` from API | NO |
| Activity experience cards | activity/ExperienceCard.tsx:422 | `{experience.category}` | NO |
| Expanded card info | expandedCard/CardInfoSection.tsx:119 | `{formatTag(category)}` | NO |

**Additional:** `categoryUtils.ts:34-133` has `getReadableCategoryName()` — a hardcoded English mapping. This utility is used by SwipeableCards (which appears to work), but it doesn't use `t()`.

**Fix approach:** At each render site, map `card.category` (which is a slug like "nature", "casual_eats") to `t('common:category_${slug}')`. The keys already exist in common.json from the audit fix-up. For `categoryUtils.ts`, either make it accept a `t` function or import `i18n` directly.

---

## Finding 3: CollaborationSessions.tsx — 10+ Untranslated Strings (P0)

Despite importing `useTranslation(['modals'])`, this component has many hardcoded English strings:

| Line | String | Type |
|------|--------|------|
| 273 | "Session limit reached" | Alert title |
| 274 | Alert body text | Alert message |
| 276-277 | "Cancel", "Upgrade" | Alert buttons |
| 284 | "Session name required" / "Please enter a session name..." | Alert title+body |
| 289-291 | "Add at least one collaborator" / safety message | Alert title+body |
| 335 | "That's you" / "You can't add yourself..." | Alert title+body |
| 344 | "Already selected" / "This person is already added..." | Alert title+body |
| 549 | "Create New Session" | Modal title |
| 555 | "Session Name" | Section label |
| 567 | "Add by phone number" | Section label |
| 688 | "Select Collaborators" | Section label |
| 725 | "No friends yet" | Empty state |
| 727 | "Invite someone by phone number above" | Empty state hint |
| 481 | "Solo" | Pill label |

---

## Finding 4: NotificationsModal.tsx — Filter Tabs + Time Formatting (P0)

Despite importing `useTranslation`, has hardcoded:

| Line | String | Type |
|------|--------|------|
| 41-44 | "All", "Social", "Sessions", "Messages" | Filter tab labels |
| 112-116 | "Accept", "Decline", "Join", "Review", "Upgrade" | Action buttons |
| 131-136 | "Just now", "Xm", "Xh", "Xd", "Xw" | Time formatting |
| 163-166 | "Today", "Yesterday", "This Week", "Earlier" | Section headers |

---

## Finding 5: PreferencesSheet.tsx (Parent) — 7+ Untranslated Strings (P0)

The parent `PreferencesSheet.tsx` (not the sub-components) has:

| Line | String |
|------|--------|
| 918 | "Your Vibe" (sheet title) |
| 953 | "Budget" (section title) |
| 954 | "Select every tier you're open to" (section subtitle) |
| 1030 | "Starting Point" (section title) |
| 1032 | "Where should we start looking?" (section subtitle) |
| 1082 | "Saving..." |
| 1086 | "Lock It In" (CTA button) |
| 1095 | "Start Over" (reset button) |
| 1115 | "Select Date" (calendar modal title) |

---

## Finding 6: Minor Gaps in Other Components

| File | Line | String | Severity |
|------|------|--------|----------|
| BoardMemberManagementModal.tsx | 146 | `' (You)'` suffix | P2 |
| AddToBoardModal.tsx | 45, 139 | `'Unknown'` fallback | P2 |
| AddToBoardModal.tsx | 53 | `'Just now'` time format | P2 |

---

## Summary of All Gaps

| Category | Count | Severity | Fix Type |
|----------|-------|----------|----------|
| Intent labels on cards (5 render sites) | ~30 strings | P0 | Add intent keys to common.json, replace renders |
| Category from API data (5 render sites + utility) | ~6 sites | P0 | Map slug → t() at render site |
| CollaborationSessions alerts/labels | ~15 strings | P0 | Add keys to modals.json, replace |
| NotificationsModal tabs/time/actions | ~20 strings | P0 | Add keys to notifications.json, replace |
| PreferencesSheet parent buttons/titles | ~9 strings | P0 | Add keys to preferences.json, replace |
| Minor gaps (3 components) | ~5 strings | P2 | Add keys, replace |
| **TOTAL** | **~85 strings** | | |

---

## Discoveries for Orchestrator

1. **`categoryUtils.ts:getReadableCategoryName()`** is a hardcoded English utility used across multiple card components. It needs to either accept a translation function or import i18n directly. This is a systemic issue — any new component that uses this utility will render English categories.

2. **API responses include English display labels** (`categoryLabel`, `category`, `genre`). Long-term, the backend should either return language-aware labels or only return slugs/IDs, letting the client translate. Short-term, the client should ignore API display labels and derive translated text from the ID/slug.
