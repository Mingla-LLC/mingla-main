# Investigation: Analytics & Notification Architecture Map (ORCH-0390 Dispatch 2)

## Mission

Produce a single authoritative architecture document that maps every analytics event, every notification type, every identity lifecycle touchpoint, and every cross-service integration across Mingla's four external services (Mixpanel, AppsFlyer, RevenueCat, OneSignal). This document becomes the reference the product skill reads to make analytics strategy decisions.

## Context

We have four external services that are supposed to work together:
- **Mixpanel** — behavioral analytics (DEAD: token not configured, all calls are no-ops)
- **AppsFlyer** — attribution & marketing analytics (22 events, never dashboard-verified)
- **RevenueCat** — subscription/revenue management (working, but "customer" count misleading)
- **OneSignal** — push notifications (production-grade, 11 edge functions, 15+ types)

An earlier investigation (INVESTIGATION_ANALYTICS_IDENTITY_AUDIT.md) established that these services operate in silos. This dispatch goes deeper — producing the canonical event maps, identity lifecycle, and notification registry that the earlier audit sketched but didn't fully detail.

## Prior Work

Read these BEFORE starting (they contain partial findings to build on, not duplicate):
- `Mingla_Artifacts/outputs/INVESTIGATION_ANALYTICS_IDENTITY_AUDIT.md` — identity gaps, cross-service integration gaps
- `Mingla_Artifacts/outputs/INVESTIGATION_CODE_INVENTORY.md` — edge function inventory (57 functions), service inventory (79 services), env var registry

## Scope

### IN SCOPE

1. **AppsFlyer Event Map** — every event, every file that fires it, every property sent
2. **Mixpanel Event Map** — every tracking method in mixpanelService.ts, where each is called, what it tracks
3. **OneSignal Notification Type Registry** — every notification type across all 11 notify-* edge functions, with trigger, payload, preference category, deep link
4. **Identity Lifecycle Map** — exact sequence of identity calls on login, logout, app open, background→foreground for ALL 4 services, with file:line references
5. **Cross-Service Event Matrix** — what events exist in which services, gaps where an event fires in one but not the other

### OUT OF SCOPE

- Fixing anything (read-only investigation)
- RevenueCat subscription flow internals (already well-documented in code inventory)
- OneSignal SDK configuration details (already covered in prior audit)
- Edge function internals beyond notification payload structure

## Deliverables

### 1. AppsFlyer Event Map

For EACH event fired via `logAppsFlyerEvent()`:

| Event Name | File:Line | When Fired | Properties Sent | Notes |
|-----------|-----------|-----------|----------------|-------|

Read `app-mobile/src/services/appsFlyerService.ts` for the function signature, then grep the ENTIRE codebase for every call to `logAppsFlyerEvent`. For each call site, record the exact event name, the exact properties object, and the user action that triggers it.

### 2. Mixpanel Event Map

For EACH tracking method in `app-mobile/src/services/mixpanelService.ts`:

| Method Name | Event Name (sent to Mixpanel) | File(s) That Call It | Properties Sent | User Action |
|------------|------------------------------|---------------------|----------------|-------------|

Read mixpanelService.ts to get every method. Then grep for each method name to find all call sites. Record where each is called and what user action triggers it.

Also document:
- `identify()` — when called, what user ID is passed
- `setUserProperties()` — when called, what properties are set
- `reset()` — when called (should be on logout)

### 3. OneSignal Notification Type Registry

For EACH notification type across ALL notify-* edge functions and client-side notification services:

| Type String | Edge Function | Trigger | Title Template | Body Template | Deep Link | Preference Category | Push or In-App Only | Action Buttons |
|------------|--------------|---------|---------------|--------------|-----------|-------------------|-------------------|---------------|

Sources to read:
- Every `supabase/functions/notify-*/index.ts`
- `supabase/functions/_shared/push-utils.ts`
- `supabase/functions/_shared/push-translations.ts`
- `app-mobile/src/services/boardNotificationService.ts`
- `app-mobile/src/components/NotificationsModal.tsx` (for type → icon mapping)

Also document the preference enforcement chain:
- Which types map to which preference key (friend_requests, messages, collaboration_invites, reminders, marketing)
- Quiet hours logic (window, bypass rules)
- Rate limiting rules per type

### 4. Identity Lifecycle Map

Trace the EXACT sequence of identity calls for each scenario:

**Scenario A: Fresh install → first app open**
```
Step 1: [service].init() — file:line
Step 2: [service].anonymous() — file:line
...
```

**Scenario B: App open with persisted session (returning user)**
```
Step 1: ...
```

**Scenario C: OAuth sign-in (Google/Apple)**
```
Step 1: ...
```

**Scenario D: Sign-out**
```
Step 1: ...
```

**Scenario E: Background → foreground (app resume)**
```
Step 1: ...
```

For each scenario, list EVERY identity-related call across ALL 4 services (OneSignal, RevenueCat, AppsFlyer, Mixpanel) with:
- Exact file and line number
- Whether it's fire-and-forget or awaited
- What happens if it fails (error swallowed? retry? crash?)

The key file to read is `app-mobile/app/index.tsx` — that's where most identity calls live. Also check `app-mobile/src/components/AppStateManager.tsx` for sign-out cleanup.

### 5. Cross-Service Event Parity Matrix

Build a matrix showing which user actions are tracked in which services:

| User Action | AppsFlyer Event | Mixpanel Method | OneSignal Notification | RevenueCat |
|------------|----------------|-----------------|----------------------|------------|
| Login | af_login | trackLogin() | — | loginRevenueCat() |
| Sign up | af_complete_registration | trackLogin() | — | configureRevenueCat() |
| Save card | — | — | — | — |
| ... | ... | ... | ... | ... |

Flag gaps: actions tracked in one service but not others.
Flag duplicates: same action tracked multiple times in the same service.

## Constraints

- Read-only. Do not modify any files.
- Read the ACTUAL code, not just comments or function names.
- For Mixpanel: document what WOULD fire if the token were set (the code is wired, just not executing).
- For OneSignal notifications: read the edge function source to get exact title/body templates — don't guess from type names.
- Include server-side push translations from push-translations.ts.

## Output

Save as: `Mingla_Artifacts/outputs/INVESTIGATION_ANALYTICS_NOTIFICATION_ARCHITECTURE.md`

Structure:
```
# Analytics & Notification Architecture (ORCH-0390 Dispatch 2)
> Date: 2026-04-11
> Verified by: Forensic code read

## Summary
- AppsFlyer events: [count]
- Mixpanel tracking methods: [count] (all currently dead)
- OneSignal notification types: [count]
- Identity lifecycle gaps: [count]
- Cross-service parity gaps: [count]

## 1. AppsFlyer Event Map
[table]

## 2. Mixpanel Event Map
[table]

## 3. OneSignal Notification Type Registry
[table]

## 4. Identity Lifecycle Map
[scenarios with exact sequences]

## 5. Cross-Service Event Parity Matrix
[table with gap flags]

## Discrepancies & Gaps
[anything contradicting docs or prior investigations]

## Discoveries for Orchestrator
[side issues found during investigation]
```

## Anti-Patterns

- Do NOT reuse findings from the prior audit without verifying them against current code (dead code was just deleted, things may have shifted)
- Do NOT skip Mixpanel methods because "it's dead anyway" — we need the full map to know what will fire when the token is set
- Do NOT merge OneSignal types from different edge functions — keep the source attribution clear
- Do NOT guess notification payloads from the type name — read the actual title/body strings in the edge function code
