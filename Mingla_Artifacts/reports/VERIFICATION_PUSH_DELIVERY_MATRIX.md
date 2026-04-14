# Verification Report: Push Notification Delivery Matrix

> **Date:** 2026-04-13
> **Method:** Line-by-line code trace of every edge function. Every verdict backed by file:line.
> **Confidence:** HIGH for code paths. CANNOT VERIFY OneSignal env vars or actual device delivery from code alone.

---

## Critical Dependency: OneSignal Env Vars

**File:** `supabase/functions/_shared/push-utils.ts:43-46`

```typescript
if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
  console.warn("[push-utils] OneSignal credentials not configured. Skipping push.");
  return false;
}
```

If `ONESIGNAL_APP_ID` or `ONESIGNAL_REST_API_KEY` are not set as Supabase edge function environment variables, **ALL push notifications silently fail** with only a console.warn. Cannot verify from code whether these are set — this requires checking the Supabase dashboard (Settings → Edge Functions → Secrets) or running a test push.

---

## Complete Push Notification Delivery Matrix

| # | Notification Type | Edge Function | Calls notify-dispatch? | skipPush? | Push Title & Body | Deep Link | Cron? | Verdict |
|---|---|---|---|---|---|---|---|---|
| 1 | **DM message received** | `notify-message/index.ts:43` | YES | NO | Sender name / message preview | `mingla://chat/{conversationId}` | No | **CONFIRMED SENDS PUSH** |
| 2 | **Friend request received** | `send-friend-request-email/index.ts:111` | YES | NO | "{name} wants to be friends" / "Tap to view" | `mingla://connections` | No | **CONFIRMED SENDS PUSH** (also sends email) |
| 3 | **Friend request accepted** | `send-friend-accepted-notification/index.ts:98` | YES | NO | "{name} accepted your friend request" / ... | `mingla://connections` | No | **CONFIRMED SENDS PUSH** |
| 4 | **Pair request received** | `send-pair-request/index.ts:21` | YES | NO | "{name} wants to pair with you" / ... | `mingla://discover` | No | **CONFIRMED SENDS PUSH** |
| 5 | **Pair request accepted** | `send-pair-accepted-notification/index.ts:104` | YES | NO | "{name} accepted your pair request" / ... | `mingla://discover` | No | **CONFIRMED SENDS PUSH** |
| 6 | **Pair request visible** (after friend accept reveals hidden request) | `notify-pair-request-visible/index.ts:87` | YES | NO | "{name} wants to pair" / ... | `mingla://discover` | No | **CONFIRMED SENDS PUSH** |
| 7 | **Collaboration invite** | `send-collaboration-invite/index.ts:168` | YES | NO | "{name} invited you to {session}" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 8 | **Invite accepted** | `notify-invite-response/index.ts:146` | YES | `skipPush: !isAccepted` | "{name} accepted your invite" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH (accepted only)** — declined = DB only, no push |
| 9 | **Invite declined** | `notify-invite-response/index.ts:146` | YES | `skipPush: true` | N/A | N/A | No | **DB ONLY (no push)** — skipPush for declines |
| 10 | **Session match** | `notify-session-match/index.ts:104` | YES | NO | "Match! Everyone likes {card}" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 11 | **Paired user saved card** | `notify-pair-activity/index.ts:128` | YES | NO | "{name} found something for you" / 'They saved "{card}"' | `mingla://discover?paired=true` | No | **CONFIRMED SENDS PUSH** (rate limited: 3/day) |
| 12 | **Paired user visited place** | `notify-pair-activity/index.ts:165` | YES | `skipPush: true` | N/A | N/A | No | **DB ONLY (no push)** — in-app only |
| 13 | **Calendar reminder** | `notify-calendar-reminder/index.ts:22` | YES | NO | "Upcoming: {title}" / ... | `mingla://likes` | Hourly (:15) | **CONFIRMED SENDS PUSH** |
| 14 | **Birthday reminder** | `notify-birthday-reminder/index.ts:66` | YES | NO | Milestone-specific title / ... | `mingla://discover` | Daily 9 AM UTC | **CONFIRMED SENDS PUSH** |
| 15 | **Holiday reminder** | `notify-holiday-reminder/index.ts:27` | YES | NO | "{pair}'s birthday is {timeframe}" / ... | `mingla://discover` | Daily 9 AM UTC | **CONFIRMED SENDS PUSH** |
| 16 | **Lifecycle: re-engagement** | `notify-lifecycle/index.ts:22` | YES | NO | Varies by lifecycle stage | `mingla://discover` | Daily 10 AM UTC | **CONFIRMED SENDS PUSH** |
| 17 | **Lifecycle: weekly digest** | `notify-lifecycle/index.ts:22` | YES | NO | Weekly summary | `mingla://discover` | Daily 10 AM UTC | **CONFIRMED SENDS PUSH** |
| 18 | **Lifecycle: onboarding incomplete** | `notify-lifecycle/index.ts:22` | YES | NO | "Finish setting up" / ... | `mingla://onboarding` | Daily 10 AM UTC | **CONFIRMED SENDS PUSH** |
| 19 | **Referral credited** | `notify-referral-credited/index.ts:43` | YES | NO | "You got a bonus!" / ... | `mingla://profile` | No | **CONFIRMED SENDS PUSH** |
| 20 | **Board: card saved** | `boardNotificationService.ts:62` → `notify-dispatch` | YES | NO | "{user} saved a card" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 21 | **Board: card voted** | `boardNotificationService.ts:62` → `notify-dispatch` | YES | NO | "{user} voted on your card" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 22 | **Board: card RSVP** | `boardNotificationService.ts:62` → `notify-dispatch` | YES | NO | "{user} is down for {card}" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 23 | **Board: member joined** | `boardNotificationService.ts:62` → `notify-dispatch` | YES | NO | "{user} joined the session" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 24 | **Board: member left** | `boardNotificationService.ts:62` → `notify-dispatch` | YES | NO | "{user} left the session" / ... | `mingla://session/{id}` | No | **CONFIRMED SENDS PUSH** |
| 25 | **Board: match** | `boardNotificationService.ts` → `notify-session-match` | YES | NO | Same as #10 | Same as #10 | No | **CONFIRMED SENDS PUSH** |
| — | **Nearby friend on map** | — | — | — | — | — | — | **NEVER BUILT** |
| — | **Someone saved card you shared** | — | — | — | — | — | — | **NEVER BUILT** |

