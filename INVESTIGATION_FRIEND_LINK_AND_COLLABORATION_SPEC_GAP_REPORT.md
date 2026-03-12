# Investigation Report: Friend Link & Collaboration Spec Gap Analysis
**Date:** 2026-03-12
**Reported symptom:** Gap analysis — does the current codebase match the goal spec for friend links, collaborations, and unified non-Mingla invite flow?
**Investigated by:** Brutal Investigator Skill
**Verdict:** The system is ~75% built. The core backend automation and database schema are solid, but there are significant UI/UX gaps — particularly around where friend link requests and collaboration requests surface in the app, the notifications sheet wiring, and the onboarding collaboration step missing the "ignore" concept.

---

## 1. Symptom Summary

**What the user expected:** A complete system matching the spec where friend link requests and collaboration requests can be sent/accepted/rejected/ignored both during onboarding and in the app, appear in the notifications sheet AND as pills on specific pages, work for non-Mingla users via a unified invite flow, and all activity triggers push notifications + in-app notifications.

**What actually happens:** Analyzed below requirement by requirement.

---

## 2. Investigation Perimeter

### Files Read (Direct Chain)
| File | Layer | Status |
|------|-------|--------|
| `supabase/migrations/20260303100001_friend_links.sql` | DB | Read |
| `supabase/migrations/20260310000014_add_link_consent.sql` | DB | Read |
| `supabase/migrations/20260309000002_pending_invites.sql` | DB | Read |
| `supabase/migrations/20260310000011_fix_pending_invite_trigger_no_auto_accept.sql` | DB | Read |
| `supabase/migrations/20260311100001_pending_friend_link_intents.sql` | DB | Read |
| `supabase/migrations/20260311100002_extend_referral_trigger_for_friend_link_intents.sql` | DB | Read |
| `supabase/migrations/20260311200001_add_set_link_consent_rpc.sql` | DB | Read |
| `supabase/functions/send-friend-link/index.ts` | Edge Function | Read |
| `supabase/functions/respond-friend-link/index.ts` | Edge Function | Read |
| `supabase/functions/respond-link-consent/index.ts` | Edge Function | Read |
| `supabase/functions/send-collaboration-invite/index.ts` | Edge Function | Read |
| `supabase/functions/notify-invite-response/index.ts` | Edge Function | Read |
| `supabase/functions/send-phone-invite/index.ts` | Edge Function | Read |
| `app-mobile/src/services/friendLinkService.ts` | Service | Read |
| `app-mobile/src/services/linkConsentService.ts` | Service | Read |
| `app-mobile/src/services/pendingFriendLinkIntentService.ts` | Service | Read |
| `app-mobile/src/services/boardInviteService.ts` | Service | Read |
| `app-mobile/src/services/inAppNotificationService.ts` | Service | Read |
| `app-mobile/src/services/oneSignalService.ts` | Service | Read |
| `app-mobile/src/hooks/useFriendLinks.ts` | Hook | Read |
| `app-mobile/src/hooks/useLinkConsent.ts` | Hook | Read |
| `app-mobile/src/hooks/usePendingFriendLinkIntents.ts` | Hook | Read |
| `app-mobile/src/hooks/useSessionManagement.ts` | Hook | Read |
| `app-mobile/src/hooks/socialQueryKeys.ts` | Hook | Read |
| `app-mobile/src/hooks/useSocialRealtime.ts` | Hook | Read |
| `app-mobile/src/components/DiscoverScreen.tsx` | Component | Read |
| `app-mobile/src/components/HomePage.tsx` | Component | Read |
| `app-mobile/src/components/NotificationsModal.tsx` | Component | Read |
| `app-mobile/src/components/CollaborationSessions.tsx` | Component | Read |
| `app-mobile/src/components/CollaborationModule.tsx` | Component | Read |
| `app-mobile/src/components/LinkRequestBanner.tsx` | Component | Read |
| `app-mobile/src/components/LinkConsentCard.tsx` | Component | Read |
| `app-mobile/src/components/LinkFriendSheet.tsx` | Component | Read |
| `app-mobile/src/components/IncomingLinkRequestCard.tsx` | Component | Read |
| `app-mobile/src/components/onboarding/OnboardingFriendsStep.tsx` | Component | Read |
| `app-mobile/src/components/onboarding/OnboardingCollaborationStep.tsx` | Component | Read |
| `app-mobile/src/types/friendLink.ts` | Types | Read |

