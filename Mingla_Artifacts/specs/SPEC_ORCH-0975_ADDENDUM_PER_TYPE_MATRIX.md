# SPEC ADDENDUM — ORCH-0975 [Per-Type Data Matrix + SPEC corrections]

**Companion to:** `Mingla_Artifacts/specs/SPEC_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
**Companion to:** `Mingla_Artifacts/design/DESIGN_ORCH-0975_CONSUMER_NOTIFICATIONS_REDESIGN.md`
**Status:** **MANDATORY READ for implementor.** Corrects three sections of the original SPEC where I assumed `data` payload shapes that don't actually exist in production today.
**Authored:** 2026-05-25 (Claude `mingla-forensics`, post-operator catch on per-type coverage gap)

---

## Why this addendum exists

Operator asked the right question after SPEC delivery: "did we account for the different types of notifications that currently come through, and are they redesigned for this new look?"

Honest answer: **the original SPEC assumed a generic `data` payload shape (`data.senderName`, `data.senderAvatarUrl`, `data.fromLocationName`, `data.toLocationName`, `data.locationName`, `data.placeName`) that almost no notification type actually populates today.** I audited every `notify-*` and `send-*` edge function in `supabase/functions/` and `_shared/push-translations.ts`. Reality is:

- **24 of the 25 active types populate `data: { deepLink }` and nothing else** that the card design cares about. The actor name, place name, session name, etc. all live in the server-rendered `title` + `body` strings.
- **Only `collaboration_invite_received` carries `data.inviterName` + `data.inviterAvatarUrl`** explicitly — the one type that already shipped a richer payload (per `send-collaboration-invite/index.ts:185-194`).
- **`actor_id` is consistently present** on every type that has a human actor (friend_request_*, pair_request_*, paired_user_*, collaboration_invite_*, session_member_*, board_*). System-only types (calendar_reminder_*, visit_feedback_prompt, holiday_reminder, weekly_digest, trial_ending, referral_credited, re_engagement_*) carry `actor_id: null`.
- **`title` and `body` are server-formatted strings** with names embedded (e.g. `"Marcus Rivera wants to connect"`, `"They saved \"Kashin Japanese Restaurant\" — take a look."`). The client has no structured access to the embedded names.

This addendum **overrides** three sections of the original SPEC and provides a 25-row matrix the implementor must consume.

---

## SPEC corrections (override original SPEC §3.3 + DESIGN §3.2)

### Correction 1 — Bold-actor title split (DESIGN §3.2.3 Row 1)

**Original SPEC said:** "Split title on `actorName` (sourced from `data.senderName || data.inviterName || data.userName || data.fromUserName`), render actor portion at `fontWeight: '700'`, rest at `fontWeight: '400'`. When `actorName === null`, render full title at `fontWeight: '600'`."

**Corrected behaviour:** Implementor MUST default to "render full title at single semibold weight" because for 24 of 25 types `data` does not carry an extractable actor name. The bold-split path engages ONLY when `data.inviterName` (or any other explicit name field) is present AND the title string contains that exact substring. Today this means the bold-split fires only for `collaboration_invite_received`. Every other type renders the title as one semibold string.

**`renderTitleWithBoldActor()` helper contract:**

```ts
function renderTitleWithBoldActor(
  title: string,
  data: Record<string, unknown>,
): React.ReactNode {
  // Try every known explicit name field in priority order
  const explicitName =
    (data?.inviterName as string | undefined) ||
    (data?.senderName as string | undefined) ||
    (data?.userName as string | undefined) ||
    (data?.fromUserName as string | undefined) ||
    null;

  if (!explicitName || !title.includes(explicitName)) {
    // Default path (24/25 types): single semibold weight
    return <Text style={styles.titleSemibold}>{title}</Text>;
  }

  // Rich path (collaboration_invite_received today; others if writers harmonise later)
  const idx = title.indexOf(explicitName);
  const before = title.slice(0, idx);
  const after = title.slice(idx + explicitName.length);
  return (
    <Text style={styles.titleSemibold}>
      {before}
      <Text style={styles.titleBoldActor}>{explicitName}</Text>
      {after}
    </Text>
  );
}
```

Both branches are visually acceptable. The screenshot's bold-name treatment is the rich path; the default semibold is the universal fallback. No second-class look.

### Correction 2 — Location chain row (DESIGN §3.2.3 Row 2)

**Original SPEC said:** "For location-bearing notification types … render the row as a location chain: 📍 fromLocationName → toLocationName … Falls back to single-name when only one side is present."

**Corrected behaviour:** **REMOVE the location chain row from v1 entirely.** No current notification type populates structured location fields in `data`. The closest type — `paired_user_visited` — embeds the place name in the `body` string (`"Marcus visited Kashin Japanese Restaurant"`) but does NOT expose `data.placeName` as a structured field. Parsing the body string for place names is unreliable (no delimiter, no marker, language-dependent).

**Replacement behaviour for Row 2 (body row):** render `notification.body` as-is. The server-formatted body string is the secondary line under the title. Style: `fontSize: 14, fontWeight: '400', color: colors.gray[600], lineHeight: 19`, `numberOfLines: 2`, `marginTop: 4`.

The `getNotificationLocation()` helper from the original SPEC is **NOT IMPLEMENTED in v1.** It stays as a comment block in the code with a TODO referencing a future follow-up ORCH (e.g. "ORCH-0976+ would harmonise every notify-* writer to populate `data.placeName`, `data.fromPlaceName`, `data.toPlaceName` for visit / pair-activity / collaboration types, after which the location-chain row in `DESIGN_ORCH-0975` §3.2.3 Row 2 becomes implementable as designed").

**Screenshot reconciliation:** the operator's reference screenshot showed "Regal Crossroads → Kashin Japanese Restaurant" as a two-place chain. **That specific UI is aspirational** — no current notification type carries the underlying data. The redesigned card matches the screenshot's other elements (ringed avatar, status dot, bold-name split where data permits, per-category pill, right-side time + unread dot). The location chain row IS NOT in v1. Operator should accept this as a v1 deferral OR open ORCH-0976+ to harmonise the writers (see §4 of this addendum).

### Correction 3 — Avatar URL resolution (DESIGN §3.2.2)

**Original SPEC said:** "Avatar URL via `getAvatarUrl(data)` reading `data.senderAvatarUrl || data.inviterAvatarUrl || data.avatar_url`."

**Corrected behaviour:** the existing `getAvatarUrl()` helper at `NotificationsModal.tsx:169-175` reads exactly those three fields. After audit, only `data.inviterAvatarUrl` (collaboration_invite_received) and `data.avatar_url` (rarely present, type-dependent) ever populate. `data.senderAvatarUrl` does not exist in any current writer.

Implementor has THREE options for avatar URL resolution; **operator's recommended path is Option C** for v1 to keep scope tight:

**Option A — Server-side harmonisation (out of scope for v1):** push avatar_url into the data payload of every notify-* writer. Touches 10+ edge functions. Belongs to a follow-up ORCH; do NOT include in ORCH-0975.

**Option B — Client-side actor profile lookup (medium scope):** add a `useActorAvatar(actorId: string | null)` React Query hook that fetches `profiles.avatar_url` by `actor_id` with infinite stale-time (avatars are quasi-static). Each card calls the hook; React Query dedupes lookups for the same actor across multiple cards. ~30 lines of new code + a `profileKeys.byId(actorId)` query key. Risk: adds N queries on first render where N = distinct actors in the inbox (typically 5-15 — bounded by `INITIAL_FETCH_LIMIT = 100` cap on notifications and natural duplication). Acceptable but expands scope.

**Option C — Skip lookup, use Ionicon fallback (RECOMMENDED for v1):** when `getAvatarUrl()` returns null, render the system Ionicon inside the ringed circle (the existing fallback path at `NotificationsModal.tsx:440-448` extended with the ring + status-dot treatment per `DESIGN_ORCH-0975` §3.2.2). This means cards for `friend_request_received`, `friend_request_accepted`, `pair_request_received/accepted`, `paired_user_saved_card`, `paired_user_visited`, `session_member_joined/left`, `board_*` show the Ionicon (e.g. `person-add`, `people`, `heart`, `chatbubble`) inside the orange ring instead of a real photo. Cards for `collaboration_invite_received` show the inviter's real photo (because `data.inviterAvatarUrl` is present). The visual story is consistent: photo when data permits, type-matched icon when not. No surprises, no missing-image broken states, no extra queries.

**v1 ships Option C.** Implementor adds a one-line comment above the avatar block: `// ORCH-0975 v1: avatar URL comes from data.inviterAvatarUrl when present (collaboration_invite_received only). All other types show the Ionicon fallback inside the ringed circle. Future ORCH-0976+ may add useActorAvatar() hook OR harmonise notify-* writers to push avatar_url into data — see SPEC_ORCH-0975_ADDENDUM §3 Correction 3.`

