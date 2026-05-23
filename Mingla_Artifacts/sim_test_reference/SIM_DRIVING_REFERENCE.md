# Sim Driving Reference — Mingla Mobile

**Purpose:** Selector map + flow recipes for driving the Mingla app on iOS simulators (and Android emulators) via Maestro, idb, and `xcrun simctl`. Enables Claude orchestrator/tester and Codex orchestrator/tester to spin up multi-sim scenarios and run complex live-fire tests without re-discovering selectors every session.

**Owner:** Whoever runs the test. Update this doc as you discover new flows, broken selectors, or recipes. Append-only by default. Mark deprecated entries with `[DEPRECATED — <date> — <reason>]` instead of deleting (so old tests still parse).

**Coverage status (initial seed, 2026-05-23):**
- App entry / dev launcher / Metro connection — DONE
- Sim control commands (`xcrun simctl`, Maestro, idb) — DONE
- Post-META-ORCH-0929 tab bar — DONE
- Friends tab + invites + chooser + create group chat — IN PROGRESS
- Group chat (MessageInterface) + session pill + CollabDeckSheet — IN PROGRESS
- Solo deck (Home) — IN PROGRESS
- PreferencesSheet (solo + collab variants) — IN PROGRESS
- Saved / Likes / Profile — STUB
- Auth (sign-in / sign-out) — STUB
- Push notifications + deep links — STUB
- GPS / location simulation — DONE

When you extend, mirror the structure: **Screen name → How to get here → Selectors → Screenshot reference → Gotchas.**

## 1. Sim control commands

### Boot / list / terminate

```bash
# List booted devices
xcrun simctl list devices booted

# Currently active sims (as of 2026-05-23):
#   iPhone 17 Pro Max — UDID 2C3312D9-EE52-4EBD-9704-15811D49A2EC
#   iPhone 17         — UDID F7ECAC25-2A98-4002-AD17-85AED17AB752

# Terminate Mingla app on a sim
xcrun simctl terminate <UDID> com.mingla.app.v2

# Launch Mingla app on a sim
xcrun simctl launch <UDID> com.mingla.app.v2

# Screenshot
xcrun simctl io <UDID> screenshot /path/to/output.png
```

### GPS / location simulation

```bash
# Set sim GPS coordinates (decimal lat,lng)
xcrun simctl location <UDID> set <lat>,<lng>

# Useful test coordinates:
#   New York City     40.7128,-74.0060
#   Washington DC     38.8951,-77.0364
#   Raleigh NC        35.7909,-78.7396
#   Cary NC           35.7905,-78.7386   (within Raleigh's 18km driving circle)
#   Los Angeles       34.0522,-118.2437
#   Lagos NG          6.4551,3.3942      (the "out-of-overlap" stress city)
#   San Francisco     37.7749,-122.4194

# Clear sim GPS back to default
xcrun simctl location <UDID> clear
```

### Push notifications

```bash
# Send a test push to a sim (requires APNs payload JSON)
xcrun simctl push <UDID> com.mingla.app.v2 /path/to/payload.apns
```

### Background / foreground

```bash
# Sim has no built-in background command; achieve via:
# 1. Maestro: launchApp puts the target app to foreground (others go background)
# 2. Or restart the sim's springboard:
xcrun simctl spawn <UDID> launchctl reboot
```

## 2. Maestro driving — patterns and gotchas

### Install + path

```bash
~/.maestro/bin/maestro --device <UDID> test <flow.yaml>
# Java required via brew openjdk:
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
```

### Targeting

- `--device <UDID>` is REQUIRED for every command. Maestro defaults to the first-booted device which is often the Android emulator (a flaky misroute).
- Selectors order of preference: **text exact** > **text regex** > **id** > **coordinate point** > **percentage point**.
- Maestro's `tapOn: text:` is case-insensitive whole-substring match — use regex when text changes dynamically (`tapOn: text: ".*Lock It In.*"` matches `Lock It In (2)`).
- For multiline `<TextInput>` raw fields without placeholders, fall back to coordinate or percentage tap: `tapOn: point: "50%,73%"`.

### Hardware-keyboard caveats

- `inputText` uses `UITextInput.insertText()` — BYPASSES iOS hardware-keyboard autocorrect / autoCapitalize / capslock.
- For hardware-key-event reproducer tests, use idb (`brew install facebook/fb/idb-companion && pipx install --python python3.11 fb-idb`). Python 3.14 breaks idb — 3.11 venv required.
- If neither tool reproduces a keystroke-specific bug, STOP and ask operator.