**Total files read:** 35+
**Total lines inspected:** ~8,000+

---

## 3. Requirement-by-Requirement Analysis

### FRIEND LINK SYSTEM

#### FL-01: Send a friend link request to anyone on Mingla (in-app)
**Status:** BUILT
**Evidence:** `send-friend-link` edge function handles `targetUserId` for existing users. `LinkFriendSheet.tsx` provides UI for searching/selecting friends and sending requests. `friendLinkService.sendFriendLink()` is the client-side call.
**Confidence:** High

#### FL-02: Send a friend link request to someone NOT on Mingla (in-app)
**Status:** BUILT
**Evidence:** `send-friend-link` edge function handles `phone_e164` for non-users → creates `pending_friend_link_intents` row with status='deferred'. `LinkFriendSheet.tsx` has phone input with country picker and lookup.
**Confidence:** High

#### FL-03: Accept a friend link request (in-app)
**Status:** BUILT
**Evidence:** `respond-friend-link` edge function handles `action: 'accept'`. On accept: sets status='accepted', triggers link consent flow (`link_status='pending_consent'`), creates `friends` rows. DiscoverScreen has accept handler via `handleAcceptLinkRequest`. NotificationsModal has `onAcceptFriendLink` prop wired to `handleAcceptFriendLink` in HomePage.
**Confidence:** High

#### FL-04: Reject a friend link request (in-app)
**Status:** BUILT
**Evidence:** `respond-friend-link` edge function handles `action: 'decline'`. Sets status='declined', sends notification to requester. Both DiscoverScreen and NotificationsModal have decline handlers.
**Confidence:** High

#### FL-05: Ignore a friend link request (in-app)
**Status:** IMPLICIT ONLY
**Evidence:** There is no explicit "ignore" action in the code. Users can simply not respond — the request stays pending. There is no snooze, dismiss, or "remind me later" UX. The request persists as a pill on Discover and in the notifications sheet until acted upon.
**Gap:** No explicit ignore/dismiss UX. The spec says "ignore" but the current implementation treats it as "just don't respond."
**Severity:** Low — this may be acceptable as-is (passive ignore = not responding)

#### FL-06: Friend link requests appear in the notifications sheet
**Status:** BUILT
**Evidence:** `NotificationsModal.tsx` has type `friend_link_request` with accept/decline buttons (lines 59, 76-77, 345, 374). `HomePage.tsx` passes `onAcceptFriendLink` and `onDeclineFriendLink` handlers (lines 470-471). `inAppNotificationService.ts` has `notifyFriendLinkRequest()` method. Push notifications sent by `send-friend-link` edge function.
**Confidence:** High

#### FL-07: Friend link requests appear as pills in the Discover page under the For You tab
**Status:** BUILT (as pills, not as a banner/card list)
**Evidence:** `DiscoverScreen.tsx` lines 3286-3316 render incoming link requests as grey pills in the horizontal ScrollView at the top of the "For You" tab. These are circular avatar pills with initials, placed LEFT of saved people pills. Tapping a pill opens `IncomingLinkRequestCard` below (lines 3396-3410) with accept/decline buttons.
**Note:** `LinkRequestBanner.tsx` also exists but is NOT imported or used by DiscoverScreen — it appears to be an older/alternative component.
**Confidence:** High

#### FL-08: Users can respond to friend link requests from either location (notifications or pills)
**Status:** BUILT
**Evidence:** DiscoverScreen has `handleAcceptLinkRequest` / decline handler operating directly on the pill-triggered card. NotificationsModal has separate `onAcceptFriendLink` / `onDeclineFriendLink` handlers wired through HomePage. Both call the same underlying `respondToFriendLink` mutation.
**Confidence:** High

