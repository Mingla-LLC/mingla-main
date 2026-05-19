# INVESTIGATION — ORCH-0881 Ve5 Menu AI Parser → Restaurant Experiences

> **Issue:** #103  
> **Milestone:** Ve5  
> **Status:** Complete (investigation phase)  
> **Date:** 2026-05-19

---

## 1. Executive summary

Ve5 adds a Hub → Experiences flow for **verified physical Restaurant** brands: photograph/upload a menu, Gemini proposes 8–15 single-intent experiences, operator accepts/edits/rejects via `agent_pending_actions`, accepted rows become `events` with `event_type='experience'`.

**Dependencies satisfied:** M0 (#90 closed), Ve4 (#102 closed), Ve1/Ve3 closed. Tr8 (#98) not required; Ve5 establishes the Hub-side confirmation pattern first.

---

## 2. Schema gap (resolved in SPEC)

| Brief / smoke SQL | Shipped ORCH-0821 schema |
|-----------------|--------------------------|
| `action_type='experience_proposed'` | `tool_name` (e.g. `create_experience`) |
| `related_brand_id` | Missing → **add column** |
| `conversation_id` required | **nullable** for Hub-origin rows |
| Ari chat isolation | **add `source` column** (`ari` \| `hub_experience` \| `hub_trip_day`) |

**Decision:** Extend `agent_pending_actions`; reuse `agent-confirm-action` + new `create_experience` tool executor. No parallel pending table.

---

## 3. Events write path

- **Table:** `public.events` with `event_type='experience'`, `status='live'`, `visibility='public'`.
- **Master date trigger:** `biz_enforce_event_has_master_date` fires only on **UPDATE** into `scheduled`/`live`. Direct **INSERT** with `status='live'` is allowed without `event_dates` (v1 non-recurring experiences).
- **Theme JSONB:** `experience_meta` object: `intent_tags`, `suggested_price_min_cents`, `suggested_price_max_cents`, `currency`, `confidence`, `ai_source: 'menu_snap'`.
- **List query:** Direct `events` table filter (mirror `tripsService.getTripsByBrand`), not `business_management_events_view` (view omits `event_type` today; not required for v1 list).

---

## 4. Gemini integration

- **Model:** `gemini-2.5-flash` (same family as Ari / place-intel).
- **Secret:** `GEMINI_API_KEY_ARI` (isolated quota; no fallback).
- **Mode:** Multimodal `inline_data` (JPEG/PNG/PDF) + `responseMimeType: application/json` + `responseSchema` for structured output.
- **Cap:** ≤20 experiences per snap; ≤10 MB total upload; English menus v1.
- **Privacy:** Process in-memory; no Storage upload; no raw response in production logs.

---

## 5. Security / invariants

| Invariant | Approach |
|-----------|----------|
| I-ARI-USER-JWT-ONLY | `parse-restaurant-menu` uses caller JWT only (no service role) |
| I-ARI-CONFIRM-AUTHORITY | Writes only via `agent-confirm-action` + `create_experience` executor |
| I-1.2-AI-CONFIRMATION-AUTHORITY | Same |
| Verified restaurant gate | Server re-checks `kind=physical`, `venue_category=restaurant`, `claim_status=verified` |

---

## 6. Blast radius

| Area | Impact |
|------|--------|
| Ari chat | Filter `source='ari'` on pending fetch; hub rows invisible |
| Hub → Events | Existing `event_type` defensive filters unchanged |
| Trips / popup | No change |
| CI | New grep gate: no service role in `parse-restaurant-menu` |

---

## 7. Open items → SPEC decisions

All resolved with recommended options:

1. Nullable `conversation_id` + `source` column — **yes**
2. `create_experience` tool — **yes**
3. 24h `expires_at` for hub pending rows — **yes**
4. Sequential bulk accept (N confirm calls) — **yes**
5. `GEMINI_API_KEY_ARI` — **yes**

---

## 8. Regression contracts

1. `event_type='event'` flows unchanged  
2. `event_type='trip'` flows unchanged  
3. Non-restaurant verified venues: no menu CTA  
4. Unverified physical: placeholder copy  
5. Ari: no hub pending rows in chat  

---

*Next: `Mingla_Artifacts/specs/SPEC_ORCH-0881_VE5_MENU_AI_PARSER.md`*
