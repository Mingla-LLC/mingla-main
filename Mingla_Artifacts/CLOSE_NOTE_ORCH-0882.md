# CLOSE NOTE — ORCH-0882 Ve6 Activities AI Parser

> **Issue:** [#104](https://github.com/Mingla-LLC/mingla-main/issues/104)  
> **Branch:** `feat/ve6-play-activities-parser-issue-104`  
> **Depends on:** ORCH-0881 Ve5 (#103)  
> **Status:** Implementation complete — pending deploy + human smoke

---

## Shipped

### Backend
- `parse-play-activities` edge function (JWT-only, Gemini structured JSON, ≤20 proposals)
- `geminiActivitiesParser.ts` with Play intent allowlist + capacity/time fields
- Extended `create_experience` for `venue_category='play'` (`ai_source: activities_snap`)

### Mobile
- Hub → Experiences category router (Restaurant menu / Play activities / Creative placeholder)
- `ActivitiesSnapInput` (camera / library / PDF)
- Confirmation cards show capacity + time-of-day
- Live experiences list maps Play metadata from `theme.experience_meta`

### Tests / CI
- `npm run test:orch-0882`
- `I-VE6-PARSE-PLAY-USER-JWT-ONLY` strict-grep gate
- Ve5 regression: `npm run test:orch-0881`

---

## Deploy checklist

1. Deploy edge function: `parse-play-activities` (new)
2. Deploy updated `agent-confirm-action` / shared `agentTools` if bundled
3. Confirm `GEMINI_API_KEY_ARI` secret present
4. TestFlight build + issue #104 smoke (verified Play brand)

---

## Human smoke (issue #104)

1. Verified Play brand → Hub → Experiences → "Generate from your activities" CTA
2. Photograph/upload activities list → loading "Reading your activities…"
3. Review cards with Play intent tags, capacity, time-of-day → edit 1, reject 2, accept rest
4. Hub list populated with Play tags
5. SQL: `events` with `event_type='experience'` and `theme->'experience_meta'->'intent_tags'` containing Play values
6. Regression: verified Restaurant brand still uses menu snap only