---

## Per-type matrix (25 rows — ALL active notification types)

For each type: writer file, `data` fields populated, sample title+body, category bucket (drives pill colour + icon), avatar treatment under v1 (Option C), and visual risk.

| # | Type | Writer | `data` fields populated | Sample title → body | Bucket (pill) | Avatar (v1) | Bold-actor split? | Action buttons? | Visual risk |
|---|------|--------|------------------------|---------------------|---------------|-------------|-------------------|-----------------|-------------|
| 1 | `friend_request_received` | `send-friend-request-email/index.ts:128` | `deepLink`, `type`, `requestId`, `senderId`, `senderUsername` | `Marcus Rivera wants to connect` → `Tap to accept or pass.` | **Social** (orange pill) | Ionicon `person-add-outline` (blue→keep) in orange ring | NO (no `data.senderName`; senderUsername lives in data but title uses display name from profile) | YES — Accept + Decline | LOW — pill + ring + buttons work; just no photo |
| 2 | `friend_request_accepted` | `send-friend-accepted-notification/index.ts:113` | `deepLink` (+ likely `senderId`/`receiverId`; verify) | `Marcus Rivera accepted your request` → `You're now connected — start planning together!` | **Social** | Ionicon `people` (green→keep) in orange ring | NO | NO | LOW |
| 3 | `pair_request_received` | `notify-pair-request-visible/index.ts:98` | `deepLink` (+ pairRequestId likely) | `Marcus Rivera wants to pair with you` → `Accept to discover experiences for each other.` | **Social** | Ionicon `people-outline` (red→keep) in orange ring | NO | YES — Accept + Decline | LOW |
| 4 | `pair_request_accepted` | `send-pair-accepted-notification/index.ts:119` | `deepLink` (+ likely senderId/requestId) | `Marcus Rivera accepted your pair request` → `You're now paired — explore together!` | **Social** | Ionicon `heart` (red→keep) in orange ring | NO | NO | LOW |
| 5 | `paired_user_saved_card` | `notify-pair-activity/index.ts:128-141` | `deepLink` only | `Marcus found something for you` → `They saved "Kashin Japanese Restaurant" — take a look.` | **Social** | Ionicon `heart-outline` (red→keep) in orange ring | NO | NO | MEDIUM — place name lives in body string; cannot render as location chain row; body line will show the quoted name (acceptable, matches existing UX) |
| 6 | `paired_user_visited` | `notify-pair-activity/index.ts:165-179` | `deepLink` only | `Marcus visited a place` → `Marcus visited Kashin Japanese Restaurant` | **Social** | Ionicon `location-outline` (green→keep) in orange ring | NO | NO | MEDIUM — same as #5; place name in body string; cannot render screenshot's two-place chain |
| 7 | `collaboration_invite_received` | `send-collaboration-invite/index.ts:185-194` | `deepLink`, `type`, `sessionId`, `sessionName`, `inviteId`, `inviterId`, `inviterName`, `inviterAvatarUrl` | `Marcus Rivera invited you to plan` → `Join "Brunch Plans" and start swiping together.` | **Plans** (blue pill) | **REAL PHOTO** when `inviterAvatarUrl` present (only type with rich data) → orange ring | **YES** (`data.inviterName` present, matched in title) — actor renders bold, rest regular | YES — Join + Decline | NONE — the showcase type; matches screenshot exactly |
| 8 | `collaboration_invite_accepted` | `notify-invite-response/index.ts:156` | `deepLink`, `type` | `Marcus is in!` → `They joined "Brunch Plans." Time to plan.` | **Plans** | Ionicon `checkmark-circle` (green→keep) in orange ring | NO (no inviterName in data) | NO | LOW |
| 9 | `collaboration_invite_declined` | `notify-invite-response/index.ts:156` | `deepLink`, `type` | `Marcus can't make it` → `They passed on "Brunch Plans." Invite someone else?` | **Plans** | Ionicon `close-circle-outline` (gray→keep) in orange ring | NO | NO | LOW |
| 10 | `session_member_joined` | (in-session push — no dedicated writer file; likely inline in session-realtime handlers) | `deepLink` likely | `Marcus joined the plan` → (body TBD) | **Plans** | Ionicon `person-add` (blue) in orange ring | NO | NO | LOW |
| 11 | `session_member_left` | (in-session push — likely inline) | `deepLink` likely | `Marcus left the plan` → (body TBD) | **Plans** | Ionicon `person-remove-outline` (gray) in orange ring | NO | NO | LOW |
| 12 | `board_card_saved` | (board realtime — likely inline) | `deepLink` likely | (TBD) | **Plans** | Ionicon `heart` (red) in orange ring | NO | NO | LOW |
| 13 | `board_card_voted` | (board realtime — likely inline) | `deepLink` likely | (TBD) | **Plans** | Ionicon `thumbs-up-outline` (green) in orange ring | NO | NO | LOW |
| 14 | `board_card_rsvp` | (board realtime — likely inline) | `deepLink` likely | (TBD) | **Plans** | Ionicon `calendar-outline` (blue) in orange ring | NO | NO | LOW |
| 15 | `direct_message_received` | `notify-message/index.ts:178` | `deepLink` only | `Marcus Rivera` → `Hey! Are you free Friday?` | **Chats** (violet pill) | Ionicon `chatbubble` (blue→keep) in orange ring | NO (no senderName in data; title IS the sender name) | NO | LOW — title is just the name; body is message preview. Card reads naturally. |
| 16 | `board_message_received` | `notify-message/index.ts:178` | `deepLink` only | `Marcus Rivera in Brunch Plans` → `Anyone free Saturday morning?` | **Chats** | Ionicon `chatbubbles-outline` (violet→keep) in orange ring | NO | NO | LOW |
| 17 | `board_message_mention` | `notify-message/index.ts:254` | `deepLink` only | `Marcus Rivera mentioned you in "Brunch Plans"` → `@you what about 10am?` | **Chats** | Ionicon `at-outline` (orange→keep) in orange ring | NO | NO | LOW |
| 18 | `board_card_message` | `notify-message/index.ts:519` | `deepLink` only (+ likely sessionId/cardId) | `Marcus Rivera commented on Kashin Japanese` → `Looks amazing!` | **Chats** | Ionicon `chatbubble-ellipses-outline` (violet→keep) in orange ring | NO | NO | LOW |
| 19 | `calendar_reminder_tomorrow` | `notify-calendar-reminder/index.ts:122` | `deepLink` only | `Tomorrow: Date Night Brunch` → `Don't forget — Date Night Brunch is tomorrow at 11 AM.` | **System** (gray pill) | Ionicon `calendar` (blue→keep) in orange ring (no actor → orange ring still shows on unread because the ring is read/unread driven, not actor-driven) | NO | NO | LOW |
| 20 | `calendar_reminder_today` | `notify-calendar-reminder/index.ts:162` | `deepLink` only | `Today: Date Night Brunch` → `Enjoy your experience at 11 AM!` | **System** | Ionicon `sunny-outline` (amber→keep) in orange ring | NO | NO | LOW |
| 21 | `visit_feedback_prompt` | `notify-calendar-reminder/index.ts:234` | `deepLink` only | `How was Date Night Brunch?` → `Leave a quick review — it helps your future recommendations.` | **System** | Ionicon `star-outline` (amber→keep) in orange ring | NO | YES — Review (single-action) | MEDIUM — single Review button; verify existing single-action path renders the button at the same width as Accept-only |
| 22 | `holiday_reminder` | `notify-holiday-reminder/index.ts:146` | `deepLink` likely (+ holiday/person ids) | `Tomorrow is Sarah's birthday!` → `Don't forget to plan something special.` | **System** | Ionicon `gift-outline` (red→keep) in orange ring | NO | NO | LOW |
| 23 | `trial_ending` | `notify-lifecycle/index.ts:140` | `deepLink` only | `Your trial ends tomorrow` → `Upgrade to keep pairing and collaboration features.` | **System** | Ionicon `time-outline` (amber→keep) in orange ring | NO | YES — Upgrade (single-action) | MEDIUM — single Upgrade button; same as #21 |
| 24 | `referral_credited` | `notify-referral-credited/index.ts:52` | `deepLink` only | `You earned a free month!` → `Marcus joined Mingla from your invite.` | **System** | Ionicon `gift` (green→keep) in orange ring | NO | NO | LOW |
| 25 | `weekly_digest` | `notify-lifecycle/index.ts:325` | `deepLink` only | `Your week on Mingla` → `(digest body — saves, plans, friends summary)` | **System** | Ionicon `bar-chart-outline` (orange→keep) in orange ring | NO | NO | LOW — content-rich body line; respect numberOfLines: 2 cap |

