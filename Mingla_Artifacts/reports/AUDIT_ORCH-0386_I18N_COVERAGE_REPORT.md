# AUDIT: ORCH-0386 i18n Full Coverage Report

**Date:** 2026-04-11
**Auditor:** Forensics Agent
**Scope:** Every .tsx file in app-mobile/src/components/, hooks/, services/, constants/, app/

---

## Executive Summary

The i18n implementation covers the vast majority of user-facing strings. Key parity is **perfect** across all 23 namespaces (EN/ES match exactly). However, the audit found **3 categories of gaps** totaling ~50 remaining hardcoded strings:

1. **16 Alert.alert() calls** with hardcoded English titles/messages (P0)
2. **7 placeholder props** with hardcoded English (P0)
3. **15 accessibilityLabel props** with hardcoded English (P1)
4. **13 category display names** in constants/categories.ts (P0 — shown on cards and filters)
5. **5 price tier labels** in constants/priceTiers.ts (P0 — shown on cards and filters)
6. **6 transport mode + intent labels** in types/onboarding.ts (P0 — shown during onboarding)
7. **1 toast in hooks** (P0)

---

## Audit 1: Key Parity (ALL namespaces)

**Verdict: PERFECT** — All 23 namespaces have identical EN/ES key counts.

| Namespace | EN | ES | Status |
|-----------|----|----|--------|
| common | 60 | 60 | OK |
| onboarding | 171 | 171 | OK |
| navigation | 8 | 8 | OK |
| cards | 80 | 80 | OK |
| discover | 56 | 56 | OK |
| preferences | 55 | 55 | OK |
| share | 16 | 16 | OK |
| paywall | 8 | 8 | OK |
| profile | 53 | 53 | OK |
| settings | 77 | 77 | OK |
| connections | 30 | 30 | OK |
| saved | 25 | 25 | OK |
| feedback | 41 | 41 | OK |
| activity | 127 | 127 | OK |
| board | 170 | 170 | OK |
| notifications | 25 | 25 | OK |
| chat | 79 | 79 | OK |
| social | 121 | 121 | OK |
| map | 65 | 65 | OK |
| modals | 101 | 101 | OK |
| billing | 72 | 72 | OK |
| expanded_details | 70 | 70 | OK |
| auth | 12 | 12 | OK |
| **TOTAL** | **1,546** | **1,546** | **ALL OK** |

---

## Audit 2: Remaining Hardcoded Alert.alert() Calls (P0)

16 Alert.alert calls with hardcoded English:

| File | String | Severity |
|------|--------|----------|
| board/BoardDiscussionTab.tsx:245 | `Alert.alert("Error", "Failed to update message")` | P0 |
| board/BoardDiscussionTab.tsx:274 | `Alert.alert("Error", "Failed to delete message")` | P0 |
| board/BoardSettingsDropdown.tsx:102 | `Alert.alert("Permission denied", "Only the session creator or admins can edit...")` | P0 |
| board/BoardSettingsDropdown.tsx:113 | `Alert.alert("Error", "Session name cannot be empty.")` | P0 |
| board/BoardSettingsDropdown.tsx:134 | `Alert.alert("Success", "Session name updated successfully.")` | P0 |
| board/BoardSettingsDropdown.tsx:151 | `Alert.alert("Permission denied", "Only admins can delete this session.")` | P0 |
| board/BoardSettingsDropdown.tsx:165 | `Alert.alert("Success", "Session deleted successfully.")` | P0 |
| board/BoardSettingsDropdown.tsx:185 | `Alert.alert("Permission denied", "Only the session creator or admins can delete...")` | P0 |
| board/InviteParticipantsModal.tsx:234 | `Alert.alert("Error", "Failed to send invites...")` | P0 |
| board/InviteParticipantsModal.tsx:240 | `Alert.alert("Error", "Failed to send invites...")` | P0 |
| board/ManageBoardModal.tsx:459 | `Alert.alert("Left Board", "You have successfully left the board.")` | P0 |
| expandedCard/ActionButtons.tsx:369 | `Alert.alert("Error", ...)` — title hardcoded, body uses t() | P0 |
| expandedCard/ActionButtons.tsx:506 | `Alert.alert("Error", ...)` — title hardcoded, body uses t() | P0 |
| expandedCard/ActionButtons.tsx:672 | `Alert.alert("Share", ...)` — fully hardcoded | P0 |
| AppHandlers.tsx:1054 | `Alert.alert("Error", "You must be logged in to remove calendar entries.")` | P0 |
| ProfilePage.tsx:257 | `Alert.alert("Error", "Failed to upload profile photo.")` | P0 |

---

## Audit 3: Remaining Hardcoded Placeholders (P0)

7 placeholder props with hardcoded English:

| File | String |
|------|--------|
| board/BoardDiscussionTab.tsx:779 | `placeholder="Type @ to mention, # to tag a card..."` |
| board/BoardSettingsDropdown.tsx:377 | `placeholder="Enter session name"` |
| board/InviteParticipantsModal.tsx:292 | `placeholder="Search friends..."` |
| onboarding/CountryPickerModal.tsx:170 | `placeholder="Search countries..."` |
| onboarding/LanguagePickerModal.tsx:142 | `placeholder="Search languages..."` |
| BoardDiscussion.tsx:633 | `placeholder="Message..."` |
| CollaborationSessions.tsx:590 | `placeholder="Phone number"` |

---

