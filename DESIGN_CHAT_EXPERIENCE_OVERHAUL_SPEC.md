# Design Spec: Chat Experience Overhaul & Friends Modal
**Date:** 2026-03-12
**Designer:** UX Designer (AI)
**Status:** Ready for Engineering

---

## 1. Overview

Transform Mingla's chat experience from a functional messaging interface into a premium, instant communication platform that rivals iMessage and Telegram. This overhaul addresses five pain points: (1) the friend request modal is too narrow — users need a full friends hub, (2) messages feel slow — they must arrive in <1 second, (3) no presence awareness — users can't tell if someone is online or typing, (4) message density is too loose — too much whitespace between bubbles and between keyboard and input, (5) the overall feel lacks polish — no animations, no grouped messages, no read receipts.

The emotional design goal: **confident connection**. When a user opens a chat, they should feel like they're having a real-time conversation with someone who's right there. Not sending letters into a void.

---

## 2. Success Metrics

| Metric | Type | Current | Target |
|--------|------|---------|--------|
| Message delivery perception (time to appear) | Primary | ~2-3s | <500ms |
| Messages visible per screen (density) | Primary | ~5-6 | ~8-10 |
| Chat session duration | Secondary | baseline | +25% |
| Friends modal engagement (open rate) | Secondary | baseline | +40% |
| Input-to-keyboard gap (px) | Guardrail | ~24px | ≤8px |

---

## 3. User Flow

### 3.1 Friends Modal Flow
```
[Chat List Screen] → (Tap friends icon in header) → [Friends Modal]
  ├── [Friends Tab] (default)
  │     ├── (Tap friend row) → [Message Interface with that friend]
  │     ├── (Swipe left on friend) → [Action panel: Mute | Block | Report | Remove]
  │     └── (Long press friend) → [Action sheet: Message | Mute | Block | Report | Remove]
  └── [Requests Tab]
        ├── (Tap Accept) → [Request accepted, row animates to "Accepted" state]
        └── (Tap Decline) → [Request declined, row fades out]
```

### 3.2 Chat Message Flow
```
[Chat List] → (Tap conversation) → [Message Interface]
  Header: [Back] [Avatar + Name + Status] [More ⋯]
  Content: [Messages (scrollable, pull-to-load-more)]
  Footer: [Attachment ＋] [Text Input] [Send ▶]
```

---

## 4. Screen Specifications

### 4.1 Friends Modal

#### Layout
```
┌─────────────────────────────────┐
│ ━━━━ (drag handle)              │  paddingTop: 12, height: 4
├─────────────────────────────────┤
│ Tab Bar                         │  height: 44
│  [● Friends (24)]  [Requests (3)] │
├─────────────────────────────────┤
│ Search Bar (Friends tab only)   │  height: 40, marginH: 16, marginV: 8
├─────────────────────────────────┤
│ Friend List (scrollable)        │
│                                 │
│  ┌─ Friend Row ───────────────┐ │  height: 60
│  │ [Avatar+dot] Name          │ │
│  │              Last seen...  │ │
│  └────────────────────────────┘ │
│  ┌─ Friend Row ───────────────┐ │
│  │ ...                        │ │
│  └────────────────────────────┘ │
│                                 │
└─────────────────────────────────┘
```

#### Tab Bar Specification

