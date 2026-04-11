# ORCH-0386 Phase 3 — Investigation Report: Profile + Settings + Connections i18n

**Date:** 2026-04-11
**Confidence:** HIGH

---

## Layman Summary

The Profile, Settings, Connections, Saved Experiences, and Feedback screens have ~282 hardcoded English strings across 8 files. AccountSettings is the biggest (100+ strings — visibility modes, notification settings, delete flow, all the accordions). ConnectionsPage is second (~45 strings — chat, friend management, alerts). SavedExperiencesPage has ~40 strings (mostly filter/sort labels). The rest are smaller.

---

## String Inventory Summary

| File | Strings | Biggest Areas |
|------|---------|---------------|
| AccountSettings.tsx | ~100 | Accordion sections, visibility modes, notification settings, delete flow, pickers |
| ConnectionsPage.tsx | ~45 | Chat alerts, friend management, mute/block, search |
| SavedExperiencesPage.tsx | ~40 | Category filters, sort options, date ranges, search |
| ProfilePage.tsx | ~30 | Photo upload alerts, account section, sign out |
| BetaFeedbackModal.tsx | ~30 | Recording flow, categories, submit states |
| FeedbackHistorySheet.tsx | ~20 | Status labels, delete, playback, empty state |
| ViewFriendProfileScreen.tsx | ~15 | Profile sections, loading/error states |
| LikesPage.tsx | ~2 | Tab labels only ("Saved", "Calendar") |
| **TOTAL** | **~282** | |

---

## Recommended Namespace Structure

```
app-mobile/src/i18n/locales/en/
  profile.json          # ProfilePage + ViewFriendProfileScreen
  settings.json         # AccountSettings (biggest — visibility, notifications, delete flow, pickers)
  connections.json      # ConnectionsPage (chat, friend management, alerts)
  saved.json            # SavedExperiencesPage + LikesPage (filters, sort, tabs)
  feedback.json         # BetaFeedbackModal + FeedbackHistorySheet
```

### New common.json additions needed:

```json
{
  "ok": "OK",
  "remove": "Remove",
  "submit": "Submit",
  "play": "Play",
  "pause": "Pause",
  "loading": "Loading...",
  "sign_out": "Sign Out",
  "go_back": "Go back",
  "message": "Message",
  "take_photo": "Take Photo",
  "upload": "Upload",
  "privacy_policy": "Privacy Policy",
  "terms_of_service": "Terms of Service"
}
```

(Many like "cancel", "delete", "error", "try_again" already exist from Phase 2.)

---

## Key Edge Cases

1. **AccountSettings language picker** — has its own hardcoded 10-language list (ORCH-0387). Phase 3 should translate the labels but the underlying list unification is a separate fix.

2. **Visibility mode descriptions** — 3 modes with display labels AND descriptions. Both need translation.

3. **Delete account flow** — 4 distinct modal states (confirm, processing, success, error). Each has title + body + button labels. All need translation.

4. **ConnectionsPage is also the messaging interface** — contains chat-related strings (message sending errors, file upload errors, mute/unmute). These are profile-adjacent but part of the social flow.

5. **SavedExperiencesPage filter labels** — hardcoded arrays of category names, experience types, match scores, date ranges, sort options. All need extraction.

6. **Feedback recording flow** — BetaFeedbackModal has a multi-step flow (category → record → review → submit → success). Each step has distinct UI text.

7. **Pluralization** — FeedbackHistorySheet has `screenshot${count > 1 ? 's' : ''}` — needs i18next plural form.

---

## Recommended Implementation Order

1. common.json — add new shared keys
2. settings.json + AccountSettings.tsx — biggest file, highest visibility
3. profile.json + ProfilePage.tsx + ViewFriendProfileScreen.tsx
4. connections.json + ConnectionsPage.tsx — chat/friend management
5. saved.json + SavedExperiencesPage.tsx + LikesPage.tsx
6. feedback.json + BetaFeedbackModal.tsx + FeedbackHistorySheet.tsx

---

## Discoveries for Orchestrator

None new.