---

## Summary

| Verdict | Count | Types |
|---------|-------|-------|
| **CONFIRMED SENDS PUSH** | 22 | All except declined invites, paired visits, and 2 never-built |
| **DB ONLY (no push)** | 2 | Invite declined (#9), Paired user visited (#12) |
| **NEVER BUILT** | 2 | Nearby friend on map, Shared card saved by someone |
| **BROKEN** | 0 | — |
| **EMAIL ONLY** | 0 | (Friend request sends BOTH email AND push) |

---

## boardNotificationService Auth — NOT Broken

**Concern:** boardNotificationService calls `notify-dispatch` from the mobile app using user JWT, but notify-dispatch "requires service role."

**Finding:** notify-dispatch does NOT actually validate service role. It only checks for the presence of a Bearer token (`notify-dispatch/index.ts:77-79`):

```typescript
const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
}
```

It then creates its OWN admin client with the service role key for DB operations (line 86-88). The incoming auth header is just a gate check, not a service role validation. Mobile-initiated calls with user JWT pass this check.

**Verdict: WORKING.** Board notifications from mobile will successfully call notify-dispatch.

---

## Cron Schedules (Verified in Migrations)

| Cron Job | Function | Schedule | Migration |
|----------|----------|----------|-----------|
| `notify-lifecycle-daily` | `notify-lifecycle` | `0 10 * * *` (10 AM UTC daily) | `20260316000003` |
| `notify-calendar-reminder-hourly` | `notify-calendar-reminder` | `15 * * * *` (minute :15 every hour) | `20260316000003` |
| `notify-holiday-reminder-daily` | `notify-holiday-reminder` | `0 9 * * *` (9 AM UTC daily) | `20260321130000` |
| `notify-birthday-reminder-daily` | `notify-birthday-reminder` | `0 9 * * *` (9 AM UTC daily) | `20260411400001` |

All 4 use the same pattern: `pg_cron` → `pg_net.http_post()` → edge function URL with service role key from vault.

**Note:** Cannot verify from code that the crons are actually ACTIVE in the running Supabase instance. The migrations create them, but they could have been disabled or the instance might not have pg_cron enabled. Would need to check: `SELECT * FROM cron.job;` in the Supabase SQL editor.

---

## skipPush Usage (Complete)

Only 2 callers in the entire codebase use `skipPush`:

| Caller | File:Line | Value | Effect |
|--------|-----------|-------|--------|
| `notify-invite-response` | `:176` | `skipPush: !isAccepted` | Push for accepted, DB-only for declined |
| `notify-pair-activity` | `:175` | `skipPush: true` | Paired user VISITS are in-app only (card saves DO send push) |

No mobile-side code uses `skipPush`.

---

## Previous Investigation Corrections

| Claim | Actual |
|-------|--------|
| "Friend request received: PARTIAL — push not confirmed, email yes" | **WRONG.** `send-friend-request-email` calls notify-dispatch at line 111. Sends BOTH email AND push. |
| "Pair request received: needs verification" | **CONFIRMED.** `send-pair-request` calls notify-dispatch at line 21. Sends push. |
| "boardNotificationService might fail with 401" | **WRONG.** notify-dispatch only checks for Bearer prefix, not service role. Mobile calls work. |

---

## What Cannot Be Verified From Code

1. **OneSignal env vars set in Supabase?** — `ONESIGNAL_APP_ID` + `ONESIGNAL_REST_API_KEY` must be configured. If missing, ALL push silently fails. Check: Supabase Dashboard → Settings → Edge Functions → Secrets.
2. **Crons actually active?** — Migrations create them, but need `SELECT * FROM cron.job;` to confirm.
3. **OneSignal player registration working?** — Need to check OneSignal dashboard for registered devices with external_id matching the user's Supabase UUID.
4. **Push actually delivered to devices?** — Need OneSignal dashboard delivery reports or a manual test.

**Recommended verification:** Send yourself a test notification via the OneSignal dashboard targeting your external_id. If it arrives, the pipeline is working end-to-end. If not, check env vars and device registration.