**Empty cells noted ("TBD"):** session_member_joined/left + board_card_saved/voted/rsvp don't appear in the dedicated `notify-*` writer files I read. They likely fire from in-session realtime handlers (TypeScript side) calling notify-dispatch inline OR from board state-change triggers. Implementor should grep `app-mobile/src` + `supabase/functions` for these strings during implementation and confirm. If they don't currently fire as in-app notifications at all (only as push), some cards will never appear and the test fixture for them can be skipped. NOT a blocker — registry just stays per `NOTIFICATION_ICONS` definition.

---

## What the redesigned card looks like, per type

Three visual archetypes emerge from the matrix:

### Archetype A — System icon + orange ring (24 of 25 types)

```
┌────────────────────────────────────────────────────────────┐
│  ╭─────╮                                                   │
│  │ 🧑‍🤝‍🧑 │ ←orange ring  Marcus Rivera wants to    1d     │
│  │ ●   │ ←status dot     connect                          │
│  ╰─────╯                                                   │
│            Tap to accept or pass.                          │
│            ╭───────────╮                                   │
│            │ 👥 Social  │                                  │
│            ╰───────────╯                                   │
│            [ Accept ] [ Decline ]                          │
└────────────────────────────────────────────────────────────┘
```

Title in single semibold weight (server already formats name first). Body in regular gray below. Per-category pill at bottom. Action buttons when type is actionable.

