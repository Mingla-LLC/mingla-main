# META-ORCH-1104 — Support: Where it lives + every journey

Business-side only (per §0 scope correction). Three surfaces: business-app requester,
admin-web handler desk, business-app handler console. Consumer/Explorer app untouched.
Mount points are real (from the four-lane audit).

---

## WHERE IT LIVES (surface map)

| # | Surface | Where exactly | New or reuse |
|---|---|---|---|
| 1 | **Business user files support** | Business app → Account tab → new "Help & Support" row (`mingla-business/app/(tabs)/account.tsx` SettingsNavRow ~L349) → new route `app/account/support.tsx` | NEW screen, reuses chat thread |
| 2 | **The support chat thread** (both sides, phone) | New `app/support/[ticketId].tsx` | Reuses `GroupChatPanel` (message list + composer) + realtime + presence |
| 3 | **Staff inbox / queue** (phone) | Conditional card on Account tab → new `app/support/inbox.tsx` | Reuses `useConversationList` + ARI `ConversationDrawer` switch pattern |
| 4 | **Admin handler desk** (PC) | mingla-admin → new "Support" sidebar item → new Support page (queue + detail) | NEW page, mirrors `UserManagementPage`/`ClaimsPage` |
| 5 | **User segmentation** (PC) | mingla-admin → existing Users page → new Explorer/Business/Admin tabs + counts + filter | Modify `UserManagementPage.jsx` |
| 6 | **Support-staff admin** (PC) | Inside the Support desk → "Agents" panel: grant/revoke `enabled` per user | NEW, mirrors `AdminPage` roster |
| 7 | **Availability toggle** (phone) | On the staff inbox header → "Available for support" switch | NEW, flips `support_staff.available` |

---

## JOURNEY 1 — Business user needs help (the requester)

**Who:** any business user (a brand owner/team member) in the business app.
**Where:** Account tab → "Help & Support".

1. Opens the business app, taps **Account** tab, sees a new **"Help & Support"** row (sits with Edit Profile / Notifications).
2. Taps it → `Help & Support` screen. Shows: a **"Start a chat"** button, an optional **subject** field, and a list of their **past tickets** (with status badges: Open / Pending / Resolved).
3. Taps **Start a chat** → optionally types a subject → lands directly in a **live chat thread** (the `GroupChatPanel` UI they already know from event group chats: bubbles + composer).
4. Backend mints a `support_tickets` row (status `new`) that owns a fresh `support` conversation; the user is its first participant.
5. They type their question. The moment a handler claims it, a "Support joined" system line appears; replies stream in realtime. They get a **push** when a handler replies (even if the app is closed).
6. If no one is online, it's just a **ticket** — they leave, and get a push when answered later. Same thread, same screen. (Live chat and ticket are the same object — presence is the only difference.)
7. Reopening **Help & Support** shows the thread under their ticket list; tapping it resumes the conversation.

**New:** the Help & Support screen + ticket list + "start chat" mint. **Reused:** the entire thread UI, realtime, presence, push.

---

## JOURNEY 2 — You handle support from your PC (admin desk)

**Who:** you (admin). **Where:** admin web → new **Support** sidebar item.

1. Log into the admin web. New **Support** item in the left sidebar (next to Users/Claims).
2. The **Support desk** opens to a **queue** (a table like the Users/Claims pages): each row = a ticket with requester name, subject, status, priority, last-message time, assigned handler. Filter by status (New / Open / Pending / Resolved) and "unassigned only."
3. Click a ticket → **detail view**: left = the full message thread; right = ticket meta (requester, their segment, brand if any, status, priority) + actions.
4. Click **Claim** → you become the assigned handler (sets `assigned_staff_id`); the requester sees "Support joined."
5. Type a reply in the composer → it sends into the same thread the requester sees, in realtime. You can change **status** (Open → Pending → Resolved) and **priority**.
6. An **"Agents"** panel (also in the Support desk) lists who has support access; you can **grant/revoke** the support capability for any business user (this is the "support tag" — you control it from here).
7. New tickets surface live at the top of the queue; an unread count badges the sidebar item.

**New:** the whole Support desk page (queue + detail + agents panel). **Reused:** the admin cross-user read pattern + table/detail UI conventions.

---

## JOURNEY 3 — You (or cofounder) handle support from your phone (business-app console)

**Who:** a business user **with the support tag ON**. **Where:** business app, gated console.

1. You flip someone's support capability ON from the admin desk (Journey 2, step 6). Nothing changes for normal business users — they never see any of this.
2. The tagged user opens the business app → **Account** tab now shows a **"Support — Live Chats"** card (only visible to support staff).
3. Tapping it opens the **inbox**: a list of tickets (reusing `useConversationList`), each showing requester + subject + unread + status. A header **"Available for support"** toggle controls whether they get notified of *new* incoming chats.
4. With **Available ON**, a new incoming ticket fires a **push to their phone** ("New support chat from …"). Tapping the push deep-links straight into that ticket's thread.
5. They tap a ticket → **Claim** → the thread opens (`GroupChatPanel`), they reply live. They can **switch between active chats** (the ARI `ConversationDrawer` pattern) without leaving the console.
6. They can set status/priority and, if needed, **create a ticket** on a user's behalf — full parity with the PC desk.
7. It is the **same shared queue** as the PC. If you claim on the phone, it shows claimed on the PC instantly. Switch devices mid-conversation seamlessly.

**New:** the inbox + availability toggle + the staff-capability gate + the claim-as-staff authorization. **Reused:** thread UI, conversation-switch drawer, conversation-list hook, push.

---

## JOURNEY 4 — You segment your users (admin)

**Who:** you. **Where:** admin web → existing **Users** page.

1. Open **Users**. Above the table, new **tabs: All / Explorer / Business / Admin** with live counts.
2. Pick **Business** → the list filters to real business users (derived from team membership, not the unreliable label). **Explorer** = everyone who isn't business or admin. **Admin** = your real active admin list.
3. Counts are correct because segments are **derived** from the authoritative tables, not the broken `account_type` field.
4. (If we do the cleanup) the dead `is_admin` column is gone, the future-admin lockout bug is fixed, and there's one true definition of each segment that the page reads.

**New:** segment tabs/counts/filter + the `derive_user_segment` function. **Optional cleanup:** retire dead column + fix the latent admin bug.

---

## THE ONE NEW HARD PART (so it's not hidden)

A phone staffer must read+reply to a ticket they didn't start. Normal chat security locks
threads to participants only (correct — keeps support private). So Phase 0 adds: a
`support_staff` capability check (`is_support_staff()`, mirroring how admin access already
works) + a secure server step that adds the staffer to the ticket when they **claim** it.
Everything after that (send, subscribe, presence, push) is the existing engine.

---

## NEW vs REUSED (the honest split)

**Genuinely new:** 2 tables (`support_tickets`, `support_staff`); the `'support'` conversation
type + its security; the claim/seed server step; the admin Support desk; the business-app
Help & Support screen, staff inbox, and availability toggle; the segment derivation + Users-page tabs.

**Reused as-is:** the chat thread UI (`GroupChatPanel`), message list/composer, realtime,
presence/typing, push fan-out, conversation-list + conversation-switch drawer, the admin
table/detail page conventions, and the admin cross-user read pattern.

That's why this is mostly **integration**, not invention.