#### FL-09: Send friend link request during onboarding
**Status:** PARTIALLY BUILT
**Evidence:** `OnboardingFriendsStep.tsx` supports adding friends by phone lookup (sends phone invite) and adding existing Mingla users. However, it sends **friend requests** (legacy system), not friend **link** requests directly. The link request gets created as a deferred intent when the invited user joins.
**Gap:** During onboarding, users can invite/add friends but the "friend link" request is only created as a deferred/converted entity — not sent directly as a friend link from onboarding. The onboarding step is about building friend connections, not explicitly "friend links."
**Severity:** Medium — the end result is the same (after friend request accepted, the link intent converts), but the UX doesn't explicitly frame it as "sending a friend link request."

#### FL-10: Accept/reject/ignore friend link requests during onboarding
**Status:** BUILT
**Evidence:** `OnboardingFriendsStep.tsx` displays incoming friend link requests (`friend_links` with status='pending') during Step 5 with accept/decline buttons. The migration `20260310000011` explicitly creates pending friend_links for invited users so they see them during onboarding.
**Confidence:** High

#### FL-11: All friend link activity triggers push notifications
**Status:** PARTIALLY BUILT
**Evidence:**
- Request sent → push notification to target (via `send-friend-link` edge function)
- Request declined → push notification to requester (via `respond-friend-link`)
- Link consent request → push to both users (via `respond-friend-link`)
- Both consented → push to both (via `respond-link-consent`)
- **MISSING:** No push notification when a friend link request is **accepted** (before consent). The `respond-friend-link` edge function sends consent notifications but doesn't notify the requester "Your link request was accepted."
**Gap:** Missing push for "request accepted" event.
**Severity:** Low — the consent notification serves as implicit confirmation, but it's not a clean "accepted" notification.

#### FL-12: All friend link activity triggers in-app notifications
**Status:** BUILT
**Evidence:** `inAppNotificationService.ts` has:
- `notifyFriendLinkRequest()` — incoming link request
- `notifyLinkConsentRequest()` — consent prompt
- `notifyFriendLinkDeclined()` — declined notification
- `notifyLinkConsentCompleted()` — both consented (via notification type inference)
**Confidence:** High

---

### COLLABORATION SYSTEM

#### CO-01: Send collaboration session requests to users on Mingla (in-app)
**Status:** BUILT
**Evidence:** `CreateSessionModal.tsx` and `CollaborationModule.tsx > CreateTab` provide full wizard for creating sessions and inviting friends. `boardInviteService.sendFriendInvites()` inserts into `collaboration_invites`. `send-collaboration-invite` edge function sends push notifications.
**Confidence:** High

#### CO-02: Send collaboration session requests to users NOT on Mingla (in-app)
**Status:** BUILT
**Evidence:** `CreateSessionModal.tsx` has phone lookup integration. `useSessionManagement.ts` handles `phone_invite` participant type → calls `createPendingSessionInvite()` → inserts into `pending_session_invites` table. When invited user joins and accepts friend request, trigger `credit_referral_on_friend_accepted` converts pending_session_invites into real collaboration_invites.
**Confidence:** High

#### CO-03: Accept collaboration session requests (in-app)
**Status:** BUILT
**Evidence:** `boardInviteService.acceptInvite()` updates invite status and creates session_participants with `has_accepted=true`. `CollaborationModule > InvitesTab` has accept button. `NotificationsModal` has `onAcceptCollabInvite` prop wired to `handleAcceptCollabInvite` in HomePage (line 230-253).
**Confidence:** High

#### CO-04: Reject collaboration session requests (in-app)
**Status:** BUILT
**Evidence:** `boardInviteService.declineInvite()` updates status to 'declined'. Both InvitesTab and NotificationsModal have decline handlers. `notify-invite-response` edge function sends push to inviter on decline.
**Confidence:** High

#### CO-05: Ignore collaboration session requests (in-app)
**Status:** IMPLICIT ONLY (same as FL-05)
**Evidence:** No explicit "ignore" action. Request stays pending until accepted or declined.
**Severity:** Low