### Archetype B — Real photo + orange ring (1 of 25 types: collaboration_invite_received)

```
┌────────────────────────────────────────────────────────────┐
│  ╭─────╮                                                   │
│  │ 📷  │ ←orange ring   **Marcus Rivera** invited     1d  │
│  │ ●   │ ←status dot      you to plan                     │
│  ╰─────╯                                                   │
│            Join "Brunch Plans" and start swiping together. │
│            ╭──────────╮                                    │
│            │ 📅 Plans  │                                   │
│            ╰──────────╯                                    │
│            [ Join ] [ Decline ]                            │
└────────────────────────────────────────────────────────────┘
```

Real `inviterAvatarUrl` photo. Bold-actor name split engaged because `data.inviterName` is matched in title. This is the "showcase" treatment that matches the operator's screenshot most closely.

### Archetype C — System icon + system messaging (5 types: calendar_*, visit_feedback_prompt, holiday_reminder, trial_ending, weekly_digest, referral_credited)

```
┌────────────────────────────────────────────────────────────┐
│  ╭─────╮                                                   │
│  │ 📅  │ ←orange ring   Tomorrow: Date Night         1d   │
│  │ ●   │ ←status dot     Brunch                            │
│  ╰─────╯                                                   │
│            Don't forget — Date Night Brunch is tomorrow    │
│            at 11 AM.                                       │
│            ╭───────────╮                                   │
│            │ 🔔 System  │                                  │
│            ╰───────────╯                                   │
└────────────────────────────────────────────────────────────┘
```