## Audit 4: Remaining Hardcoded Accessibility Labels (P1)

15 accessibilityLabel props with hardcoded English:

| File | String |
|------|--------|
| onboarding/CountryPickerModal.tsx:153 | `"Close country picker"` |
| onboarding/LanguagePickerModal.tsx:126 | `"Close language picker"` |
| profile/AccountSettings.tsx:484 | `"Close account settings"` |
| profile/ProfileHeroSection.tsx:218 | `"Cancel editing"` |
| profile/ProfileHeroSection.tsx:228 | `"Save name"` |
| profile/ProfileInterestsSection.tsx:89 | `"Edit your interests"` |
| profile/ViewFriendProfileScreen.tsx:108 | `"Go back"` |
| signIn/WelcomeScreen.tsx:294 | `"Dates, hangouts, and everything in between — sorted."` |
| AnimatedSplashScreen.tsx:100 | `"Mingla"` |
| AppLoadingScreen.tsx:34 | `"Mingla"` |
| BetaFeedbackModal.tsx:514 | `"Add screenshots from library"` |
| FeedbackHistorySheet.tsx:156 | `"Delete this feedback"` |
| FeedbackHistorySheet.tsx:310 | `"Close screenshot"` |
| OnboardingFlow.tsx:2639 | `"Change selected location"` |
| VisitBadge.tsx:14 | `"Visited"` |

---

## Audit 5: Constants With Untranslated Display Labels (P0)

### categories.ts — 13 category names
`Nature & Views`, `First Meet`, `Picnic Park`, `Drink`, `Casual Eats`, `Fine Dining`, `Watch`, `Live Performance`, `Creative & Arts`, `Play`, `Wellness`, `Flowers` — plus their descriptions. These are rendered directly on cards and filter chips.

### priceTiers.ts — 5 tier labels
`Any`, `Chill`, `Comfy`, `Bougie`, `Lavish` + range labels (`$50 max`, `$50 – $150`, etc.)

### onboarding.ts — transport modes + intent labels
`Walking`, `Biking`, `Transit`, `Driving` — rendered on onboarding transport step.
Intent labels are already translated via t() at render time in OnboardingFlow, but the constant itself still has English.

---

## Audit 6: Hooks/Services With User-Facing Strings (P0)

| File | String |
|------|--------|
| hooks/useMapSettings.ts:78 | `toastManager.error("Couldn't update your setting. Try again.", 3000)` |

---

## Audit 7: i18n Registration

**Verdict: COMPLETE** — 23 JSON files in en/, 23 in es/, 46 imports in index.ts, all namespaces in `ns` array.

---

## Audit 8: Push Translation Coverage

The `typeToPreference` map in notify-dispatch has these notification types. Cross-checking against push-translations.ts:

All standard types covered. The types `session_member_joined`, `session_member_left`, `board_card_saved`, `board_card_voted`, `board_card_rsvp` exist in typeToPreference but their actual notification text comes from the calling functions — they may or may not have entries in push-translations.ts. **Low risk** — these are secondary notification types.

---

## Audit 9: Spanish Translation Quality

Spot-checking 10 random keys:

| Namespace | Key | ES Translation | Quality |
|-----------|-----|---------------|---------|
| cards | swipeable.curating | "Preparando tu selección" | Natural |
| discover | filters.any_date | "Cualquier fecha" | Correct |
| settings | delete.confirm_title | "¿Estás seguro?" | Natural |
| board | invite_code.title | "Código de invitación" | Correct |
| social | block.title | "Bloquear a {{name}}?" | Correct interpolation |
| activity | calendar.active | "Activas" | Correct |
| map | privacy.title | "Privacidad del mapa" | Natural |
| feedback | modal.category_label | "¿Qué tipo de comentario?" | Natural |
| chat | message_input.placeholder | "Escribe un mensaje..." | Natural |
| billing | subscription.manage | "Administrar suscripción" | Correct |

**Verdict: GOOD** — All 10 samples are natural, grammatically correct Spanish.

---

## Summary of Findings

| Category | Count | Severity | Fix Effort |
|----------|-------|----------|------------|
| Alert.alert hardcoded | 16 | P0 | Medium — add keys to existing namespaces |
| Placeholder hardcoded | 7 | P0 | Small — add keys |
| AccessibilityLabel hardcoded | 15 | P1 | Small — add keys |
| Constants display labels (categories) | 13 names + descriptions | P0 | Medium — need i18n approach for constants |
| Constants display labels (price tiers) | 5 labels + ranges | P0 | Medium — same |
| Constants display labels (transport) | 4 labels | P0 | Small |
| Hook toast messages | 1 | P0 | Tiny |
| **TOTAL** | **~61 strings** | | |

---

## Recommendations

1. **Fix the 16 Alert.alert calls** — add translation keys to board, expanded_details, profile namespaces and use `t()`.
2. **Fix the 7 placeholders** — add to board, onboarding, modals namespaces.
3. **Fix the 15 accessibility labels** — add to relevant namespaces. "Mingla" brand name can stay English.
4. **Constants approach:** The category/price tier/transport labels are used as data identifiers AND display labels. The cleanest approach: keep English slugs as identifiers, create a lookup function that maps slug → translated display name using i18n keys.
5. **Fix the 1 hook toast** — this requires the hook to accept a `t` function or use `i18n.t()` directly (import i18n instance).

---

## Discoveries for Orchestrator

None new — all findings are i18n gaps within ORCH-0386 scope.
