# SPEC: ORCH-0386 — i18n Audit Fix-Up (All Remaining Gaps)

**Date:** 2026-04-11
**Investigation:** AUDIT_ORCH-0386_I18N_COVERAGE_REPORT.md
**Classification:** quality-gap
**Confidence:** HIGH

---

## Layman Summary

The i18n audit found ~61 hardcoded English strings that a Spanish-speaking user would still see in English. The biggest gap is category names ("Nature & Views"), price tiers ("Chill", "Comfy"), and transport modes ("Walking", "Biking") — these come from constants files and are never routed through the translation system. This spec defines how to fix every gap found in the audit.

---

## Scope

**In scope:**
- Translate 13 category display names from `constants/categories.ts`
- Translate 5 price tier labels + 5 range labels from `constants/priceTiers.ts`
- Translate 4 transport mode labels from `types/onboarding.ts`
- Fix 16 hardcoded Alert.alert() calls
- Fix 7 hardcoded placeholder props
- Fix 13 hardcoded accessibility labels (excluding "Mingla" brand)
- Fix 1 hardcoded toast in `useMapSettings.ts`

**Non-goals:**
- Modifying the constants files themselves (slugs stay as-is)
- Translating "Mingla" brand name
- Admin dashboard translation

---

## 1. Constants Translation Architecture

### Problem

Category names, price tier labels, and transport mode labels are hardcoded English in constants files. These constants serve two purposes: data identifiers (slug-based, must stay English) AND display labels (user-facing, must be translated). Currently the `name`/`label` field is used for both.

### Solution: Translate at render site, not at source

Keep the constants unchanged. Add translation keys to `common.json` using a slug-based naming convention. At every render site, replace direct `.name`/`.label` access with `t()` calls.

#### Key naming convention:

| Constant Type | Key Pattern | Example |
|---------------|-------------|---------|
| Category names | `category_{slug}` | `category_nature` → "Nature & Views" / "Naturaleza y paisajes" |
| Price tier labels | `tier_{slug}` | `tier_chill` → "Chill" / "Económico" |
| Price tier ranges | `tier_range_{slug}` | `tier_range_chill` → "$50 max" / "Máximo $50" |
| Transport modes | `transport_{value}` | `transport_walking` → "Walking" / "Caminando" |

#### New keys for `en/common.json`:

```json
{
  "category_nature": "Nature & Views",
  "category_first_meet": "First Meet",
  "category_picnic_park": "Picnic Park",
  "category_drink": "Drink",
  "category_casual_eats": "Casual Eats",
  "category_fine_dining": "Fine Dining",
  "category_watch": "Watch",
  "category_live_performance": "Live Performance",
  "category_creative_arts": "Creative & Arts",
  "category_play": "Play",
  "category_wellness": "Wellness",
  "category_flowers": "Flowers",

  "tier_any": "Any",
  "tier_chill": "Chill",
  "tier_comfy": "Comfy",
  "tier_bougie": "Bougie",
  "tier_lavish": "Lavish",
  "tier_range_any": "All prices",
  "tier_range_chill": "$50 max",
  "tier_range_comfy": "$50 – $150",
  "tier_range_bougie": "$150 – $300",
  "tier_range_lavish": "$300+",

  "transport_walking": "Walking",
  "transport_biking": "Biking",
  "transport_transit": "Transit",
  "transport_driving": "Driving"
}
```

#### New keys for `es/common.json`:

```json
{
  "category_nature": "Naturaleza y paisajes",
  "category_first_meet": "Primera cita",
  "category_picnic_park": "Parques para picnic",
  "category_drink": "Bebidas",
  "category_casual_eats": "Comida casual",
  "category_fine_dining": "Alta cocina",
  "category_watch": "Cine",
  "category_live_performance": "Espectáculos en vivo",
  "category_creative_arts": "Arte y cultura",
  "category_play": "Juegos y diversión",
  "category_wellness": "Bienestar",
  "category_flowers": "Flores",

  "tier_any": "Cualquiera",
  "tier_chill": "Económico",
  "tier_comfy": "Cómodo",
  "tier_bougie": "Premium",
  "tier_lavish": "Lujoso",
  "tier_range_any": "Todos los precios",
  "tier_range_chill": "Máximo $50",
  "tier_range_comfy": "$50 – $150",
  "tier_range_bougie": "$150 – $300",
  "tier_range_lavish": "$300+",

  "transport_walking": "Caminando",
  "transport_biking": "En bicicleta",
  "transport_transit": "Transporte público",
  "transport_driving": "En auto"
}
```