No actor → Ionicon (gray-blue palette) inside orange ring (ring still indicates unread). No actor-bold-split. No action buttons (except `visit_feedback_prompt` + `trial_ending` which get single-button variants).

All three archetypes share the same outer chrome — radius 20, white card, hairline border, shadow, peach-tinted bg when unread, right-side time + unread dot, per-category pill at bottom. The DIFFERENCE between archetypes is only avatar source + bold-split engagement. **The redesign holds together visually for all 25 types.**

---

## Mock fixtures (implementor + tester consume these)

Implementor writes these to `app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts` so both the happy-path jest test and the tester's adversarial test + on-sim visual QA all consume the same fixtures.

```ts
import type { ServerNotification } from '../../../hooks/useNotifications';

const baseFields = (id: string, type: string, isRead: boolean, createdAt: string) => ({
  id,
  user_id: 'recipient-uuid',
  type,
  is_read: isRead,
  read_at: isRead ? createdAt : null,
  push_sent: true,
  created_at: createdAt,
  expires_at: null,
  related_type: null,
  related_id: null,
});

export const MOCK_NOTIFICATIONS: ServerNotification[] = [
  // Archetype B — showcase (real photo + bold-actor split)
  {
    ...baseFields('n-collab-invite', 'collaboration_invite_received', false, '2026-05-24T18:00:00Z'),
    title: 'Marcus Rivera invited you to plan',
    body: 'Join "Brunch Plans" and start swiping together.',
    actor_id: 'actor-marcus',
    related_id: 'invite-123',
    related_type: 'collaboration_invite',
    data: {
      deepLink: 'mingla://session/sess-123',
      type: 'collaboration_invite_received',
      sessionId: 'sess-123',
      sessionName: 'Brunch Plans',
      inviteId: 'invite-123',
      inviterId: 'actor-marcus',
      inviterName: 'Marcus Rivera',
      inviterAvatarUrl: 'https://avatars.example.com/marcus.jpg',
    },
  },
  // Archetype A — social with action buttons (no photo, Ionicon fallback)
  {
    ...baseFields('n-friend-req', 'friend_request_received', false, '2026-05-24T17:30:00Z'),
    title: 'Sarah Chen wants to connect',
    body: 'Tap to accept or pass.',
    actor_id: 'actor-sarah',
    related_id: 'fr-456',
    related_type: 'friend_request',
    data: {
      deepLink: 'mingla://connections?tab=requests',
      type: 'friend_request',
      requestId: 'fr-456',
      senderId: 'actor-sarah',
      senderUsername: 'sarahc',
    },
  },
  // Archetype A — paired activity (place name in body string, not data)
  {
    ...baseFields('n-pair-visit', 'paired_user_visited', false, '2026-05-24T16:00:00Z'),
    title: 'Marcus visited a place',
    body: 'Marcus visited Kashin Japanese Restaurant',
    actor_id: 'actor-marcus',
    related_id: 'visit-789',
    related_type: 'visit',
    data: { deepLink: 'mingla://discover?paired=true' },
  },
  // Archetype A — message (title is just the sender name)
  {
    ...baseFields('n-dm', 'direct_message_received', true, '2026-05-23T20:00:00Z'),
    title: 'Sarah Chen',
    body: 'Hey! Are you free Friday?',
    actor_id: 'actor-sarah',
    related_id: 'conv-abc',
    related_type: 'conversation',
    data: { deepLink: 'mingla://chat/conv-abc?type=direct' },
  },
  // Archetype C — calendar reminder (no actor)
  {
    ...baseFields('n-cal-tomorrow', 'calendar_reminder_tomorrow', false, '2026-05-23T08:00:00Z'),
    title: 'Tomorrow: Date Night Brunch',
    body: "Don't forget — Date Night Brunch is tomorrow at 11 AM.",
    actor_id: null,
    related_id: 'cal-101',
    related_type: 'calendar_entry',
    data: { deepLink: 'mingla://calendar/cal-101' },
  },
  // Archetype C — visit feedback (single action button)
  {
    ...baseFields('n-feedback', 'visit_feedback_prompt', true, '2026-05-22T19:00:00Z'),
    title: 'How was Date Night Brunch?',
    body: 'Leave a quick review — it helps your future recommendations.',
    actor_id: null,
    related_id: 'exp-202',
    related_type: 'experience',
    data: { deepLink: 'mingla://review/exp-202' },
  },
  // Archetype C — weekly digest
  {
    ...baseFields('n-digest', 'weekly_digest', true, '2026-05-20T09:00:00Z'),
    title: 'Your week on Mingla',
    body: 'You saved 12 places, planned 3 outings, and connected with 2 new friends.',
    actor_id: null,
    related_id: null,
    related_type: null,
    data: { deepLink: 'mingla://home' },
  },
  // Archetype C — referral credited
  {
    ...baseFields('n-referral', 'referral_credited', true, '2026-05-19T14:00:00Z'),
    title: 'You earned a free month!',
    body: 'Marcus joined Mingla from your invite.',
    actor_id: null,
    related_id: null,
    related_type: null,
    data: { deepLink: 'mingla://profile?tab=subscription' },
  },
];
```

