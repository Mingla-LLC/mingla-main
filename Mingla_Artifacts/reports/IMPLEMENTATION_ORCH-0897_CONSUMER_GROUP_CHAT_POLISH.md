# IMPLEMENTATION_ORCH-0897_CONSUMER_GROUP_CHAT_POLISH

Status: implemented, partially verified

Date: 2026-05-22

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## Summary

Polished the consumer trip/event group chat surface shown in the operator simulator screenshot:

- Trip/event group chats now resolve live public event metadata from `business_public_events_view` plus `brands`.
- Event/trip title supersedes stale `conversations.name` values such as `Untitled draft`.
- Group chat avatar uses the event/trip cover in both the chat header and chat list row, with the participant stack retained as fallback.
- Countdown banner remains tappable but no longer opens an external browser; it opens the existing consumer in-app public event sheet via `ExpandedBusinessEventSheet`.
- Planner/blast messages preserve `marketing_campaign_id` and show the brand name when the sender is the event brand account or a marketing blast.
- Trip/event chats now render broadcast-channel chrome so they do not read like generic group chats.
- Broadcast-only event/trip chats hide the consumer composer and show a read-only channel notice.
- The countdown and event-channel strip now render as one premium orange header stack with shared gutters, an internal divider, icon badge, and one rounded bottom edge.
- Countdown copy is one line and punchier, e.g. `Today · Event · View details`.
- Countdown row now uses the same 15pt bold white text treatment as the broadcast row, with a matching calendar icon badge.
- Broadcast channel copy is one line and punchier, e.g. `Event broadcast · Brand only`.
- The broadcast-only bottom notice now reserves scroll clearance for both chat messages and the in-app public event sheet, preventing the newest message and ticket buttons from sitting underneath it.
- Chat list rows now have distinct visual/default states for event/trip broadcasts, collaboration sessions, and direct messages using a restrained dark-glass list language.
- Direct messages and collaboration group stacks now render real profile photos when `avatar_url` is available.
- Empty event/trip broadcast rows now show event timing context instead of generic `No messages yet`.
- Consumer event/trip chat list visibility is now gated by the signed-in user's paid or partially-refunded order for that event/trip.
- Chat list rows now keep tighter spacing between cards while using a fixed avatar lane, slightly taller rows, and more internal spacing so titles, pills, previews, and timestamps align cleanly.
- Broadcast/collab pills, preview text, timestamps, and direct pair controls now hide while archive/delete swipe actions are being revealed, preventing row content from painting over destructive actions.
- Event/trip broadcast headers now use attendee-aware copy (`3 attending` / `3 travelling`) instead of generic `people in chat`.
- The event/trip header more button now opens an in-app attendees/travellers sheet.
- Attendee/traveller rows use real avatars where available and tap through to the existing consumer public-profile route via `onViewProfile`.

## Files Changed

- `app-mobile/src/components/ConnectionsPage.tsx`
- `app-mobile/src/components/MessageInterface.tsx`
- `app-mobile/src/components/chat/TripCountdownBanner.tsx`
- `app-mobile/src/components/connections/ChatListItem.tsx`
- `app-mobile/src/components/chat/MessageBubble.tsx`
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`
- `app-mobile/src/components/ui/Icon.tsx`
- `app-mobile/src/services/messagingService.ts`
- `app-mobile/src/services/connectionsService.ts`
- `app-mobile/src/hooks/useMessages.ts`
- `app-mobile/scripts/ci/orch-0897-consumer-chat-polish-check.mjs`
- `app-mobile/package.json`

## Verification

Passed:

```bash
cd app-mobile
npm run test:orch-0897-chat-polish
npx eslint src/components/MessageInterface.tsx src/components/ConnectionsPage.tsx src/components/chat/TripCountdownBanner.tsx src/components/connections/ChatListItem.tsx src/services/messagingService.ts src/services/connectionsService.ts src/hooks/useMessages.ts src/components/chat/MessageBubble.tsx src/components/ui/Icon.tsx src/components/expandedCard/ExpandedBusinessEventSheet.tsx scripts/ci/orch-0897-consumer-chat-polish-check.mjs
cd ..
git diff --check
```

Notes:

- `npm run test:orch-0897-chat-polish` passed 17/17.
- Latest scoped ESLint across the touched ORCH-0897 consumer chat files returned 0 errors and 46 existing warnings.
- `git diff --check` passed.
- Repo-wide `npx tsc --noEmit --pretty false` remains blocked by unrelated pre-existing errors in `BoardDiscussion`, `ConnectionsPage` friend-service typing, `LockedPlanBanner`, `LockedCardSchedulingSheet`, `TicketCartSheet`, `HomePage`, `nativeCheckoutFlow`, and workspace package typings for `event-rendering`, `payments-native`, and `phone-input`.

## Manual QA

On an event/trip group chat:

1. Header title should show the event/trip title, not `Untitled draft`.
2. Header avatar and chat-list avatar should show the event/trip cover when present.
3. Planner/blast message labels should show the brand name when the message sender is the brand account or has `marketing_campaign_id`.
4. Countdown banner should still render the countdown/today text.
5. Tapping the countdown banner should open the public event/trip page inside the consumer app sheet, not Safari or an external browser.
6. Trip/event chats should show an event/trip broadcast channel strip under the countdown banner.
7. When organiser broadcast-only is enabled, the message input should be absent for consumer users and replaced by the read-only broadcast notice.
8. The countdown and channel strip should appear as one premium orange header block with aligned side gutters, a subtle divider, an icon badge, and one rounded bottom edge.
9. Countdown text should be one line and read punchier than `Today is ...`.
10. Countdown text should match the broadcast row typography and include a calendar icon badge.
11. Broadcast channel text should be one line and not render a title/subtitle block.
12. Event/trip broadcast chat-list rows should have a subtle orange-accent broadcast treatment and useful date/countdown fallback.
13. Collaboration session rows should show a restrained collab-session treatment and real participant avatar photos when available.
14. Direct message rows should show the other user's real profile photo when available and share the same premium dark row language.
15. Event/trip broadcast rows should be absent unless the current user has a paid/partial-refund buyer order for that event/trip.
16. Chat list rows should sit closer together, but each card should feel taller inside: titles, pills, previews, and timestamps should have room to breathe.
17. Direct, collaboration, and broadcast rows should all start their text from the same visual column after the avatar lane.
18. Swiping a chat row left to reveal Archive/Delete should not leave the broadcast/collab pill, preview message, timestamp, or pair controls visible over the action buttons.
19. Event/trip broadcast headers should say `attending` or `travelling`, not `people in chat`.
20. Tapping the three-dot header button in an event/trip channel should open the attendees/travellers sheet.
21. Tapping a person in that sheet should open the person's public consumer profile.
22. The newest message bubble should sit above the broadcast-only notice, not underneath it.
23. The public event sheet should scroll ticket actions above the broadcast-only notice.

## Security Note

This patch adds a consumer-side, RLS-filtered buyer-order gate before rendering event/trip chat rows. Because stale `conversation_participants` rows can still exist, a full backend hardening pass should add a server/RLS invariant that event/trip conversation visibility for consumer buyers requires an eligible `orders` row, while preserving organiser/team access through the business surface.

## Risks

Brand-name sender display is intentionally scoped to brand-account and marketing-blast messages. Buyer-to-buyer messages continue to show the sender profile name to avoid falsely attributing customer messages to the brand.

The in-app sheet can open only when the conversation event resolves to a `BusinessEventCard` from `business_public_events_view`; if the event is not public or metadata fetch is unavailable, the banner stays visible but non-pressable rather than falling back to an external browser.
