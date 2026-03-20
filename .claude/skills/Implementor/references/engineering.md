# Engineering Reference — Mingla Implementor

Read this file before any backend, service, hook, edge function, migration, or integration
work. This contains patterns and templates too detailed for the main SKILL.md.

---

## Edge Function Template

Every Deno edge function follows this exact shape:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Auth check (when needed):
    const authHeader = req.headers.get('Authorization')!
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // Implementation here
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
```

---

## Google Places API (New)

**Base URL:** `https://places.googleapis.com/v1`
**Auth:** `X-Goog-Api-Key` header — never query param.
**Critical:** Always use `X-Goog-FieldMask`. Use the exact mask from the spec.

### Nearby Search
```typescript
const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': Deno.env.get('GOOGLE_PLACES_API_KEY')!,
    'X-Goog-FieldMask': '[EXACT MASK FROM SPEC]',
  },
  body: JSON.stringify({
    includedTypes: ['restaurant'],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
    rankPreference: 'POPULARITY',
  }),
})
```

**Price Levels:** `PRICE_LEVEL_FREE` | `PRICE_LEVEL_INEXPENSIVE` | `PRICE_LEVEL_MODERATE` |
`PRICE_LEVEL_EXPENSIVE` | `PRICE_LEVEL_VERY_EXPENSIVE`

**Cost Rules:**
- Filter by type + price FIRST, then Distance Matrix — never reverse
- Cache place details in Supabase for 24h minimum (`expires_at` column)
- Batch Distance Matrix: up to 25 origins × 25 destinations per request

---

## Migration File Naming

Timestamp-based: `YYYYMMDDHHMMSS_description.sql`

Use `supabase migration new <description>` if CLI available. Otherwise name manually with
current UTC datetime. Space multiple migrations at least 1 second apart. Always `git pull`
before creating migrations.

---

## Git History Protocol

For every file you plan to modify:

1. `git log --oneline -20 -- <file>` — last 20 commits
2. `git blame` on the specific lines you'll change
3. Look for related commits across files (same commit touching multiple files)
4. Identify: reverts, bug-fix commits, active refactors, direction of travel
5. Flag landmines: reverted commits, fix: commits on your lines, TODO/HACK comments

Present as a narrative in your diagnosis, not a raw log dump.

---

## Diagnosis Protocol (No-Spec Tasks)

When there is no spec (bug fixes, small changes):

1. **Investigate thoroughly.** Read every file in the call chain. Trace full data flow.
2. **Present findings in plain English:**
   - What's happening (symptom)
   - Why it's happening (root cause, explained simply)
   - What else is affected (secondary issues)
   - How you'll fix it (file-by-file plan)
   - What you won't touch (scope boundaries)
3. **Wait for user confirmation.** Do not implement until confirmed.

---

## Sub-Agent Orchestration

Trigger if: 4+ layers, 10+ files to read, or parallel workstreams exist. Max 3 agents.

### Agent Briefing Template
```
AGENT [N] BRIEFING — [Role Name]
======================================

YOUR SCOPE (implement exactly this, nothing else):
- [File 1 to create]: [one-sentence purpose]
- [File 2 to modify]: [exactly what to change]

FILES TO READ FIRST:
- [file path]: [why]

THE CONTRACT (interfaces you must match exactly):
[Paste exact TypeScript types, function signatures, or SQL]

IMPLEMENTATION ORDER:
1. [First]
2. [Second]

SUCCESS CRITERIA:
- [ ] [Specific, verifiable]

DO NOT:
- [Scope boundary]

OUTPUT:
Save all files to [path]. Report: file paths, deviations, test results.
```

After all agents complete, YOU integrate: verify interfaces match, run full tests, fix
integration bugs yourself, write the unified report.

---

## Implementation Report Template

```markdown
# Implementation Report: [Feature Name]
**Date:** [today]
**Spec:** [spec reference or "Diagnosed — confirmed by user"]
**Status:** Complete / Partial

---

## 1. What Was There Before
### Existing Files Modified
| File | Purpose Before | Lines Before |
|------|---------------|-------------|

### Pre-existing Behavior
[Plain description]

### History Context
| File | Key Context | Commits |
|------|------------|---------|

---

## 2. What Changed
### New Files Created
| File | Purpose | Key Exports |
|------|---------|-------------|

### Files Modified
| File | What Changed |
|------|-------------|

### Database Changes
[Exact SQL]

### Edge Functions
| Function | New/Modified | Method | Endpoint |

### State Changes
- React Query keys added: [list]
- React Query keys invalidated: [list]
- Zustand slices modified: [list or "None"]

---

## 3. Spec Compliance
| Spec Section | Requirement | Implemented? | Notes |
|-------------|-------------|-------------|-------|

---

## 4. Implementation Details
### Architecture Decisions
[Decisions not in spec, with reasoning]

### Google Places API Usage (if applicable)
### RLS Policies Applied

---

## 5. Copy Deck (if applicable)
[Organized by screen and state — see copywriting reference]

---

## 6. Data/Analytics Changes (if applicable)
[Events added, pipelines modified, metrics]

---

## 7. Verification Results
### Success Criteria
| # | Criterion | Result | How Verified |

### Test Cases
| # | Test | Input | Expected | Actual | Result |

### Bugs Found During Implementation
| Bug | Root Cause | Fix Applied |

---

## 8. Deviations from Spec
[Every deviation with justification, or "None"]

---

## 9. Known Limitations
[Out-of-scope observations]

---

## 10. Files Inventory
### Created
### Modified

---

## 11. README Update
[Confirmation + what sections changed]

---

## 12. Handoff to Tester
[Explicit invitation: spec is contract, files inventory is checklist, break it]
```

---

## React Query Patterns

- Query keys: structured arrays matching existing patterns in `hooks/`
- staleTime: use spec values, or match adjacent hooks
- Mutations: optimistic updates only where spec calls for them
- Always handle: `isLoading`, `isError`, `data`, `error`
- Invalidation: explicit query key invalidation after mutations

## Zustand Patterns

- Client-only persisted state — never server-derived data
- Read existing store first, add new slices following existing patterns
- AsyncStorage persistence for both React Query cache and Zustand

## Admin Patterns

- React Context (AuthContext, ThemeContext, ToastContext) for shared state
- `mounted` ref flag on all async setState calls
- Direct Supabase client from `mingla-admin/src/lib/supabase.js`
- Tailwind v4 utilities, match existing class patterns
- Skeleton/Spinner for loading, empty-state patterns for empty
- Pagination, search, filter patterns from adjacent pages

## AppsFlyer Event Map

If your implementation modifies ANY of these files, read and update
`outputs/APPSFLYER_EVENT_MAP.md`:
- `appsFlyerService.ts`, `mixpanelService.ts`, `userInteractionService.ts`
- `OnboardingFlow.tsx`, `useOnboardingStateMachine.ts`
- `index.tsx` (auth), `authService.ts`
- `revenueCatService.ts`, `useRevenueCat.ts`, `tierLimits.ts`
- `subscriptionService.ts`, any `subscriptions` migration
- `deepLinkService.ts`, `friendsService.ts`, `pairingService.ts`
- `referral_credits` migration, `process-referral` edge function
- Collaboration services, paywall components
- `notify-lifecycle` edge function