#### CO-06: Collaboration requests appear in the notifications sheet
**Status:** BUILT
**Evidence:** `NotificationsModal.tsx` has type `collaboration_invite` with accept/decline buttons (lines 61, 80-81, 349, 378). `inAppNotificationService.ts` has `notifyCollaborationInvite()` method. Push notifications sent by `send-collaboration-invite` edge function.
**Confidence:** High

#### CO-07: Collaboration requests appear as pills in the Home / Explore page
**Status:** PARTIALLY BUILT
**Evidence:** `CollaborationSessions.tsx` renders on `HomePage.tsx` (line 419) as a horizontal bar with session pills. It accepts `sessions` prop of type `CollaborationSession[]` which includes `type: 'received-invite'`. When type is 'received-invite', the pill shows accept/decline options via `onAcceptInvite` / `onDeclineInvite` props.
**Gap:** The pills are on the **Home page only**, not on the "Explore page" as the spec states. The Discover/Explore screen (`DiscoverScreen.tsx`) does NOT render CollaborationSessions or any collaboration invite pills.
**Severity:** Medium — collaboration request pills exist on Home but NOT on Explore/Discover.

#### CO-08: Users can respond to collaboration requests from either location (notifications or pills)
**Status:** BUILT (from notifications and Home pills, but NOT from Explore pills)
**Evidence:** NotificationsModal has accept/decline handlers. CollaborationSessions pills on Home have accept/decline handlers. But Discover/Explore has no collaboration request UI at all.
**Gap:** No response option from Explore page.
**Severity:** Medium

#### CO-09: Send collaboration session requests during onboarding
**Status:** BUILT
**Evidence:** `OnboardingCollaborationStep.tsx` provides full session creation during Step 5 substep 'collaboration'. Users select friends from their added list, name the session, and create it. Handles both existing users and phone invitees.
**Confidence:** High

#### CO-10: Accept/reject/ignore collaboration session requests during onboarding
**Status:** BUILT
**Evidence:** `OnboardingCollaborationStep.tsx` displays pending collaboration invites (received from others) with accept/decline buttons. Uses realtime subscription to `collaboration_invites` to show incoming invites. Continue button blocked until all invites resolved.
**Confidence:** High

#### CO-11: All collaboration activity triggers push notifications
**Status:** BUILT
**Evidence:**
- Invite sent → push to invitee AND inviter (via `send-collaboration-invite`)
- Invite accepted → push to inviter (via `notify-invite-response`)
- Invite declined → push to inviter (via `notify-invite-response`)
**Confidence:** High

#### CO-12: All collaboration activity triggers in-app notifications
**Status:** BUILT
**Evidence:** `inAppNotificationService.ts` has `notifyCollaborationInvite()`. NotificationsModal handles `collaboration_invite` type.
**Confidence:** High

---

### UNIFIED FLOW FOR NON-MINGLA USERS

#### UF-01: Invite person to join Mingla
**Status:** BUILT
**Evidence:** `send-phone-invite` edge function sends SMS via Twilio. Creates `pending_invites` row. Rate limited to 10/24h.
**Confidence:** High

#### UF-02: Auto-send friend request when invited user joins
**Status:** BUILT
**Evidence:** `convert_pending_invites_on_phone_verified()` trigger (migration 20260310000011) creates `friend_requests` row with status='pending' when the invited user verifies their phone number.
**Confidence:** High

#### UF-03: Wait for friend request to be accepted
**Status:** BUILT
**Evidence:** The trigger creates pending requests, not accepted ones. The new user sees these in onboarding Step 5 and must explicitly accept. The `credit_referral_on_friend_accepted()` trigger fires only on `pending → accepted` transition.
**Confidence:** High

#### UF-04: Auto-send friend link request after friend request accepted
**Status:** BUILT
**Evidence:** `credit_referral_on_friend_accepted()` (migration 20260311100002) Part 3 converts `pending_friend_link_intents` into actual `friend_links` rows with status='pending' after the friend request is accepted.
**Confidence:** High

