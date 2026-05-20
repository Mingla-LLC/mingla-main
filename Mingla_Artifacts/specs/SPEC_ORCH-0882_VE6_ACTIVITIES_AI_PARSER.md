# SPEC — ORCH-0882 Ve6 Activities AI Parser → Play Experiences

> **Issue:** [#104](https://github.com/Mingla-LLC/mingla-main/issues/104)  
> **Depends on:** ORCH-0881 Ve5 (#103)  
> **Status:** Implementation-ready

---

## 1. Play intent vocabulary (allowlist)

`friends_chill`, `group_activity`, `date_night_active`, `family_friendly`, `solo_exploration`

Enforced in: `playIntentTags.ts`, `geminiActivitiesParser.ts` normalize, `create_experience` on accept.

---

## 2. Edge function `parse-play-activities`

Same contract as `parse-restaurant-menu` except:

- Gate: `venue_category = 'play'`
- Parser: `geminiActivitiesParser.ts`
- `tool_args` includes `capacity_min`, `capacity_max`, `suggested_time_of_day`

**Auth:** Caller JWT only (I-ARI-USER-JWT-ONLY).

---

## 3. Gemini schema (`geminiActivitiesParser.ts`)

```json
{
  "experiences": [{
    "title": "string",
    "narrative": "string",
    "suggested_price_min_cents": 0,
    "suggested_price_max_cents": 0,
    "currency": "GBP",
    "intent_tags": ["friends_chill"],
    "capacity_min": 2,
    "capacity_max": 8,
    "suggested_time_of_day": "Friday evening",
    "confidence": 0.85
  }]
}
```

Max 20. Empty array for non-activities uploads.

---

## 4. Tool `create_experience` (extended)

Allows `venue_category IN ('restaurant', 'play')`.

Play publishes `theme.experience_meta` with:

- `capacity_min`, `capacity_max`, `suggested_time_of_day`
- `ai_source: "activities_snap"`
- Play-filtered `intent_tags`

Restaurant path unchanged (`ai_source: "menu_snap"`).

---

## 5. Mobile

| File | Role |
|------|------|
| `ActivitiesSnapInput.tsx` | Camera / library / PDF for activities list |
| `canGenerateExperiencesFromActivities.ts` | Play gate |
| `experienceGenerationService.ts` | `parsePlayActivities()` |
| `usePendingExperiences.ts` | `parseMode: 'menu' \| 'activities'` |
| `ExperienceConfirmationCard.tsx` | Capacity + time-of-day display |
| `experiences.tsx` | Category router (restaurant / play / creative) |

---

## 6. Regression tests

1. `geminiActivitiesParser.test.ts`
2. `canGenerateExperiencesFromActivities.test.ts`
3. `createExperienceToolContract.test.ts` (play branch)
4. `I-VE6-PARSE-PLAY-USER-JWT-ONLY` strict-grep
5. Ve5 tests unchanged (`test:orch-0881`)

---

## 7. Smoke test

Per GitHub issue #104 steps 1–9.