8 fixtures cover all 3 archetypes + all 4 category pill colours + read+unread states + actor and no-actor + action buttons (Accept/Decline + single-action) + dot/no-dot. This is the visual-QA baseline.

---

## Updated success criteria (replaces SPEC §4 SC-30)

**SC-30 (revised) — Constitution #9 no fabricated data:**
- Cards with no actor (`actor_id === null`) render the Ionicon fallback inside the ringed circle. Never render initials like "??" or placeholder names. ✅
- Cards with no `data.inviterName` (or other explicit name field) render the title as a single semibold string. NO bold-split, NO inferred actor name. ✅
- The location chain row is NOT rendered in v1 for any type (no current type populates structured location data). ✅
- The "{N} new" pill is hidden when `unreadCount === 0`. ✅
- Mark-all-read button is hidden when `unreadCount === 0`. ✅
- Clear-all button is hidden when `notifications.length === 0`. ✅
- The entire action pill row is hidden when both halves would be hidden. ✅

**NEW SC-36 — All 25 active notification types render without crashing:**
- Implementor's jest test renders the `MOCK_NOTIFICATIONS` fixture set (8 fixtures covering 3 archetypes); every card mounts without error and matches its archetype's expected slots.
- Tester independently extends the fixture set to cover the remaining 17 types (one per type) and verifies on sim that each renders consistently per archetype.