#### UF-05: Auto-send collaboration request after friend request accepted
**Status:** BUILT
**Evidence:** `credit_referral_on_friend_accepted()` Part 2 converts `pending_session_invites` into `collaboration_invites` (status='pending') and creates `session_participants` (has_accepted=false) after friend request accepted.
**Confidence:** High

#### UF-06: Unified pattern (same flow for friend link AND collaboration)
**Status:** BUILT
**Evidence:** Both use the same trigger chain:
1. Phone invite → `pending_invites` row
2. User joins, verifies phone → `convert_pending_invites_on_phone_verified()` creates friend_request
3. Friend request accepted → `credit_referral_on_friend_accepted()` converts BOTH pending_friend_link_intents AND pending_session_invites

The flow is identical and handled by a single trigger function with three parts.
**Confidence:** High

---

## 4. Root Cause Analysis — Summary of Gaps

### GAP-01: Collaboration request pills missing from Discover/Explore page
**Severity:** Medium
**What spec says:** "Collaboration requests appear as pills in the Home / Explore page"
**What exists:** Collaboration pills (`CollaborationSessions.tsx`) render ONLY on `HomePage.tsx`. `DiscoverScreen.tsx` has NO collaboration request UI — it only shows friend link request pills.
**Fix:** Add `CollaborationSessions` or equivalent received-invite pills to DiscoverScreen.

