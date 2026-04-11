# SPEC: ORCH-0386 — Deep i18n Gap Fix (Root Cause)

**Date:** 2026-04-11
**Investigation:** INVESTIGATION_ORCH-0386_I18N_DEEP_GAPS_REPORT.md
**Confidence:** HIGH

---

## Layman Summary

A Spanish-speaking user still sees English in three places: intent labels on every card ("Adventurous", "Romantic"), category names from API data on cards, and half-translated modals. The root cause is that utilities and components render English labels from API data or lookup tables instead of going through the translation system. This spec fixes the systemic issue and all 85 remaining strings.

---

## Scope

**In scope:**
- Fix `categoryUtils.ts:getReadableCategoryName()` to use i18n (systemic fix)
- Add intent/experience type translation keys and fix all 5 card render sites
- Fix all API-sourced category renders on 5 card components
- Complete translation of CollaborationSessions.tsx (~15 strings)
- Complete translation of NotificationsModal.tsx (~20 strings)
- Complete translation of PreferencesSheet.tsx parent (~9 strings)
- Fix minor gaps in 3 other components (~5 strings)

**Non-goals:**
- Modifying backend API responses (long-term, separate ORCH item)
- ORCH-0387 (settings language picker) / ORCH-0388 (locale formatting)

---

## 1. Systemic Fix: categoryUtils.ts

### Problem
`getReadableCategoryName()` is a hardcoded English mapping used across multiple components. Any component using it gets English regardless of language setting.

### Fix
Replace the hardcoded map with an i18n-aware version. Since this is a utility (not a component), it can't use `useTranslation()`. Import `i18n` directly:

```typescript
import i18n from '../i18n'

export function getReadableCategoryName(slug: string): string {
  // Try i18n translation first, fall back to formatted slug
  const key = `common:category_${slug.replace(/-/g, '_')}`
  const translated = i18n.t(key)
  // If i18n returns the key itself (no translation found), fall back to formatting
  if (translated === key) {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }
  return translated
}
```

This makes EVERY component that calls `getReadableCategoryName()` automatically get the translated name.

---

## 2. Intent/Experience Type Translation Keys

### New keys for `en/common.json` + `es/common.json`:

```json
EN:
"intent_adventurous": "Adventurous",
"intent_first_date": "First Dates",
"intent_romantic": "Romantic",
"intent_group_fun": "Group Fun",
"intent_picnic_dates": "Picnic Dates",
"intent_take_a_stroll": "Take a Stroll"

ES:
"intent_adventurous": "Aventurero",
"intent_first_date": "Primeras citas",
"intent_romantic": "Romántico",
"intent_group_fun": "Diversión grupal",
"intent_picnic_dates": "Citas de picnic",
"intent_take_a_stroll": "Dar un paseo"
```

### Render site fixes:

| File | Current | Fix |
|------|---------|-----|
| CuratedExperienceSwipeCard.tsx:57 | `card.categoryLabel \|\| 'Adventurous'` | `t(\`common:intent_\${(card.experienceType \|\| 'adventurous').replace(/-/g, '_')}\`)` |
| board/SwipeableSessionCards.tsx:272 | `cardData.categoryLabel \|\| "Adventurous"` | Same pattern using `experienceType` |
| activity/SavedTab.tsx:1689-1728 | Local `EXPERIENCE_LABELS` lookup | Delete `EXPERIENCE_LABELS`, use `t(\`common:intent_\${rawType.replace(/-/g, '_')}\`)` |
| PreferencesSheet.tsx:76-81 | `experienceTypes` array with `label` field | Replace `exp.label` renders with `t(\`common:intent_\${exp.id.replace(/-/g, '_')}\`)` |
| ExpandedCardModal.tsx:1652-1665 | `nightOut.genre`/`nightOut.subGenre` | These are music genre labels, NOT intent types. They come from Ticketmaster API. Leave as-is — translating dynamic event data is out of scope. |