**NEW SC-37 — Bold-actor split engages ONLY for collaboration_invite_received in v1:**
- Render the fixture set; assert that ONLY the `collaboration_invite_received` card contains the styled `titleBoldActor` text node. All others render `titleSemibold` single-weight only.
- This SC fails if implementor wires the bold-split to fire based on heuristic title parsing or actor-profile lookup (out of scope; would expand v1 scope).

**NEW SC-38 — Location chain row is NOT in the rendered tree:**
- `queryByTestId('notifications-location-chain')` returns null across all 8 fixtures. Codifies the v1 deferral.

---

## Optional follow-up ORCH-0976+ (NOT in this scope)

If the operator wants the screenshot's location-chain row + universal bold-actor split + real-photo-everywhere look:

**Scope:** harmonise every notify-* and send-* edge function so the `data` payload includes:
- `actorName` (canonical actor display name)
- `actorAvatarUrl` (or `null`)
- `fromPlaceName` / `toPlaceName` / `placeName` (for visit/save/collab types)
- `sessionName` (already in collab; extend to session_*, board_*)
- `experienceName` (for calendar reminders)

After that, `NotificationsSheet.tsx` can read these fields directly, the location-chain row becomes implementable, and Option B (`useActorAvatar` lookup hook) becomes unnecessary because every type carries `actorAvatarUrl` in data. Touches 10-12 edge functions + the central `notify-dispatch` validation. Adds 1 migration if any new columns are needed (probably none — payload is JSONB). Estimated 1 ORCH cycle of forensics + implementor + tester. Operator decides whether to register now or after seeing v1 ship.

---

## Implementor checklist (additions to SPEC §7)

After completing SPEC §7 steps 1-9, the implementor must ALSO:

10. **Write the fixture file** `app-mobile/src/components/__tests__/__fixtures__/notificationsFixtures.ts` per §"Mock fixtures" above (8 fixtures).
11. **Wire fixture into happy-path test** — `NotificationsSheet.test.tsx` renders the full `MOCK_NOTIFICATIONS` array and asserts SC-36 + SC-37 + SC-38.
12. **Drop the `getNotificationLocation()` helper from the v1 component** — replace with the `notification.body` direct render per Correction 2. Leave a single-line TODO comment referencing this addendum.
13. **Use the `renderTitleWithBoldActor()` contract from Correction 1 verbatim** — do NOT add heuristic title parsing, profile lookups, or any other actor-name resolution path.
14. **Confirm avatar Option C** — when `getAvatarUrl()` returns null AND `actor_id != null`, render the Ionicon fallback (per `NOTIFICATION_ICONS` registry) inside the ringed circle. No `useActorAvatar` hook in v1.

---

**End of SPEC_ORCH-0975 ADDENDUM.**