#### Render site replacement pattern:

```typescript
// Categories — wherever cat.name is rendered:
// BEFORE: {cat.name}
// AFTER:  {t(`common:category_${cat.slug}`)}

// Price tiers — wherever tier.label or tier.rangeLabel is rendered:
// BEFORE: {tier.label}
// AFTER:  {t(`common:tier_${tier.slug}`)}
// BEFORE: {tier.rangeLabel}
// AFTER:  {t(`common:tier_range_${tier.slug}`)}

// Transport — wherever mode.label is rendered:
// BEFORE: {mode.label}
// AFTER:  {t(`common:transport_${mode.value}`)}
```

#### Files that render these constants (implementor must find and update ALL):

- `OnboardingFlow.tsx` — categories step, budget step, transport step
- `DiscoverScreen.tsx` — category filters
- `PreferencesSections.tsx` — category tiles, mood selectors
- `PreferencesSectionsAdvanced.tsx` — transport display
- `SavedExperiencesPage.tsx` — category filter dropdown
- `SwipeableCards.tsx` — category badge on cards
- `SwipeableBoardCards.tsx` — match factor labels
- `ExpandedCardModal.tsx` — category display
- `BoardPreferencesForm.tsx` — category/budget selectors
- Any other file that renders `cat.name`, `tier.label`, `tier.rangeLabel`, or `mode.label`

---

## 2. Alert.alert() Fixes

16 calls with hardcoded English. For each, add the key to the file's existing namespace JSON and replace with `t()`.

| File | Current Title | Current Body | Namespace | Key prefix |
|------|---------------|-------------|-----------|------------|
| board/BoardDiscussionTab.tsx:245 | "Error" | "Failed to update message" | board | `discussion.error_update` |
| board/BoardDiscussionTab.tsx:274 | "Error" | "Failed to delete message" | board | `discussion.error_delete` |
| board/BoardSettingsDropdown.tsx:102 | "Permission denied" | "Only the session creator..." | board | `settings_dropdown.perm_edit` |
| board/BoardSettingsDropdown.tsx:113 | "Error" | "Session name cannot be empty." | board | `settings_dropdown.error_empty` |
| board/BoardSettingsDropdown.tsx:134 | "Success" | "Session name updated..." | board | `settings_dropdown.success_rename` |
| board/BoardSettingsDropdown.tsx:151 | "Permission denied" | "Only admins can delete..." | board | `settings_dropdown.perm_delete` |
| board/BoardSettingsDropdown.tsx:165 | "Success" | "Session deleted..." | board | `settings_dropdown.success_delete` |
| board/BoardSettingsDropdown.tsx:185 | "Permission denied" | "Only the session creator..." | board | `settings_dropdown.perm_delete_owner` |
| board/InviteParticipantsModal.tsx:234 | "Error" | "Failed to send invites..." | board | `invite.error_send` |
| board/InviteParticipantsModal.tsx:240 | "Error" | "Failed to send invites..." | board | `invite.error_send` (reuse) |
| board/ManageBoardModal.tsx:459 | "Left Board" | "You have successfully left..." | board | `manage.left_board` |
| expandedCard/ActionButtons.tsx:369 | "Error" (hardcoded) | t() body | — | Use `t('common:error')` for title |
| expandedCard/ActionButtons.tsx:506 | "Error" (hardcoded) | t() body | — | Use `t('common:error')` for title |
| expandedCard/ActionButtons.tsx:672 | "Share" | hardcoded body | expanded_details | `action_buttons.share_prompt` |
| AppHandlers.tsx:1054 | "Error" | "You must be logged in..." | common | `error_login_required` |
| ProfilePage.tsx:257 | "Error" | "Failed to upload profile photo." | profile | `page.error_upload_photo` |

---

## 3. Placeholder Fixes