---

## 3. Category from API Data — Fix All Card Renders

At each site where `card.category` (API string) is rendered directly, replace with the i18n-aware category lookup. The `categoryUtils.ts` systemic fix (Section 1) handles most cases. For sites that don't use the utility:

| File | Current | Fix |
|------|---------|-----|
| SwipeableBoardCards.tsx:244 | `{card.category}` | `{t(\`common:category_\${card.category}\`)}` or `{getReadableCategoryName(card.category)}` (now i18n-aware) |
| SwipeableBoardCards.tsx:382 | `{card.category}` | Same |
| board/SwipeableSessionCards.tsx:461 | `{categoryLabel}` from API | Derive from slug, use `t()` |
| activity/ExperienceCard.tsx:422 | `{experience.category}` | `{t(\`common:category_\${experience.category}\`)}` |
| expandedCard/CardInfoSection.tsx:119 | `{formatTag(category)}` | Replace `formatTag()` with `t(\`common:category_\${category}\`)`, fallback to `formatTag()` if key missing |

---

## 4. CollaborationSessions.tsx — Complete Translation

Add these keys to `en/modals.json` + `es/modals.json`:

```json
EN:
"collab.session_limit_title": "Session limit reached",
"collab.session_limit_body": "You've reached the maximum number of active sessions. Upgrade to create more.",
"collab.session_limit_upgrade": "Upgrade",
"collab.name_required_title": "Session name required",
"collab.name_required_body": "Please enter a session name before creating a session.",
"collab.add_collaborator_title": "Add at least one collaborator",
"collab.add_collaborator_body": "For safety, you can only create a collaboration session with at least one other person.",
"collab.thats_you_title": "That's you",
"collab.thats_you_body": "You can't add yourself as a collaborator.",
"collab.already_selected_title": "Already selected",
"collab.already_selected_body": "This person is already added as a collaborator.",
"collab.create_title": "Create New Session",
"collab.session_name_label": "Session Name",
"collab.add_by_phone": "Add by phone number",
"collab.select_collaborators": "Select Collaborators",
"collab.no_friends": "No friends yet",
"collab.invite_hint": "Invite someone by phone number above",
"collab.solo": "Solo"

ES:
"collab.session_limit_title": "Límite de sesiones alcanzado",
"collab.session_limit_body": "Has alcanzado el número máximo de sesiones activas. Mejora tu plan para crear más.",
"collab.session_limit_upgrade": "Mejorar plan",
"collab.name_required_title": "Nombre de sesión requerido",
"collab.name_required_body": "Ingresa un nombre de sesión antes de crear una.",
"collab.add_collaborator_title": "Añade al menos un colaborador",
"collab.add_collaborator_body": "Por seguridad, solo puedes crear una sesión de colaboración con al menos otra persona.",
"collab.thats_you_title": "Ese eres tú",
"collab.thats_you_body": "No puedes añadirte como colaborador.",
"collab.already_selected_title": "Ya seleccionado",
"collab.already_selected_body": "Esta persona ya está añadida como colaborador.",
"collab.create_title": "Crear nueva sesión",
"collab.session_name_label": "Nombre de la sesión",
"collab.add_by_phone": "Añadir por número de teléfono",
"collab.select_collaborators": "Seleccionar colaboradores",
"collab.no_friends": "Sin amigos aún",
"collab.invite_hint": "Invita a alguien por número de teléfono arriba",
"collab.solo": "Solo"
```

Replace all hardcoded Alert.alert calls and Text elements.

---

## 5. NotificationsModal.tsx — Complete Translation

Add to `en/notifications.json` + `es/notifications.json`:

```json
EN:
"filter_all": "All", "filter_social": "Social", "filter_sessions": "Sessions", "filter_messages": "Messages",
"action_accept": "Accept", "action_decline": "Decline", "action_join": "Join", "action_review": "Review", "action_upgrade": "Upgrade",
"time_just_now": "Just now", "time_minutes": "{{count}}m", "time_hours": "{{count}}h", "time_days": "{{count}}d", "time_weeks": "{{count}}w",
"section_today": "Today", "section_yesterday": "Yesterday", "section_this_week": "This Week", "section_earlier": "Earlier"

ES:
"filter_all": "Todas", "filter_social": "Social", "filter_sessions": "Sesiones", "filter_messages": "Mensajes",
"action_accept": "Aceptar", "action_decline": "Rechazar", "action_join": "Unirse", "action_review": "Reseñar", "action_upgrade": "Mejorar",
"time_just_now": "Ahora", "time_minutes": "{{count}}m", "time_hours": "{{count}}h", "time_days": "{{count}}d", "time_weeks": "{{count}}s",
"section_today": "Hoy", "section_yesterday": "Ayer", "section_this_week": "Esta semana", "section_earlier": "Anterior"
```

Replace all hardcoded arrays and string literals.

---

## 6. PreferencesSheet.tsx Parent — Complete Translation

Add to `en/preferences.json` + `es/preferences.json`:

```json
EN:
"sheet.title": "Your Vibe",
"sheet.lock_it_in": "Lock It In",
"sheet.start_over": "Start Over",
"sheet.saving": "Saving...",
"sheet.select_date": "Select Date",
"budget.title": "Budget",
"budget.subtitle": "Select every tier you're open to",
"starting_point.title": "Starting Point",
"starting_point.subtitle": "Where should we start looking?"

ES:
"sheet.title": "Tu vibra",
"sheet.lock_it_in": "Confirmar",
"sheet.start_over": "Empezar de nuevo",
"sheet.saving": "Guardando...",
"sheet.select_date": "Seleccionar fecha",
"budget.title": "Presupuesto",
"budget.subtitle": "Selecciona todos los rangos que te funcionen",
"starting_point.title": "Punto de partida",
"starting_point.subtitle": "¿Desde dónde empezamos a buscar?"
```

---

## 7. Minor Gaps

| File | String | Key | Namespace |
|------|--------|-----|-----------|
| BoardMemberManagementModal.tsx:146 | `' (You)'` | `member.you_suffix` | board |
| AddToBoardModal.tsx:45,139 | `'Unknown'` | `unknown` | common |
| AddToBoardModal.tsx:53 | `'Just now'` | `time_just_now` | common |

---

## Success Criteria

| SC | Criterion |
|----|-----------|
| SC-1 | `categoryUtils.ts:getReadableCategoryName()` uses `i18n.t()` — returns Spanish for Spanish users |
| SC-2 | Intent/experience type badges on curated cards render in Spanish |
| SC-3 | Category tags on ALL card components render in Spanish (not from API English) |
| SC-4 | CollaborationSessions — all alerts, labels, titles render in Spanish |
| SC-5 | NotificationsModal — filter tabs, actions, time formatting, section headers in Spanish |
| SC-6 | PreferencesSheet — title, buttons, section headers in Spanish |
| SC-7 | Minor gaps (You suffix, Unknown, Just now) translated |
| SC-8 | TypeScript compiles with 0 errors |
| SC-9 | EN/ES key parity maintained |

---

## Implementation Order

1. Add intent + minor keys to `common.json` (en+es)
2. Add collaboration keys to `modals.json` (en+es)
3. Add notification keys to `notifications.json` (en+es)
4. Add preferences parent keys to `preferences.json` (en+es)
5. Add board minor keys to `board.json` (en+es)
6. Fix `categoryUtils.ts` — systemic i18n-aware rewrite
7. Fix 5 intent render sites
8. Fix 5 category render sites
9. Fix CollaborationSessions.tsx (~15 replacements)
10. Fix NotificationsModal.tsx (~20 replacements)
11. Fix PreferencesSheet.tsx parent (~9 replacements)
12. Fix 3 minor components
13. Verify: `npx tsc --noEmit` + grep