### Animation + timing

- After tap, ALWAYS `waitForAnimationToEnd` before next tap. Sheets, modals, and tab transitions have 150-300ms animations.
- For toast-driven async confirmations, sleep 1-2s in shell BEFORE reading the next screenshot.

## 3. App entry

### Dev launcher → Metro

When the app is freshly installed or after a force-quit, launching opens the dev launcher (Expo Dev Client UI) instead of Mingla home. To connect:

**Screen:** Expo Dev Client launcher
**Detected by:** "Mingla / Development Build" header
**Action:** Tap the dev server URL matching the running Metro port.

```yaml
appId: com.mingla.app.v2
---
- launchApp
- tapOn:
    text: "http://localhost:8085"
```

**Screenshot:** `screenshots/dev_launcher_connect.png`

**Gotcha:** Metro must be running with `--clear` and the correct port (default 8081, or whatever port the running Metro instance is on — check `ps aux | grep "expo start"`).

## 4. Post-META-ORCH-0929 tab bar (consumer app)

After auth restore, the home screen shows the bottom tab bar with 5 tabs:

| Tab | Selector | Notes |
|---|---|---|
| Explore | `tapOn: text: "Explore"` | Default landing tab. Post-META: solo deck only. |
| Discover | `tapOn: text: "Discover"` | Map view of nearby places. |
| Friends | `tapOn: text: "Friends"` | Friends + group chats + invites entry. |
| Likes | `tapOn: text: "Likes"` | Saved + liked cards. |
| Profile | `tapOn: text: "Profile"` | Account settings, sign-out. |

**Screenshot reference:** `screenshots/tab_bar.png`

**Gotcha:** Each tab title is also matched if it appears inline somewhere on screen. To force-target the tab bar specifically, use `point: "<x>,~95%"` with the x-coordinate centered on the tab.

## 5. Friends tab (collab session entry)

**Screen:** Friends tab landing
**Detected by:** "Friends" header at top, plus a people-plus chooser button (center-ish at top), plus paired-friend avatars top-right, plus a search bar, plus a chat-bubbles list area.

**Screenshot:** `screenshots/friends_tab_landing.png`

### Top header (left to right)

1. **"Friends" title** (left)
2. **People-plus chooser button** — verified tap coord `point: "44%,7%"` opens the chooser sheet
3. **Paired friends' avatars** — Marcus, Priya, etc. Tap an avatar to (TBD — likely opens that friend's 1-on-1 chat)

### Chooser sheet (opened via people-plus button)

**Screenshot:** `screenshots/friends_chooser_sheet.png`

Two options:
- **"Create a group chat"** — opens `CreateGroupChatSheet`
- **"Add a friend"** — opens `AddFriendSheet` (NOT "Pair with someone" — that was an earlier draft label; the shipped UI says "Add a friend")

**Selectors:**
- Create group chat: `tapOn: text: "Create a group chat"`
- Add friend: `tapOn: text: "Add a friend"`
- Dismiss sheet: swipe-down didn't dismiss reliably in test driving; use a coordinate tap on background backdrop above the sheet, e.g., `point: "50%,25%"`.

### Search

Search bar near top: `tapOn: text: "Search chats..."` then `inputText: "<query>"`.

### Invites list (pending session invites)

Pending session invites appear at the top of the Friends list as orange-CTA rows: `<Inviter avatar> · <Inviter name> · invited you to <session/conversation>` with **Accept** and **Decline** buttons inline.

**Selectors:**
- Accept: `tapOn: text: "Accept"` — verified working, but matches FIRST visible Accept if multiple invites are present. Use coordinate for second/third invite (~ y=20%, 32%, etc per row index).
- Decline: `tapOn: text: "Decline"`.

**GOTCHA:** Accepting an invite via tap immediately changes the header — the inviter's avatar joins the paired-avatars set. If you accidentally tap an Accept button while trying to hit a row below it, you've changed state. Be precise with coordinates.

### Chats list

Below invites: existing 1-on-1 chats + group chats + ongoing sessions appear as rows. Session-linked chats have a **"Collab session"** pill on the right side of the row.

- Each row: avatar/icon + chat name + last-message preview + "Xd ago" timestamp + optional tags ("Collab session", "Broadcast").

