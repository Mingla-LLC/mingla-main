# SPEC — ORCH-0881 Ve5 Menu AI Parser → Restaurant Experiences

> **Issue:** #103  
> **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0881_VE5_MENU_AI_PARSER.md`  
> **Status:** Implementation-ready

---

## 1. Migration `20260623000000_orch_0881_ve5_hub_pending_actions.sql`

```sql
ALTER TABLE public.agent_pending_actions
  ALTER COLUMN conversation_id DROP NOT NULL;

ALTER TABLE public.agent_pending_actions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ari'
    CHECK (source IN ('ari', 'hub_experience', 'hub_trip_day')),
  ADD COLUMN IF NOT EXISTS related_brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS related_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_pending_hub_experience
  ON public.agent_pending_actions (related_brand_id, status, expires_at)
  WHERE source = 'hub_experience';
```

Ari rows: `source='ari'`, `conversation_id` set. Hub rows: `source='hub_experience'`, `conversation_id` null, `related_brand_id` set, `expires_at = now() + interval '24 hours'`.

---

## 2. Edge function `parse-restaurant-menu`

**Auth:** Caller JWT via `SUPABASE_ANON_KEY` (same as `agent-confirm-action`).

**POST body:**

```typescript
{
  brand_id: string; // uuid
  files: Array<{
    mime_type: "image/jpeg" | "image/png" | "application/pdf";
    data_base64: string;
  }>; // 1–5 files, total decoded size ≤ 10_485_760 bytes
}
```

**Gates:** brand owned by user; `kind='physical'`; `venue_category='restaurant'`; `claim_status='verified'`.

**Response (200):**

```typescript
{
  kind: "ok";
  pending_actions: Array<{
    id: string;
    tool_name: "create_experience";
    tool_args: CreateExperienceArgs;
  }>;
  experiences_count: number;
}
```

**Errors:** `401`, `403`, `400` (file_too_large, invalid_mime, brand_not_eligible), `422` (parse_failed), `429` (rate_limit).

**Side effects:** INSERT N `agent_pending_actions` rows (`source='hub_experience'`, `tool_name='create_experience'`, `status='pending'`, 24h expiry). No Storage writes.

---

## 3. Gemini schema (`geminiMenuParser.ts`)

**Output JSON:**

```json
{
  "experiences": [
    {
      "title": "string",
      "narrative": "string",
      "suggested_price_min_cents": 0,
      "suggested_price_max_cents": 0,
      "currency": "GBP",
      "intent_tags": ["brunch", "date-night"],
      "confidence": 0.85
    }
  ]
}
```

Max 20 items. Empty array allowed (non-menu image).

---

## 4. Tool `create_experience`

**Args:**

```typescript
{
  brand_id: string;
  title: string;
  narrative: string;
  suggested_price_min_cents?: number;
  suggested_price_max_cents?: number;
  currency?: string; // default brand default_currency or GBP
  intent_tags?: string[];
  confidence?: number;
}
```

**Executor writes:**

```typescript
{
  brand_id, created_by: userId,
  title, description: narrative,
  slug: deriveSlug(title),
  event_type: 'experience',
  status: 'live',
  visibility: 'public',
  timezone: 'UTC',
  theme: { experience_meta: { ... } }
}
```

---

## 5. Mobile surfaces

| File | Role |
|------|------|
| `MenuSnapInput.tsx` | Camera + library + PDF picker |
| `ExperienceConfirmationCard.tsx` | Accept / edit / reject |
| `ExperienceReviewCards.tsx` | List + bulk accept |
| `experienceGenerationService.ts` | parse + confirm/cancel |
| `experiencesService.ts` | list live experiences |
| `usePendingExperiences.ts` | pending query + mutations |
| `useExperiencesByBrand.ts` | live list query |
| `hub/experiences.tsx` | Full route |

**Gating helper:** `canGenerateExperiencesFromMenu(brand)`.

---

## 6. Regression tests

1. `geminiMenuParser.test.ts` — schema normalization, cap at 20  
2. `ve5MigrationContract.test.ts` — migration SQL assertions  
3. `canGenerateExperiencesFromMenu.test.ts` — gate matrix  
4. `experiencesService.test.ts` — query uses `event_type=experience`  
5. CI grep: `i-ve5-parse-menu-user-jwt-only.mjs`

---

## 7. Smoke test

Per GitHub issue #103 steps 1–11.