| Property | Value |
|----------|-------|
| Height | 44px |
| Background | `colors.background.primary` (#FFFFFF) |
| Border bottom | 1px `colors.gray[100]` (#F3F4F6) |
| Tab padding | horizontal: `spacing.md` (16px) |
| Active tab text | `typography.sm` (14px), `fontWeights.semibold` (600), `colors.primary[500]` (#f97316) |
| Inactive tab text | `typography.sm` (14px), `fontWeights.medium` (500), `colors.text.tertiary` (#6b7280) |
| Active indicator | 2px bottom border, `colors.primary[500]`, width matches text, `radius.full` ends |
| Tab badge | minWidth: 18, height: 18, `radius.full`, `colors.primary[500]` bg, white text, `typography.xs` (12px), `fontWeights.bold` |
| Tab switch animation | 200ms ease-out, indicator slides horizontally |
| Haptic | `ImpactFeedbackStyle.Light` on tab switch |

#### Friend Row Specification

| Property | Value |
|----------|-------|
| Height | 60px |
| Padding | horizontal: `spacing.md` (16px), vertical: 0 (vertically centered) |
| Avatar | 42×42px, `radius.full`, colored background (existing `getAvatarColor`) |
| Online dot | 12×12px, `colors.success[500]` (#22c55e), 2px white border, positioned bottom-right of avatar |
| Name | `typography.sm` (14px), `fontWeights.semibold` (600), `colors.text.primary` (#111827) |
| Status text | `typography.xs` (12px), `fontWeights.regular` (400), `colors.text.tertiary` (#6b7280) |
| Status text values | Online: "Online" in `colors.success[600]` (#16a34a) · Typing: "typing..." in `colors.primary[500]` · Offline: "Last seen Mar 12, 2:34 PM" |
| Separator | 0.5px `colors.gray[100]`, left-inset 70px (clears avatar) |
| Press state | backgroundColor fades to `colors.gray[50]` (#f9fafb), 100ms |
| Haptic on press | `ImpactFeedbackStyle.Light` |

#### Swipe-to-Reveal Actions

| Property | Value |
|----------|-------|
| Reveal distance | 200px (shows all 4 actions) |
| Partial swipe threshold | 80px (snaps open or closed) |
| Action button width | 50px each |
| Action 1 (Mute) | Icon: `volume-mute-outline` / `volume-high-outline`, bg: `colors.gray[100]`, icon color: `colors.gray[600]` |
| Action 2 (Block) | Icon: `ban-outline`, bg: `colors.warning[50]`, icon color: `colors.warning[600]` |
| Action 3 (Report) | Icon: `flag-outline`, bg: `colors.error[50]`, icon color: `colors.error[500]` |
| Action 4 (Remove) | Icon: `person-remove-outline`, bg: `colors.error[100]`, icon color: `colors.error[600]` |
| Action icon size | 20px |
| Action label | `typography.xs` (12px) below icon, 2px gap |
| Animation | Spring damping: 0.8, stiffness: 300 |
| Haptic | `ImpactFeedbackStyle.Medium` when actions fully revealed |

#### Search Bar (Friends Tab)

| Property | Value |
|----------|-------|
| Height | 36px |
| Background | `colors.gray[50]` (#f9fafb) |
| Border | 1px `colors.gray[200]` (#e5e7eb) |
| Border radius | `radius.md` (12px) |
| Padding horizontal | `spacing.sm` (8px) + 20px for search icon |
| Search icon | Feather `search`, 16px, `colors.gray[400]` |
| Placeholder | "Search friends" in `colors.gray[400]` |
| Text | `typography.sm` (14px), `colors.text.primary` |
| Margin | horizontal: `spacing.md` (16px), vertical: `spacing.sm` (8px) |
| Focus state | border color transitions to `colors.primary[300]`, 150ms |

#### Requests Tab

Reuses existing `FriendRequestsModal` request item layout with these refinements:

| Property | Change from current |
|----------|-------------------|
| Request item height | 64px (down from variable) |
| Avatar | 40×40px, `radius.sm` (8px) — matches current |
| Accept button | 36×36px circle, `colors.primary[500]` bg, white checkmark 18px |
| Decline button | 36×36px circle, `colors.gray[100]` bg, `colors.gray[500]` X icon 18px |
| Gap between items | `spacing.xs` (4px) — tighter than current 12px |
| Timestamp | Right-aligned, `typography.xs`, `colors.text.tertiary` |
| Accepted state | Row bg: `colors.success[50]`, slide left + fade out after 1.2s |
| Declined state | Row bg: `colors.error[50]`, slide left + fade out after 1.2s |

---

### 4.2 Chat Header (Message Interface)

#### Layout
```
┌─────────────────────────────────────────┐
│ [←]  [Avatar] Name              [⋯]    │  height: 56
│              Online / typing... / Last   │
└─────────────────────────────────────────┘
```

| Property | Value |
|----------|-------|
| Height | 56px (down from current ~64px) |
| Background | `colors.background.primary` |
| Bottom border | 0.5px `colors.gray[200]` |
| Back button | 44×44px touch target, Ionicons `chevron-back` 24px, `colors.text.primary` |
| Avatar | 36×36px, `radius.full`, same color generation |
| Online dot on avatar | 10×10px, `colors.success[500]`, 1.5px white border |
| Name | `typography.md` (16px), `fontWeights.semibold`, `colors.text.primary`, 1 line max |
| Status line | `typography.xs` (12px), single line, directly below name, gap: 1px |
| Status: Online | Text "Online", color: `colors.success[600]` (#16a34a) |
| Status: Typing | Animated "typing" + 3 bouncing dots |
| Status: Offline | "Last seen [relative time or date]", color: `colors.text.tertiary` |
| More button | 44×44px touch target, Ionicons `ellipsis-horizontal` 20px, `colors.text.secondary` |

#### Typing Indicator Animation (Header)

```
"typing" text + 3 dots that bounce sequentially:
  Dot 1: translateY oscillates 0 → -3 → 0, duration 400ms, delay 0ms
  Dot 2: translateY oscillates 0 → -3 → 0, duration 400ms, delay 133ms
  Dot 3: translateY oscillates 0 → -3 → 0, duration 400ms, delay 266ms
  Loop: infinite, ease-in-out
  Dot size: 3×3px, radius.full, colors.primary[500]
  Dot spacing: 2px gap
  Text "typing" in colors.primary[500], typography.xs, fontWeights.medium
```

---

### 4.3 Message Bubbles — Compact Premium Design

#### Message Grouping Rules

Messages from the same sender within 2 minutes of each other form a **group**:
- **First message in group:** Full border radius (16px all corners) + sender-side tail
- **Middle messages in group:** Reduced radius on sender side (4px) for visual stacking
- **Last message in group:** Reduced radius on sender side top (4px), full on bottom
- **Solo message (not grouped):** Full radius + tail
- **Timestamp:** Shown only on the first message of each time cluster (>5 min gap between clusters)

#### Bubble Dimensions

| Property | Sent (Right) | Received (Left) |
|----------|-------------|-----------------|
| Background | `colors.primary[500]` (#f97316) | `colors.gray[100]` (#f3f4f6) |
| Text color | `colors.text.inverse` (#FFFFFF) | `colors.text.primary` (#111827) |
| Text size | `typography.md` (16px) | `typography.md` (16px) |
| Line height | 21px (tighter than default 24px) |  21px |
| Padding horizontal | 12px | 12px |
| Padding vertical | 8px | 8px |
| Max width | 78% of screen | 78% of screen |
| Border radius (solo) | topLeft: 16, topRight: 16, bottomLeft: 16, bottomRight: 4 | topLeft: 4, topRight: 16, bottomLeft: 16, bottomRight: 16 |
| Border radius (first in group) | topLeft: 16, topRight: 16, bottomLeft: 16, bottomRight: 4 | topLeft: 4, topRight: 16, bottomLeft: 16, bottomRight: 16 |
| Border radius (middle in group) | topLeft: 16, topRight: 4, bottomLeft: 16, bottomRight: 4 | topLeft: 4, topRight: 16, bottomLeft: 4, bottomRight: 16 |
| Border radius (last in group) | topLeft: 16, topRight: 4, bottomLeft: 16, bottomRight: 16 | topLeft: 4, topRight: 16, bottomLeft: 16, bottomRight: 16 |

#### Message Spacing

| Spacing Context | Value | Current | Savings |
|----------------|-------|---------|---------|
| Between messages in same group | 2px | 16px | 14px |
| Between different sender groups | 12px | 16px | 4px |
| Between time clusters (>5 min) | 24px (with timestamp) | 16px | +8px (but adds timestamp) |
| Container padding horizontal | 12px | 16px | 4px |
| Bubble internal padding | 8px vertical, 12px horizontal | 12px all | ~4px |

#### Timestamp Display

| Property | Value |
|----------|-------|
| Position | Centered above first message in time cluster |
| Font | `typography.xs` (12px), `fontWeights.regular`, `colors.text.tertiary` |
| Margin | top: 16px, bottom: 8px |
| Format (today) | "2:34 PM" |
| Format (this week) | "Tue 2:34 PM" |
| Format (older) | "Mar 10, 2:34 PM" |
| Background | `colors.gray[50]` pill, paddingH: 10px, paddingV: 3px, `radius.full` |

#### Read Receipts

| Property | Value |
|----------|-------|
| Position | Below the last sent message in a group, right-aligned |
| Margin top | 2px |
| Icon (sent) | Single check, 12px, `colors.gray[400]` |
| Icon (delivered) | Double check, 12px, `colors.gray[400]` |
| Icon (read) | Double check, 12px, `colors.primary[500]` |
| Text alternative | "Read [time]" for last message, `typography.xs`, `colors.text.tertiary` |

#### Image/Video in Bubbles

| Property | Value |
|----------|-------|
| Max width | 240px |
| Max height | 300px |
| Border radius | Same as parent bubble, inner content clips to 12px |
| Padding when media-only | 3px (near edge-to-edge within bubble) |
| Padding when media + text | text: 8px padding, media: 3px padding, 4px gap between |

---

### 4.4 Message Input Bar — Compact & Keyboard-Hugging

#### Layout
```
┌─────────────────────────────────────────┐
│ [＋]  [Type a message...        ] [▶]   │  minHeight: 44
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│            KEYBOARD                     │
```

**Critical: 0px gap between input bar bottom and keyboard top.**

| Property | Value |
|----------|-------|
| Container background | `colors.background.primary` |
| Container border top | 0.5px `colors.gray[200]` |
| Container padding | top: 6px, bottom: safe area inset (or 6px if keyboard open), horizontal: 8px |
| Attachment button | 36×36px, `colors.gray[100]` bg, `radius.full`, Ionicons `add` 22px `colors.gray[600]` |
| Attachment pressed | bg: `colors.gray[200]`, 100ms |
| Input field | flex: 1, minHeight: 36px, maxHeight: 100px (4 lines), `colors.gray[50]` bg, `radius.lg` (16px) |
| Input padding | horizontal: 14px, vertical: 8px |
| Input text | `typography.md` (16px), `colors.text.primary`, lineHeight: 21px |
| Input placeholder | "Message..." in `colors.gray[400]` |
| Send button (inactive) | 36×36px, `colors.gray[200]` bg, `radius.full`, Ionicons `arrow-up` 20px `colors.gray[400]` |
| Send button (active) | 36×36px, `colors.primary[500]` bg, `radius.full`, Ionicons `arrow-up` 20px white |
| Send button transition | backgroundColor + scale spring (0.95 → 1.0), 150ms ease-out |
| Gap between elements | 6px |
| Haptic on send | `ImpactFeedbackStyle.Light` |

#### Keyboard Integration (Critical for compactness)

The input bar MUST use `Animated.View` with `marginBottom` tracking keyboard height precisely:
- **iOS:** Listen to `keyboardWillShow`/`keyboardWillHide`, animate marginBottom to match `event.endCoordinates.height` minus tab bar safe area. Duration matches keyboard animation (`event.duration`, typically 250ms).
- **Android:** Listen to `keyboardDidShow`/`keyboardDidHide`. Set `android:windowSoftInputMode="adjustResize"` in manifest. Input bar auto-repositions with layout.
- **Key fix from current:** Remove the `paddingTop: 12, paddingBottom: 12` on `inputArea`. Replace with `paddingVertical: 6`. This eliminates ~12px of dead space.
- **Key fix from current:** The keyboard height interpolation currently has `outputRange: [0, 0, 384]` with an artificial 16px dead zone. Remove the dead zone — output should exactly match input.

---

### 4.5 Message Animations

#### Send Animation
```
INTERACTION: Send Message
TRIGGER: Tap send button (or press Enter on hardware keyboard)
FEEDBACK:
  - Haptic: ImpactFeedbackStyle.Light
  - Visual: Send button scales 0.85 → 1.0 (spring, damping 0.7)
  - Message bubble: opacity 0 → 1, translateY 20 → 0, duration 200ms, ease-out
RESULT: Message appears instantly as optimistic update
```

#### Receive Animation
```
INTERACTION: New Message Arrives
TRIGGER: Broadcast event received
FEEDBACK:
  - Haptic: none (to avoid buzzing during active conversation)
  - Visual: opacity 0 → 1, translateY 8 → 0, duration 250ms, ease-out
  - Auto-scroll: if user is within 100px of bottom, smooth scroll to new message
  - If user has scrolled up: show "New message ↓" pill at bottom, don't auto-scroll
RESULT: Message appears in conversation
```

#### New Message Pill (when scrolled up)
| Property | Value |
|----------|-------|
| Position | Centered horizontally, 12px above input bar |
| Background | `colors.primary[500]` with 95% opacity |
| Text | "New message ↓", `typography.xs`, `fontWeights.semibold`, white |
| Padding | horizontal: 16px, vertical: 8px |
| Border radius | `radius.full` |
| Shadow | `shadows.md` |
| Tap action | Smooth scroll to bottom, pill fades out |
| Entry animation | translateY 20 → 0, opacity 0 → 1, 200ms ease-out |
| Haptic on tap | `ImpactFeedbackStyle.Light` |

#### Pull-to-Load-More
```
INTERACTION: Pull down at top of message list
TRIGGER: ScrollView reaches top + 60px overscroll
FEEDBACK:
  - Visual: ActivityIndicator appears at top, colors.primary[500]
  - Haptic: ImpactFeedbackStyle.Light when threshold reached
RESULT: Older messages prepended, scroll position maintained
```

---

## 5. Component Specifications

### 5.1 FriendsModal (replaces FriendRequestsModal)

```
COMPONENT: FriendsModal
TYPE: New (replaces FriendRequestsModal)
LOCATION: components/FriendsModal.tsx

PROPS:
  - isOpen: boolean — controls modal visibility
  - onClose: () => void — close callback
  - onMessageFriend: (friendId: string) => void — navigate to chat with friend

VARIANTS:
  - Friends tab (default): shows friend list with search + swipe actions
  - Requests tab: shows incoming friend requests with accept/decline

STATES:
  - loading: Skeleton rows (6 rows, 60px each, shimmer animation)
  - empty (friends): "No friends yet" + illustration + "Add friends" CTA
  - empty (requests): "All caught up" + inbox icon (existing pattern)
  - error: "Couldn't load friends — tap to retry"
  - success: Scrollable list

ACCESSIBILITY:
  - accessibilityLabel: "Friends and requests"
  - accessibilityRole: "none" (container)
  - Tab bar: accessibilityRole "tablist", each tab "tab"
  - Friend rows: accessibilityRole "button", accessibilityHint "Double tap to message"
  - Swipe actions: accessibilityActions with labels

STYLE TOKENS:
  - Modal height: SCREEN_HEIGHT * 0.88 (matches current)
  - Modal radius: 36px top corners (matches current)
  - Shadow: current shadow values (matches current)
  - Tab bar: new component within modal
```

### 5.2 MessageBubble (extracted component)

```
COMPONENT: MessageBubble
TYPE: New (extracted from inline render in MessageInterface)
LOCATION: components/chat/MessageBubble.tsx

PROPS:
  - message: Message — the message data
  - isMe: boolean — sent by current user
  - groupPosition: 'solo' | 'first' | 'middle' | 'last' — position in sender group
  - showTimestamp: boolean — whether to show time cluster header
  - isRead: boolean — whether recipient has read this message

STATES:
  - default: standard bubble render
  - pressed: opacity 0.7 (for long-press context menu)
  - sending: opacity 0.7 + subtle pulse (optimistic message)
  - failed: red border + retry icon

ACCESSIBILITY:
  - accessibilityLabel: "[Sender name] said: [message content], [timestamp]"
  - accessibilityRole: "text"

STYLE TOKENS:
  - See §4.3 bubble dimensions table
```

### 5.3 TypingIndicator

```
COMPONENT: TypingIndicator
TYPE: New
LOCATION: components/chat/TypingIndicator.tsx

PROPS:
  - isTyping: boolean
  - userName?: string (for group chats: "Alex is typing")

STATES:
  - hidden: renders null
  - visible: shows animated dots

ANIMATION:
  - Entry: fade in 150ms
  - Dots: 3 circles bouncing sequentially (see §4.2 spec)
  - Exit: fade out 150ms

STYLE TOKENS:
  - Dot size: 3×3px
  - Dot color: colors.primary[500]
  - Dot gap: 2px
  - Text: typography.xs, colors.primary[500]
```

### 5.4 ChatStatusLine

```
COMPONENT: ChatStatusLine
TYPE: New
LOCATION: components/chat/ChatStatusLine.tsx

PROPS:
  - isOnline: boolean
  - isTyping: boolean
  - lastSeenAt: string | null
  - typingUserName?: string (for group chats)

STATES:
  - online: green dot + "Online"
  - typing: animated typing indicator
  - offline: "Last seen [time]"

STYLE TOKENS:
  - Online dot: 6×6px, colors.success[500], radius.full
  - Online text: typography.xs, colors.success[600]
  - Typing: uses TypingIndicator component
  - Offline text: typography.xs, colors.text.tertiary
```

---

## 6. Interaction & Animation Specifications

### 6.1 Tab Switch in Friends Modal
```
INTERACTION: Tab Switch
TRIGGER: tap on inactive tab
FEEDBACK:
  - Haptic: ImpactFeedbackStyle.Light
  - Visual: Active indicator slides to new tab (200ms, ease-out)
  - Content: Cross-fade (150ms out, 150ms in)
RESULT: Tab content switches
```

### 6.2 Swipe-to-Reveal on Friend Row
```
INTERACTION: Swipe to reveal actions
TRIGGER: horizontal swipe left on friend row
FEEDBACK:
  - Haptic: ImpactFeedbackStyle.Medium when fully revealed
  - Visual: Row translates left, action buttons revealed from right
  - Spring: damping 0.8, stiffness 300
RESULT: 4 action buttons visible (Mute, Block, Report, Remove)
```

### 6.3 Accept Friend Request
```
INTERACTION: Accept friend request
TRIGGER: tap Accept button
FEEDBACK:
  - Haptic: notificationAsync(NotificationFeedbackType.Success)
  - Visual: Button morphs to green checkmark (200ms)
  - Row: background fades to colors.success[50], then slides left + fades out (800ms delay, 400ms animation)
RESULT: Friend request accepted, row removed from list
```

### 6.4 Message Send
```
INTERACTION: Send text message
TRIGGER: tap send button or hardware Enter
FEEDBACK:
  - Haptic: ImpactFeedbackStyle.Light
  - Visual: Send button scale 0.85→1.0 (spring 150ms)
  - Input clears instantly
  - Bubble appears with translateY 20→0, opacity 0→1 (200ms ease-out)
RESULT: Optimistic message in list, broadcast sent, DB write in parallel
```

---

## 7. Behavioral Design

### 7.1 Hook Cycle — Instant Messaging

```
TRIGGER:
  External: Push notification "Alex: hey, want to check out that new place?"
  Internal: Urge to connect, coordinate, share a discovery

ACTION:
  Open chat → type reply → send
  Friction: 2 taps to reply from notification (notification → chat → type)

VARIABLE REWARD:
  Type: Tribe (social connection)
  What varies: What did they say? Are they online? Will they reply fast?

INVESTMENT:
  Conversation history, shared plans, emotional connection
  → Makes next cycle more likely (internal trigger: "I wonder if Alex replied")
```

### 7.2 Presence as Social Proof

Showing online status creates a **social proof nudge**: "Alex is online right now" creates a subtle pull to engage. The green dot is small but psychologically powerful — it says "this person is available." Combined with typing indicators, it creates a sense of **co-presence** that makes digital conversation feel closer to in-person.

### 7.3 Delight Moments

```
DELIGHT MOMENT: Instant Message Arrival
WHERE: Message Interface, when a message arrives via broadcast
WHAT: Message appears instantly (<500ms) with a smooth slide-in animation
WHY: Visceral + Behavioral — the speed itself is the delight. Users who experience
     instant messaging feel "connected" (reflective level). The animation confirms
     the message is real and new (behavioral level).
IMPLEMENTATION:
  - Visual: translateY 8→0, opacity 0→1, 250ms ease-out
  - Haptic: None (to avoid interrupt during active typing)
  - Sound: None
  - Copy: N/A (the message content IS the delight)
```

```
DELIGHT MOMENT: Friend Request Accepted
WHERE: Friends Modal → Requests Tab
WHAT: Accept button morphs into a green checkmark, row glows success-green,
      then gracefully slides away
WHY: Peak-End Rule — the acceptance is a micro-celebration that rewards prosocial
     behavior and makes the user feel good about growing their network
IMPLEMENTATION:
  - Visual: Button morph (200ms), background glow (300ms), slide-out (400ms after 800ms delay)
  - Haptic: notificationAsync(Success)
  - Copy: None (the animation IS the confirmation)
```

---

## 8. Design Token Changes

### 8.1 New Tokens Proposed

| Token | Value | Justification |
|-------|-------|---------------|
| `spacing.xxs` | 2px | Needed for ultra-compact message grouping (2px gap between grouped bubbles). Current minimum is `xs` (4px) which is too much for message stacking. |
| `colors.chat.bubbleSent` | `colors.primary[500]` (#f97316) | Alias — no new color, just a semantic name for sent bubble background |
| `colors.chat.bubbleReceived` | `colors.gray[100]` (#f3f4f6) | Alias — semantic name for received bubble background |
| `colors.chat.timestampPill` | `colors.gray[50]` (#f9fafb) | Alias for timestamp cluster pill background |

Note: All new tokens are aliases of existing colors or a 2px extension of the spacing scale. No new color values introduced.

---

## 9. Accessibility Notes

- **Online status:** Never conveyed by color alone. Green dot is paired with "Online" text in header. Screen reader announces "Online" or "Last seen [time]".
- **Typing indicator:** Animated dots are decorative. Screen reader announces "typing" as accessibilityLabel.
- **Message bubbles:** Each bubble has accessibilityLabel combining sender, content, and timestamp.
- **Swipe actions:** Available via `accessibilityActions` for screen reader users who can't swipe.
- **Touch targets:** All buttons ≥ 36×36px with ≥ 8px spacing. Primary actions (Send, Accept) are 36-44px.
- **Reduced motion:** Users with `prefers-reduced-motion` see instant state changes instead of animations. Typing dots become static "..." text.
- **Contrast ratios:** All text meets WCAG AA. Orange (#f97316) on white: 3.3:1 (large text only — used only for accents/badges, never body text). White on orange: same. Body text uses #111827 on #FFFFFF: 15.4:1.

---

## 10. Copy Deck

### Friends Modal
| Element | Copy |
|---------|------|
| Tab 1 label | "Friends" |
| Tab 2 label | "Requests" |
| Search placeholder | "Search friends" |
| Empty friends | "No friends yet" |
| Empty friends subtitle | "People you connect with will appear here" |
| Empty friends CTA | "Find friends" |
| Empty requests | "All caught up" |
| Empty requests subtitle | "New friend requests will appear here" |
| Swipe: Mute | "Mute" |
| Swipe: Block | "Block" |
| Swipe: Report | "Report" |
| Swipe: Remove | "Remove" |
| Mute confirmation | "Muted. You won't get notifications from [name]." |
| Block confirmation | "Blocked. [name] can no longer message you." |
| Remove confirmation | "Are you sure you want to remove [name]?" |
| Report sheet title | "Report [name]" |

### Chat Interface
| Element | Copy |
|---------|------|
| Input placeholder | "Message..." |
| Status: online | "Online" |
| Status: typing | "typing" (+ animated dots) |
| Status: offline | "Last seen [relative/absolute time]" |
| New message pill | "New message ↓" |
| Pull to load | (ActivityIndicator only, no text) |
| Blocked state | "You can't message this person" |
| Empty chat | "Say something..." |
| Read receipt | "Read" (or just checkmark icons) |

---

## 11. Edge Cases & Open Questions

1. **Group chat typing:** When multiple people type simultaneously, show "Alex and 2 others are typing" — truncate at 1 name + count.
2. **Offline message queue:** Messages composed offline should show with a clock icon and "Sending..." status, then animate to sent state when connection restores.
3. **Long messages:** Messages over 500 characters should show full (no truncation in chat). Very long messages (>2000 chars) could show "Read more" but this is an edge case — defer unless it becomes a problem.
4. **Avatar images:** Current system uses initials + colored backgrounds. When profile photos are added later, the avatar component should handle both — no design change needed, just swap content.

---

## 12. Implementation Notes for Engineer

1. **Extract MessageBubble component** from the inline `renderMessage` in MessageInterface. The current 1809-line file is too large — bubble rendering should be its own component.
2. **Message grouping logic** is pure function: takes sorted messages array, returns groups. Implement as a utility, not inline in render.
3. **Keyboard gap fix:** The current `inputArea` style has `paddingTop: 12, paddingBottom: 12`. Change to `paddingVertical: 6`. The keyboard height interpolation should map 1:1 (remove the `[0, 16, 400] → [0, 0, 384]` dead zone).
4. **Reuse existing `useKeyboard` hook** instead of the manual keyboard listeners in MessageInterface. The hook already handles platform differences.
5. **Presence channel:** Extend `realtimeService.ts` patterns from board presence to DM presence. Use Supabase Realtime presence (not postgres_changes) for instant online/offline updates.
6. **Typing broadcast:** Same pattern as `broadcastTypingStart`/`broadcastTypingStop` in realtimeService — extend to DM conversation channels.
7. **FriendsModal:** Reuse `useFriends` hook data. The friends list, friend requests, block/mute/report actions all exist in the hook already.