**Selectors:**
- Open a chat: `tapOn: text: ".*<chat-name-substring>.*"` — but the row title text can be truncated; if `tapOn: text: "Testing stuff"` fails, fall back to `tapOn: text: ".*Locked in.*"` matching the row's last-message preview, OR a coordinate tap.
- **ORCH-0931 verified 2026-05-23:** session rows expose one parent accessibility node with the full row summary. For the live "Testing stuff" row, Maestro hierarchy reported `accessibilityText=Group chat with 3 people, Testing stuff, Collab session, Marcus Rivera: Locked in...`; `tapOn: text: ".*Testing stuff.*"` opened the chat. Use the chat-name regex first, then the subtitle regex only if the row summary changes.

**VERIFIED PROBLEM:** `tapOn: text: "Testing stuff"` failed in 2026-05-23 driving — Maestro reports "Element with Text matching regex: Testing stuff not found." Workaround that DOES work: `tapOn: text: ".*Locked in.*"` matches the row's subtitle. The session row's title is likely rendered as a non-accessibility-text element.

## 6. Pair-with-someone sheet (1-on-1 pairing)

**Screen:** Bottom sheet
**Detected by:** "Pair with someone" header, "YOUR FRIENDS" section, "PAIR BY PHONE" section.

**Already-paired friends:** show with a green "Paired" pill — no tap action.
**Unpaired friends:** tapping the row sends a pair-invite.
**Pair by phone:** enter phone number → "Enter phone number" CTA at bottom.

**Selectors:**
- Close sheet: `tapOn: id: "close-button"` or `tapOn: point: "92%,18%"` (the X in upper-right).
- Friend row: `tapOn: text: "<Friend name>"`.
- Phone input: `tapOn: text: "Phone number"` then `inputText: "<digits>"`.

**Screenshot reference:** `screenshots/pair_with_someone_sheet.png`

**Gotcha:** Sheet has a 200ms slide-up animation. After `tapOn` to open, `waitForAnimationToEnd` before targeting inner elements.

## 7. Create-group-chat sheet

**Screen:** Bottom sheet
**Detected by:** "Create group chat" or "New group chat" header.
**Action contract:** Pick friends to add → name the chat → tap "Create". Closes the sheet and routes to the new MessageInterface.

**Selectors:** TBD — need to capture on a live run.

**Screenshot reference:** `screenshots/create_group_chat_sheet.png` (TBD)

## 8. MessageInterface (group chat shell)

**Screen:** Full-screen chat view
**Detected by:** Chat name in header, back chevron, message list, composer at bottom.

**Screenshot:** `screenshots/messageinterface_testing_stuff.png`

### Header area (post-META, session-linked group chat)

- **Back chevron** (top-left): returns to Friends tab.
- **Avatar group icon + title** (centered): tap opens session options.
- **Subtitle:** "<N> members · Collab session".
- **Dropdown chevron** (top-right): session menu (leave session, options, etc).

### Sub-tab pills (the new META-ORCH-0929 surface)

Below the header, three pills appear when the chat is a session-linked group chat. They open compact bottom sheets / modals — NOT navigation tabs:

| Pill | Opens | Verified selector |
|---|---|---|
| **Matches** | `SavedToSessionCardsSheet` — compact bottom sheet showing locked-in cards | `tapOn: text: "Matches"` — works; defaults active. |
| **Swipe** | `CollabDeckSheet` — full-screen modal with the deck | **ORCH-0931 verified 2026-05-23:** `tapOn: text: "Swipe <chat title>"`, e.g. `tapOn: text: "Swipe Testing stuff"`, opens the sheet. Generic form: `tapOn: text: "Swipe .*"`. Maestro hierarchy shows `accessibilityText=Swipe Testing stuff`; visible text-only `Swipe` is not the reliable target. |
| **Plans** | `ScheduleSheet` — bottom sheet with locked-in plans | `tapOn: text: "Plans"` — not yet verified. |

**ORCH-0931 selector evidence:** `app-mobile/src/components/MessageInterface.tsx` renders the compact action row with `accessibilityLabel={`${action.label} ${headerTitle}`}`. `StartSwipingHeaderButton.tsx` currently has no import sites in `app-mobile/src` and is not the live action-row owner.

### Composer

- Text input at bottom: `tapOn: text: "Type a message"` then `inputText: "<msg>"`.
- Send button (paper-plane icon, top-right of composer).
- Attach icon (paperclip, top-left of composer).

### Message list (Matches view = default for session-linked chats)

Shows saved/locked-in cards rendered as card-preview message rows. Each row shows place image + name + "→ <stop2 name>" + "<N> stops" badge + "Tap to view" footer. Time separators (Yesterday, Today) divide groups.

