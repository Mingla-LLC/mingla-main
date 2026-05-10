# Invariant Violations — Classification Guide

When a bug violates an invariant, it's an architecture flaw, not just a bug.
This upgrades severity and demands structural prevention.

---

## How to Check

During investigation Phase 6 (Blast Radius), check each relevant invariant:

1. Read the invariant definition
2. Check if the root cause or any finding violates it
3. If violated: classify as invariant violation in the report
4. Record the INV-ID in the finding

---

## Invariant Quick Reference

### Data Integrity (INV-D01 through INV-D10)

| ID | Rule | Violation Looks Like |
|----|------|---------------------|
| D01 | Every card has a photo | Cards rendering with blank image |
| D02 | Cards have city/country TEXT | NULL city causing filtering failures |
| D03 | Curated refs only active places | Curated card linking to deactivated place |
| D04 | Slugs are canonical everywhere | Display showing `fine_dining` not `Fine Dining` |
| D05 | Exclusions identical gen/serve | Type excluded at generation but shown at serve time |
| D06 | Impressions session-scoped | User seeing same cards after preference change |
| D07 | E.164 phone format | Storage path injection via unsanitized phone |
| D08 | Real data or nothing | `rating ?? 4.0` showing fake rating |
| D09 | Paired saves bidirectional | Paired user can't see partner's saves |
| D10 | Blocked = fully invisible | Blocked user appearing in nearby people |

### State Management (INV-S01 through INV-S08)

| ID | Rule | Violation Looks Like |
|----|------|---------------------|
| S01 | RQ owns server data | Zustand store holding user profile from API |
| S02 | Mutations invalidate correctly | Saved cards list stale after save action |
| S03 | Zustand = client-only | Zustand store containing fetched preferences |
| S04 | AsyncStorage versioned | App crash on cold start after schema change |
| S05 | Sign-out clears all | Previous user's data visible after re-login |
| S06 | Prefs→deck no race | Old deck cards showing after preference change |
| S07 | Key has all params | Same cached data returned for different filters |
| S08 | Optimistic rollback | Card removed from deck but save actually failed |

### Auth & Session (INV-A01 through INV-A05)

| ID | Rule | Violation Looks Like |
|----|------|---------------------|
| A01 | Single auth instance | Two components both managing token refresh |
| A02 | Centralized refresh | Token refreshed in a hook instead of auth manager |
| A03 | 401 → refresh, not logout | User logged out on first 401 instead of retry |
| A04 | Edge functions validate auth | Edge function accessible without token |
| A05 | RLS on all user tables | Table queryable by any authenticated user |

### UI (INV-U01 through INV-U06)

| ID | Rule | Violation Looks Like |
|----|------|---------------------|
| U01 | All states handled | Blank screen during loading or on error |
| U02 | No dead taps | Button that does nothing when pressed |
| U03 | Currency follows locale | USD prices for non-US user |
| U04 | Travel mode respected | Walking time shown for driving user |
| U05 | Display names not slugs | `picnic_park` shown in UI |
| U06 | Icons resolve | Blank icon space for known category |

### Realtime & Notifications (INV-R01 through INV-R05)

| ID | Rule | Violation Looks Like |
|----|------|---------------------|
| R01 | Subscriptions cleanup | Ghost updates after navigating away |
| R02 | Respect preference toggles | Push notification for disabled type |
| R03 | Quiet hours enforced | Notification at 2 AM |
| R04 | Push tokens cleaned | Notifications sent to abandoned device |
| R05 | Deleted content safe | Crash when tapping notification for deleted item |

### Pipeline (INV-P01 through INV-P04)

| ID | Rule | Violation Looks Like |
|----|------|---------------------|
| P01 | No direct Google/OpenAI in serving | Card serving function calling Google Places |
| P02 | AI sole quality gate | SQL WHERE clause excluding card types |
| P03 | Children's venues excluded | School appearing in card results |
| P04 | Per-category exclusions enforced | Grocery store in Flowers category |

---

## Severity Escalation

When an invariant is violated:
- Data integrity (D-series): **minimum S1**, S0 if user-visible
- State management (S-series): **minimum S2**, S1 if causes stale/wrong data
- Auth & security (A-series): **minimum S1**, S0 if data exposure
- UI (U-series): **minimum S2**, S1 if on critical flow
- Realtime (R-series): **minimum S2**
- Pipeline (P-series): **minimum S1**, S0 if wrong content served

---

## In the Report

When a finding violates an invariant, format it as:

```
- **Invariant violated:** INV-S02 (every mutation invalidates correct keys)
- **How violated:** saveMutation in useSaveCard.ts has no onSuccess invalidation
- **Structural fix required:** Add invalidation of savedCardKeys.all in onSuccess
```