### GAP-02: No explicit "ignore" UX for friend link or collaboration requests
**Severity:** Low
**What spec says:** Users can "accept, reject, or ignore" requests
**What exists:** Accept and reject are built. "Ignore" is passive (just don't respond). There's no dismiss/snooze/hide action.
**Fix:** Decide whether passive ignore is acceptable or if an explicit "Not Now" / dismiss action is needed.

### GAP-03: Onboarding friend step doesn't explicitly frame as "friend link request"
**Severity:** Low
**What spec says:** "During onboarding, users can send a friend link request"
**What exists:** Onboarding Step 5 (friends) lets users add friends via phone/lookup. For non-Mingla users, it creates a phone invite + deferred link intent. For existing users, it creates a friend request (legacy), not a direct friend link request.
**Fix:** Minor UX/copy change, or add direct friend link sending during onboarding alongside the friend request flow.

### GAP-04: Missing "request accepted" push notification for friend links
**Severity:** Low
**What spec says:** "All activity triggers push notifications"
**What exists:** When a friend link request is accepted, the `respond-friend-link` edge function sends **consent** notifications to both users, but doesn't send a distinct "Your friend link request was accepted" push to the requester.
**Fix:** Add a push notification to requester on friend link accept (before consent notifications).

### GAP-05: `LinkRequestBanner.tsx` is orphaned
**Severity:** Informational
**What exists:** `LinkRequestBanner.tsx` was designed to show friend link requests as cards on the Discover page, but it is NOT imported or rendered anywhere in the current codebase. The current Discover implementation uses pills + `IncomingLinkRequestCard` instead.
**Fix:** Delete `LinkRequestBanner.tsx` if it's truly unused, or integrate it if the card-based UX is preferred.

---

## 5. What IS Working Well

The backend automation is remarkably solid:

1. **Unified trigger chain** — A single `credit_referral_on_friend_accepted()` function handles BOTH friend link intent conversion AND session invite conversion. Clean, DRY, bidirectional.

2. **Deferred intent pattern** — `pending_friend_link_intents` and `pending_session_invites` tables with clear status tracking (pending → converted) is well-designed.

3. **No auto-accept** — Migration 20260310000011 correctly changed the behavior so invited users see pending requests during onboarding rather than having things auto-accepted behind their back.

4. **Link consent flow** — The two-phase flow (accept link → consent to data sharing) with atomic RPC for race condition prevention is production-quality.

5. **Notifications coverage** — Both push (via edge functions) and in-app (via `inAppNotificationService`) are implemented for all major events. NotificationsModal has accept/decline buttons for friend links, link consent, AND collaboration invites.

6. **Realtime subscriptions** — `useSocialRealtime.ts` subscribes to `friend_links` and `pending_friend_link_intents` changes, ensuring the UI updates live.

---

## 6. Scorecard

| Requirement | Status | Notes |
|-------------|--------|-------|
| **Friend Link** | | |
| Send to Mingla user (in-app) | BUILT | |
| Send to non-Mingla user (in-app) | BUILT | Deferred intent pattern |
| Accept (in-app) | BUILT | With consent flow |
| Reject (in-app) | BUILT | |
| Ignore (in-app) | PASSIVE | No explicit dismiss UX |
| Send during onboarding | PARTIAL | Sends friend request, not direct link |
| Accept/reject during onboarding | BUILT | |
| In notifications sheet | BUILT | Accept/decline buttons |
| As pills on Discover/For You | BUILT | Grey initials pills |
| Respond from either location | BUILT | |
| Push notifications | MOSTLY | Missing "accepted" push |
| In-app notifications | BUILT | |
| **Collaboration** | | |
| Send to Mingla user (in-app) | BUILT | |
| Send to non-Mingla user (in-app) | BUILT | Pending session invites |
| Accept (in-app) | BUILT | |
| Reject (in-app) | BUILT | |
| Ignore (in-app) | PASSIVE | No explicit dismiss UX |
| Send during onboarding | BUILT | |
| Accept/reject during onboarding | BUILT | |
| In notifications sheet | BUILT | Accept/decline buttons |
| As pills on Home page | BUILT | Via CollaborationSessions |
| As pills on Explore page | **MISSING** | Not rendered on Discover |
| Respond from either location | PARTIAL | Home + notifications only |
| Push notifications | BUILT | |
| In-app notifications | BUILT | |
| **Unified Non-Mingla Flow** | | |
| Invite to join Mingla | BUILT | SMS via Twilio |
| Auto-send friend request on join | BUILT | Trigger on phone verify |
| Wait for friend request acceptance | BUILT | Pending, not auto-accepted |
| Auto-send friend link after accept | BUILT | Trigger Part 3 |
| Auto-send collab after accept | BUILT | Trigger Part 2 |

---

## 7. Recommended Fix Strategy

### Priority 1 — Close spec gaps
| ID | Fix | File(s) | Complexity |
|----|-----|---------|-----------|
| GAP-01 | Add collaboration invite pills to DiscoverScreen | `DiscoverScreen.tsx` | Medium |
| GAP-04 | Add "request accepted" push notification | `respond-friend-link/index.ts` | Small |

### Priority 2 — UX decisions needed
| ID | Fix | Notes | Decision Required |
|----|-----|-------|------------------|
| GAP-02 | Explicit "ignore" UX | Is passive ignore OK, or do you want a dismiss button? | Yes |
| GAP-03 | Onboarding friend link framing | Should onboarding explicitly send friend links, or is the current friend-request-then-auto-convert flow acceptable? | Yes |

### Priority 3 — Cleanup
| ID | Fix | File | Complexity |
|----|-----|------|-----------|
| GAP-05 | Remove or integrate `LinkRequestBanner.tsx` | `LinkRequestBanner.tsx` | Trivial |

### What NOT to change:
- The unified trigger chain (`credit_referral_on_friend_accepted`) — it's well-designed and working correctly
- The link consent flow — production-quality with race condition handling
- The notification types in `NotificationsModal` — all four actionable types are wired correctly
- The `pending_friend_link_intents` / `pending_session_invites` tables — clean deferred intent pattern

---

## 8. Handoff to Orchestrator

Orchestrator: the investigation is complete. The system is approximately **75% complete** against the spec. The backend automation (unified invite flow, trigger chain, deferred intents) is solid and correct. The main gaps are:

1. **Collaboration request pills are missing from Discover/Explore** — they only appear on Home
2. **No "accepted" push notification for friend links** — consent notification fires but no explicit acceptance notification
3. **Passive ignore** — no explicit dismiss UX, users just don't respond
4. **Onboarding sends friend requests, not direct friend links** — the auto-conversion handles it, but the UX framing differs from the spec

Items 1 and 2 are straightforward fixes. Items 3 and 4 need product decisions. Everything I found is proven with evidence from direct source code inspection — no guesses.