## 9. CollabDeckSheet (chat-mounted collab deck — post-META-ORCH-0929)

This is the ONLY collab deck surface as of META-ORCH-0929. Home page has no collab deck anymore.

**Screen:** Full-screen modal slide-up
**Detected by:** "Swipe cards" header (white bg per current implementation), settings-gear top-right, deck content below.

### Header

- Chevron-down (top-left): dismisses sheet, returns to MessageInterface.
- Title: "Swipe cards" or session name.
- Settings gear (top-right): opens PreferencesSheet for this session.

### Deck states

- **Cards available:** stacked card UI with image + title + meta. Tap card for expansion.
- **Dead-end (intersection_empty):** "You are too far apart" headline, "Try increasing travel time…" subtitle, orange "Shift preferences" CTA.
- **Empty / Exhausted:** "Seen everything" or "No matches" headline + "Shift preferences" + (exhausted only) "Review all cards" outline button.

**Selectors:**
- Open prefs from deck: `tapOn: text: "Shift preferences"` OR settings-gear top-right.
- Dismiss sheet: `tapOn: id: "deck-sheet-close"` or chevron tap by coordinate near `15%,7%`.

**Screenshot reference:** `screenshots/collab_deck_sheet_dead_end.png` (captured earlier this session) + `screenshots/collab_deck_sheet_cards.png` (TBD)

**KNOWN BUG (ORCH-0929-legibility):** The dead-end title + subtitle render WHITE on the white sheet background — invisible. Reported as bug 2 in product direction sequencing. Test plan must account for invisible-text states (use metro log + state probe, not just screenshot inspection).

## 10. PreferencesSheet (collab branch — chat-mounted)

**Screen:** Bottom sheet (~70% height)
**Detected by:** "<Session name> Vibes" header, "Your picks for this session" subhead.

### Sections (top-down)

1. **Where should we look, and when?**
   - "Use my current location" toggle (default off in collab — uses custom_location).
   - Location chip (orange pill with location pin icon + truncated address + X clear button).
   - Date options pills: "Today", "This Weekend", "Pick Date(s)".

2. **See curated experiences?** (toggle on/off)
   - Intent pills: Romantic, First Dates, Group Fun, Adventurous, Picnic Dates, Take a Stroll.
   - Selected pills are filled orange; unselected are outline.

3. **See popular options?** (toggle on/off)
   - Category pills: Play, Icebreakers, Nature & Views, Drinks & Music, Creative & Arts, Movies, Theatre, Brunch, Casual, Fine Dining.

4. **How are you rolling?**
   - Travel mode pills: Walk, Bike, Bus, Drive.

5. **How far?**
   - Travel time pills: 15 min, 30 min, 45 min, 60 min.
   - "Set your own" toggle below for custom value.

### Bottom CTAs

- **"Lock It In (<N>)"** primary button — N is the change count. Disabled if zero changes (button reads "No changes to save").
- **"Start Over"** secondary outline button — resets to saved values.

**Selectors:**
- Toggle a pill: `tapOn: text: "<exact pill text>"` (e.g., "Brunch", "Drive", "45 min").
- Lock in: `tapOn: text: ".*Lock It In.*"` (regex — text includes change count).
- Start over: `tapOn: text: "Start Over"`.
- Location field clear: `tapOn: id: "location-chip-clear"` OR coordinate near the X in the chip.
- Location search input: `tapOn: id: "location-search-input"` then `inputText: "<city>"`.
- Address dropdown suggestion: appears below input after typing. `tapOn: text: "<full address>"` to commit + set selectedCoords.

**Screenshot references:**
- `screenshots/prefs_sheet_top.png`
- `screenshots/prefs_sheet_categories.png`
- `screenshots/prefs_sheet_travel.png`

**Gotchas:**
- **Bug 3 (ORCH-0930-coord-corruption):** Typing in the location search WITHOUT tapping a suggestion from the autocomplete dropdown leaves `selectedCoords` stale (from initially-loaded prefs). Save writes the new TEXT label but the OLD coordinates. To force a coord update, ALWAYS tap a dropdown suggestion after typing.
- **Auto-debounce vs Apply:** Current sheet still has an Apply button (Lock It In). Post-redesign per product direction, this becomes per-field auto-save.
- **"No changes to save" trap:** If the form state matches loaded prefs (even when those prefs have corrupt text/coord mismatch), Lock It In is a no-op. Workaround for testing: tap the location chip X to clear, then re-enter — that forces a change-detect.

