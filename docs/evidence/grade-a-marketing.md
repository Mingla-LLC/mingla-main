# Grade A evidence — Organizer Marketing (#426 PR7)

**Domain:** Marketing tab (Overview, Audiences, Campaigns, Templates) in mingla-business  
**Routes:** `/(tabs)/marketing/*`  
**Status:** Engineering evidence baseline — device/runtime smoke and `marketing-send` load harness remain operator/follow-up gates.

## Why marketing third

Marketing is on the **100k load profile** burst path (`marketing-send`: 10 sustained / 500 burst RPS) and ties to buyer audiences created by checkout. Organizer blast is a revenue-retention surface; disabled-query loading bugs (ORCH-0889) previously showed false empty states during auth bootstrap.

## Surfaces

| Tab | Route | File | States covered |
|-----|-------|------|----------------|
| Overview | `/marketing` | `app/(tabs)/marketing/index.tsx` | `hasResolved` skeleton, error empty, populated metrics + recent campaigns |
| Audiences | `/marketing/audiences` | `app/(tabs)/marketing/audiences/index.tsx` | Skeleton, error, empty buyers, virtual-row materialize + error toast |
| Campaigns | `/marketing/campaigns` | `app/(tabs)/marketing/campaigns/index.tsx` | Spinner, error, filter empty, populated list + cancel/delete alerts |
| Templates | `/marketing/templates` | `app/(tabs)/marketing/templates/index.tsx` | Starter loading/error, user-template inline error |
| Layout | `/marketing/*` | `app/(tabs)/marketing/_layout.tsx` | `MarketingSubNav`, composer hides universal "+" |

Composer (`/marketing/campaigns/compose`) and campaign report (`/marketing/campaigns/[id]`) are covered by strict-grep + composer regression tests; full composer Grade A is a follow-up wave.

## Regression tests (repo-running)

| Test / guard | What it proves |
|--------------|----------------|
| `marketing/__tests__/MarketingOverview.disabled-query.test.ts` | Overview does not show error during auth-bootstrap (`I-DISABLED-QUERY-IS-LOADING`) |
| `marketing/__tests__/MarketingAudiences.disabled-query.adversarial.test.ts` | Audiences skeleton during disabled query |
| `marketingOverviewService.test.ts` | Overview funnel snapshot mapping |
| `orch-0863-marketing-hub-phase-b.mjs` | Phase B constitution (no currency literal, funnel labels) |
| `orch-0815-b-composer-and-send.mjs` | Composer + `marketing-send` wiring |
| `supabase/functions/marketing-send/index.test.ts` | Send edge function contract |
| `npm run test:orch-432` | PR7 Marketing Grade A contract |

## Load / send path (#426)

| Item | Path / note |
|------|-------------|
| Load profile row | `docs/load-profile.md` — `marketing-send` JWT, future harness |
| Edge function | `supabase/functions/marketing-send/index.ts` |
| Checkout → audiences | Buyers from ticket checkout feed `marketing_audiences` |

k6 script for `marketing-send` is **not yet shipped** (Tier 1 gap — queue/rate-limit burst proof is Tier 2).

## Known gaps (honest)

| Gap | Follow-up |
|-----|-----------|
| No k6 `marketing-send` harness yet | PR after queue semantics locked |
| Composer full state matrix (draft save errors, schedule failures) | Separate composer Grade A ORCH |
| Marketing send API kill switch not wired in `featureFlags.ts` | Workstream F |
| Runtime device proof not attached | Operator smoke on staging |

## Manual smoke gate (operator)

1. Sign in as organizer with a brand that has ticket buyers.
2. Marketing → Overview: skeleton resolves, metrics or empty caption.
3. Marketing → Audiences: list or "No buyers yet"; tap virtual row.
4. Marketing → Campaigns: filter pills, empty vs list, open composer via FAB.
5. Marketing → Templates: starter pack loads; duplicate flow.
6. Attach screenshots to epic #426 when closing Marketing Workstream E box.