| File | Current | Namespace | Key |
|------|---------|-----------|-----|
| board/BoardDiscussionTab.tsx:779 | "Type @ to mention, # to tag a card..." | board | `discussion.input_placeholder` |
| board/BoardSettingsDropdown.tsx:377 | "Enter session name" | board | `settings_dropdown.name_placeholder` |
| board/InviteParticipantsModal.tsx:292 | "Search friends..." | board | `invite.search_placeholder` |
| onboarding/CountryPickerModal.tsx:170 | "Search countries..." | onboarding | `country_picker.search_placeholder` |
| onboarding/LanguagePickerModal.tsx:142 | "Search languages..." | onboarding | (already exists in onboarding:language.search_placeholder — verify it's used) |
| BoardDiscussion.tsx:633 | "Message..." | board | `discussion.message_placeholder` |
| CollaborationSessions.tsx:590 | "Phone number" | modals | `collaboration.phone_placeholder` |

---

## 4. Accessibility Label Fixes

| File | Current | Namespace | Key |
|------|---------|-----------|-----|
| onboarding/CountryPickerModal.tsx:153 | "Close country picker" | onboarding | `country_picker.close_accessibility` |
| onboarding/LanguagePickerModal.tsx:126 | "Close language picker" | onboarding | `language.close_accessibility` |
| profile/AccountSettings.tsx:484 | "Close account settings" | settings | `close_accessibility` |
| profile/ProfileHeroSection.tsx:218 | "Cancel editing" | profile | `hero.cancel_editing` |
| profile/ProfileHeroSection.tsx:228 | "Save name" | profile | `hero.save_name` |
| profile/ProfileInterestsSection.tsx:89 | "Edit your interests" | profile | `interests.edit_accessibility` |
| profile/ViewFriendProfileScreen.tsx:108 | "Go back" | common | `go_back` (already exists) |
| signIn/WelcomeScreen.tsx:294 | "Dates, hangouts..." | auth | `tagline_accessibility` |
| BetaFeedbackModal.tsx:514 | "Add screenshots from library" | feedback | `modal.add_screenshots_accessibility` |
| FeedbackHistorySheet.tsx:156 | "Delete this feedback" | feedback | `history.delete_accessibility` |
| FeedbackHistorySheet.tsx:310 | "Close screenshot" | feedback | `history.close_screenshot` |
| OnboardingFlow.tsx:2639 | "Change selected location" | onboarding | `manual_location.change_accessibility` |
| VisitBadge.tsx:14 | "Visited" | common | `visited` |

---

## 5. Hook Toast Fix

| File | Current | Fix |
|------|---------|-----|
| hooks/useMapSettings.ts:78 | `toastManager.error("Couldn't update your setting. Try again.", 3000)` | Import `i18n` from `'../i18n'`, use `i18n.t('common:error_update_setting')` |

Add `"error_update_setting": "Couldn't update your setting. Try again."` to common.json.
Spanish: `"error_update_setting": "No se pudo actualizar tu configuración. Inténtalo de nuevo."`

---

## Success Criteria

| SC | Criterion |
|----|-----------|
| SC-1 | Category names render in selected language (verify on categories step, discover filters, saved filters) |
| SC-2 | Price tier labels render in selected language (verify on budget step, card display) |
| SC-3 | Transport mode labels render in selected language (verify on transport step) |
| SC-4 | All 16 Alert.alert calls use t() — grep-verified |
| SC-5 | All 7 placeholder props use t() — grep-verified |
| SC-6 | All 13 accessibility labels use t() — grep-verified (excluding "Mingla" brand) |
| SC-7 | useMapSettings toast uses i18n.t() |
| SC-8 | TypeScript compiles with 0 errors |
| SC-9 | EN/ES key parity maintained across all namespaces |

---

## Implementation Order

1. Update `en/common.json` + `es/common.json` with all new keys (categories, tiers, transport, error_update_setting, error_login_required, visited)
2. Update `en/board.json` + `es/board.json` with new alert/placeholder keys
3. Update `en/onboarding.json` + `es/onboarding.json` with new accessibility/placeholder keys
4. Update `en/profile.json` + `es/profile.json` with new keys
5. Update `en/settings.json` + `es/settings.json` with new key
6. Update `en/auth.json` + `es/auth.json` with new key
7. Update `en/feedback.json` + `es/feedback.json` with new keys
8. Update `en/expanded_details.json` + `es/expanded_details.json` with new key
9. Update `en/modals.json` + `es/modals.json` with new key
10. Replace all render sites for constants (categories, tiers, transport)
11. Replace all 16 Alert.alert calls
12. Replace all 7 placeholders
13. Replace all 13 accessibility labels
14. Fix hooks/useMapSettings.ts toast
15. Verify: `npx tsc --noEmit` + grep checks