## 11. Solo deck (Home / Explore tab)

Post-META-ORCH-0929 the Explore tab is solo-only. No collab pill, no session bar.

**Screen:** Full-screen deck
**Detected by:** Tab bar at bottom with Explore active (orange filled circle), settings-icon top-left, no session pills.

### Deck states (same as CollabDeckSheet but solo-aggregated)

- **Cards:** swipe left = dismiss, swipe right = save, swipe down = expand details.
- **Dead-end:** "no matches" / "seen everything" / "you are too far apart" (solo doesn't typically hit the last one since only one circle exists).

### Header

- **Settings-sliders icon top-left:** opens solo PreferencesSheet.
- **Bell icon top-right:** notifications.

**Selectors:** TBD — capture on live run.

**Gotcha:** Solo deck still uses `useDeckCards({ mode: 'solo' })` which is independent of the collab realtime channel. ORCH-0926 doesn't affect solo.

## 12. Likes tab

Post-saved + liked + match cards. Sub-tabs typically.

**Selectors:** TBD.

## 13. Profile tab

Account info, settings, sign-out, paywall.

**Selectors:** TBD.

## 14. Auth flows

### Sign-in (Google / Apple)

**Trigger:** App launched without a stored session → onboarding intro → sign-in screen.

**Selectors:**
- Google: `tapOn: text: "Continue with Google"` — opens GoogleSignIn native sheet (Maestro cannot easily drive native pickers; consider idb or operator-driven).
- Apple: `tapOn: text: "Continue with Apple"` — Apple's biometric prompt cannot be Maestro-driven; operator-driven.

**Sign-in shortcut for testing:** Use a sim that's already been signed in once. The session restores on next launch (via `supabase.auth.getSession()` reading AsyncStorage). No re-auth needed unless tokens expired.

### Sign-out

**Path:** Profile tab → Settings → Sign Out (or equivalent).

**Selector:** TBD — capture on live run.

## 15. Push + deep links

### Simulate a session-invite push

```bash
cat > /tmp/test_push.apns <<'EOF'
{
  "Simulator Target Bundle": "com.mingla.app.v2",
  "aps": {
    "alert": "<Inviter> invited you to <Session>",
    "badge": 1,
    "sound": "default"
  },
  "type": "session_invite",
  "session_id": "<UUID>",
  "inviter_user_id": "<UUID>"
}
EOF
xcrun simctl push <UDID> com.mingla.app.v2 /tmp/test_push.apns
```

**Expected behavior post-META-ORCH-0929:** tapping the push lands the user in the Friends tab → MessageInterface for the inviter's chat (NOT directly in CollabDeckSheet).

## 16. Multi-sim coordination recipes

### Recipe — Two sims, same session, change pref on A, watch B

```bash
# Prereq: both sims signed in to different accounts that share an active group-chat session.
# 1. Capture baseline log marker
echo "=== T0 $(date +%s) ===" >> /tmp/expo_metro.log

# 2. Drive sim A: open chat → open prefs → change travel time → save
~/.maestro/bin/maestro --device <UDID_A> test /tmp/flow_change_pref.yaml

# 3. Wait for realtime propagation
sleep 2

# 4. Grep for delivery signal in metro log
grep -c "onSessionUpdated fired" /tmp/expo_metro.log
# Expected: ≥1 if ORCH-0926 fix works, 0 if bug-1 still alive

# 5. Screenshot sim B to see if deck refetched
xcrun simctl io <UDID_B> screenshot /tmp/sim_b_post_change.png
```

### Recipe — Three-participant overlap stress test

1. Sim A → GPS set to Raleigh.
2. Sim B → GPS set to DC (same as A's session-stored custom_location for testing geographic intersection).
3. Dev build / 3rd account → GPS set to Lagos (out of overlap).
4. All three open the shared session in MessageInterface → CollabDeckSheet.
5. Expected: dead-end "you are too far apart" on all three because Lagos circle doesn't overlap.
6. Move Lagos device → DC via `xcrun simctl location set`.
7. Expected: within ~1s, all three CollabDeckSheets refetch and show real cards (if ORCH-0926 healed bug 1).

## 17. DB probes (read-only)

When testing realtime delivery, the source of truth is the DB. Probe via Supabase Management API direct SQL endpoint (no MCP — broken in current Claude session):

```bash
PROJECT_REF="gqnoajqerqhnvulmnyvv"
TOKEN=$(grep -o '"sbp_[a-zA-Z0-9_]\{20,\}"' ~/.claude.json | head -1 | tr -d '"')
curl -s -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"SELECT deck_version, updated_at, deck_params_hash, (SELECT r->'intersection_empty' FROM (SELECT public.pg_aggregate_collab_prefs('<SESSION_UUID>'::uuid) AS r) x) AS ie FROM collaboration_sessions WHERE id='<SESSION_UUID>'\"}"
```

Useful queries:
- `pg_aggregate_collab_prefs(session_id)` — what the deck server sees.
- `session_deck_versions` — version history with aggregated_params snapshots.
- `session_deck_cards` — frozen cards per position.
- `session_participants` — who's in the session + current_position.

## 18. Metro log conventions (diagnostic markers)

Standard prefixes used in this codebase:

| Prefix | Meaning |
|---|---|
| `[ORCH-XXXX-DIAG]` | Diagnostic logging tied to a specific ORCH; reaped at CLOSE Step 1.5. Search to verify a fix's runtime path. |
| `[REALTIME]` | `realtimeService.ts` subscribe / unsubscribe / event logs. |
| `[HEALTH_MONITOR]` | Session-pills health check from `RecommendationsContext.tsx`. |
| `[AUTH]` | `useAuthSimple.ts` flow logs. |
| `[STORE]` | Zustand store mutation logs. |
| `[QUERY]` | React Query success/error logs. |
| `[SESSION_PILLS]` | Pill bar load / select logs. |

Filter by sim by checking which app instance the log came from — both sims log to the SAME `/tmp/expo_metro.log` when connected to the same Metro instance. Distinguish by user_id in the log line.

## 19. Test scenario library (cookbook)

These are full recipes for common test scenarios. Copy + paste + run.

### Scenario 1 — Bug-1 realtime delivery verification (the ORCH-0926 outcome question)

See §16 "Recipe — Two sims, same session, change pref on A, watch B." If `onSessionUpdated fired` count increments by ≥1 → bug 1 healed.

### Scenario 2 — Bug-3 coord-corruption reproduction

1. Open PreferencesSheet collab branch.
2. Tap location chip X to clear.
3. Type "Washington DC" in search.
4. Wait for autocomplete dropdown.
5. **DO NOT TAP A SUGGESTION.**
6. Tap "Lock It In".
7. Probe DB: `participant_prefs->'<user_id>'->'custom_location'` should be "Washington DC" but `custom_lat/lng` should still be the OLD coordinates → bug reproduced.

### Scenario 3 — Original 3-person dead-end stuck

See §16 "Recipe — Three-participant overlap stress test."

### Scenario 4 — Solo deck refresh on prefs change

1. Open Explore tab (solo deck).
2. Tap settings-sliders top-left to open solo PreferencesSheet.
3. Change a category.
4. Tap Apply.
5. Expected: deck refetches and surfaces different cards.
6. Verify via metro log: `[QUERY] success deck-cards.solo…` should appear with new data.

### Scenario 5 — Sign-out clears realtime

1. While signed in to a session, confirm `board_session:<id>` channel is active.
2. Sign out via Profile → Sign Out.
3. Verify `unsubscribeAll` fires in metro log: `[REALTIME] unsubscribing from channel: …` for all channels.
4. Re-sign in.
5. Verify `realtime.setAuth` called with new token; channels resubscribe.

### Scenario 6 — Token refresh rebind

Hard to drive without 1-hour wait for token expiry. Codex can simulate via `supabase.auth.refreshSession()` exposed in a dev-only entry point — TBD if such a hook exists. Otherwise operator manually.

## 20. Known issues / things this doc doesn't yet cover

- Maestro `inputText` autocorrect bypass — needs idb fallback recipe for hardware-keypress reproducer tests.
- Android emulator selector map — entirely TODO. Mirror this doc when an AVD is booted.
- Webview / OAuth screens — Maestro can't deeply drive system webviews.
- Native picker sheets (Google sign-in, Apple sign-in, photo picker) — operator-driven.
- Network throttling / offline state — TBD via Network Link Conditioner or charles-proxy.

## 21. Update protocol

When you discover a new selector, screen, or gotcha:

1. Add it to the relevant section here.
2. Capture a screenshot to `screenshots/` with a descriptive filename.
3. Update the coverage status at the top of this doc.
4. If a previously-documented selector is now broken (UI change), mark the old entry `[DEPRECATED — <date> — <reason>]` and add the new selector below.

This doc is intentionally append-mostly. Old test recipes that still parse cleanly are useful evidence even when superseded by newer flows.
