# ORCH-0386 Phase 2 — Investigation Report: Home + Discover + Cards i18n

**Date:** 2026-04-11
**Confidence:** HIGH

---

## Layman Summary

The core app loop — Discover, Cards, Preferences, Share, Paywall — has ~207 hardcoded English strings across 9 files. This is smaller than initially estimated (~500) because HomePage delegates to child components, and card content (venue names, descriptions) comes from the API. The biggest files are DiscoverScreen (~48 strings), PreferencesSections (~44), and ExpandedCardModal (~35).

---

## String Inventory by File

### 1. app/index.tsx — Tab Bar + Navigation (7 strings)

| Line | String | Type |
|------|--------|------|
| 2247 | "Explore" | static — tab label |
| 2275 | "Discover" | static — tab label |
| 2314 | "Chats" | static — tab label |
| 2353 | "Likes" | static — tab label |
| 2410 | "Profile" | static — tab label |
| 1534 | "Sign-in Error" | static — Alert title |
| 1551 | "Error" / "Failed to complete sign-in: " | static — Alert title + prefix |

### 2. HomePage.tsx — (0 strings)

No hardcoded strings. Delegates entirely to child components.

### 3. DiscoverScreen.tsx — (48 strings)

| Area | Strings | Type |
|------|---------|------|
| Tab labels | "For you", "Night out" | static |
| Badges | "Featured", "On Sale", "Sold Out", "Soon" | static |
| Date filters | "Any Date", "Today", "Tomorrow", "This Weekend", "Next Week", "This Month" | static |
| Price filters | "Any Price" | static |
| Genre filters | "All Genres", "Afrobeats", "Dancehall / Soca", "Hip-Hop / R&B", "House / Electronic", "Techno / Electronic", "Jazz / Blues", "Latin / Salsa", "Reggae", "K-Pop", "Acoustic / Indie" | static |
| Filter modal | "Filters", "Date", "Price Range", "Music Genre", "Reset", "Apply Filters", "Filter" | static |
| Loading states | "Discovering experiences for you...", "Discovering nightlife near you..." | static |
| Error states | "Something went wrong" (x2) | static — shared |
| Empty states | "No experiences found", "Try adjusting your preferences...", "No events found", "No events found near your location...", "No matching events", "No events match your selected filters" | static |
| Buttons | "Try Again", "Retry", "Show All Parties" | static |
| Dynamic | "Showing: {{genre}}", "Delete \"{{name}}\"? This can't be undone." | interpolation |
| Alert buttons | "Cancel", "Delete", "Unpair" | static — shared |

### 4. SwipeableCards.tsx — (9 UI strings)

| Line | String | Type |
|------|--------|------|
| 1472 | "Curating your lineup" | static — loading state |
| 1674/1824 | "Nearby" | static — distance fallback |
| 1698/1848 | "Free" | static — price fallback |
| 1102/1383 | "Free" | static — price range fallback |
| 1814 | "Experience" | static — title fallback |

### 5. ExpandedCardModal.tsx — (35 strings)

| Area | Strings | Type |
|------|---------|------|
| Badges | "Customized", "Open Now", "Closed", "On Sale", "Sold Out", "Coming Soon", "Suggested" | static |
| Section headers | "Alternatives", "Weekly Hours", "Total Time Estimate", "Vibe", "Policies & Reservations" | static |
| Buttons | "Replace", "Select", "Get Directions" (x2), "More Details" / "Less Details", "Retry", "Undo" | static |
| Labels | " avg", "Date & Time", "Tickets", "per ticket", "Tickets Coming Soon" | static |
| States | "Finding alternatives...", "Couldn't load alternatives.", "No alternatives in this area", "No images available" | static |
| Dynamic | "Replace {{name}}", "{{stopMin}}min at stops · {{travelMin}}min travel", "Replaced {{name}}" toast, "Get Tickets – {{price}}" | interpolation |
| Accessibility | "Dismiss optional stop", "Collapse/Expand stop details" | static |

### 6. SwipeableBoardCards.tsx — (25 strings)

| Area | Strings | Type |
|------|---------|------|
| Headers | "Session Cards", "Why It's Perfect", "What Makes It Special", "Group Decision" | static |
| Badges | "Locked", "Locked In" | static |
| Status | "Added to Calendar", "RSVP'd Yes" / "RSVP Yes" | static/dynamic |
| Labels | "Location", "Budget", "Category", "Yes", "No", "Messages" | static — shared |
| Buttons | "Vote Yes", "Vote No" | static |
| States | "No cards in this session yet", "This activity has been locked and scheduled" | static |
| Dynamic | "1/{{total}}" (gallery counter), "Locked {{date}}", "{{responded}}/{{total}} responses" | interpolation |

### 7. PreferencesSections.tsx — (44 strings)

| Area | Strings | Type |
|------|---------|------|
| Section titles | "Set the Mood", "What Sounds Good?", "When", "Around What Time?", "Getting There" | static |
| Section questions | "What kind of outing are you feeling?", "When are you heading out?", "How are you rolling?" | static |
| Experience type descriptions | 6 descriptions (adventurous, first-date, romantic, group-fun, picnic-dates, take-a-stroll) | static |
| Category descriptions | 12 descriptions (nature, first_meet, picnic_park, drink, casual_eats, fine_dining, watch, live_performance, creative_arts, play, wellness, flowers) | static |
| Time slots | "Brunch", "Afternoon", "Dinner", "Late Night", "Anytime" | static |
| Weekend info | "This Weekend", "Friday through Sunday" | static |
| Validation | "3 max — drop one to add another.", "Pick at least one mood or category." | static |
| Locked feature | "Curated cards are locked on Free — upgrade to explore them" | static |
| Loading | "Setting the mood..." | static |
| Placeholder | "mm/dd/yyyy" | static |

### 8. PreferencesSectionsAdvanced.tsx — (8 strings)

| Line | String | Type |
|------|--------|------|
| 43 | "How Far?" | static — section title |
| 45 | "Set your travel radius" | static |
| 75 | "Set your own" | static |
| 105 | "5 – 120 minutes" | static — placeholder |
| 109 | "min" | static — unit |
| 160 | "Use my current location" | static |
| 194 | "Search for a starting spot..." | static — placeholder |
| 217/218 | GPS helper texts (2 variants) | static |
| 228 | "Pro feature — explore from anywhere" | static |
| 246 | "Searching..." | static |

### 9. ShareModal.tsx — (23 strings)

| Area | Strings | Type |
|------|---------|------|
| Header | "Share Experience" | static |
| Fallbacks | "Experience", "Nearby", "Amazing experience", "Afternoon", "Weekend", "This month" | static |
| Section | "Suggested Schedule", "Share to:" | static |
| Labels | "per person", "Mingla" | static |
| Sharing targets | "Messages", "WhatsApp", "Instagram", "Twitter", "More sharing options" | static |
| Buttons | "Copy link", "Copy Message" | static |
| Alerts | "Error" (x2), "Failed to copy message to clipboard", "Failed to share. Please try again." | static |
| Dynamic | "Check out {{title}} on Mingla!" | interpolation |

### 10. PaywallScreen.tsx — (8 strings)

| Line | String | Type |
|------|--------|------|
| 68 | "Purchase successful..." | static — toast |
| 99 | "Purchases restored..." | static — toast |
| 108 | "Purchases restored" | static — Alert title |
| 110 | "Your previous purchases have been restored successfully." | static — Alert body |
| 111 | "Done" | shared |
| 127 | "Purchase failed" | static — Alert title |
| 139 | "Close paywall" | static — accessibility |
| 160 | "Manage subscription" | static — button |

---

## Recommended Namespace Structure

```
app-mobile/src/i18n/locales/en/
  common.json          # UPDATE: add ~15 new shared keys
  discover.json        # NEW: DiscoverScreen + filters + nightlife
  cards.json           # NEW: SwipeableCards + ExpandedCardModal + SwipeableBoardCards
  preferences.json     # NEW: PreferencesSections + PreferencesSectionsAdvanced
  share.json           # NEW: ShareModal
  paywall.json         # NEW: PaywallScreen
  navigation.json      # NEW: Tab labels + navigation alerts
```

### New common.json additions needed:

```json
{
  "cancel": "Cancel",
  "delete": "Delete",
  "reset": "Reset",
  "retry": "Retry",
  "undo": "Undo",
  "select": "Select",
  "filter": "Filter",
  "search": "Search",
  "get_directions": "Get Directions",
  "open_now": "Open Now",
  "closed": "Closed",
  "free": "Free",
  "nearby": "Nearby",
  "location": "Location",
  "budget": "Budget",
  "category": "Category",
  "yes": "Yes",
  "no": "No",
  "messages": "Messages",
  "try_again": "Try Again",
  "something_went_wrong": "Something went wrong"
}
```

Note: `"something_went_wrong"` and `"retry"` already exist in common.json.

---

## Edge Cases

1. **Genre labels** in DiscoverScreen — hardcoded array of 11 music genres. These are display strings, not API data. Need translation.

2. **Category descriptions** in PreferencesSections — 12 hardcoded descriptions for date categories. These are NOT the same as category names in `constants/categories.ts`. They are preferences-specific descriptions.

3. **Experience type descriptions** in PreferencesSections — 6 descriptions matching `ONBOARDING_INTENTS` but with different text. The onboarding translations have `intents.adventurous_desc` etc. — these preferences descriptions are different strings.

4. **"Free" appears in 3+ contexts** — price fallback in SwipeableCards, filter option in Discover, price display. Should be one `common.free` key.

5. **Time slot labels** ("Brunch", "Afternoon", etc.) — used in PreferencesSections. Not the same as API time data.

6. **Date format placeholder** "mm/dd/yyyy" — locale-sensitive. Different regions use dd/mm/yyyy. This should be translated per locale.

7. **Strings shared with onboarding** — "Set your own", "5 – 120 minutes", "min" already exist in `onboarding.travel_time.*`. The preferences version should reference the same keys or have its own in `preferences` namespace (recommended: own namespace to avoid coupling).

---

## Estimated Totals

| Metric | Count |
|--------|-------|
| **Total strings** | ~207 |
| **Total files** | 9 |
| **New namespaces** | 5 (discover, cards, preferences, share, paywall, navigation) |
| **Common.json additions** | ~15 new keys |
| **Interpolation strings** | ~13 |
| **Pluralization strings** | ~2 ("{{count}} responses") |

## Recommended Implementation Order

1. **common.json** — add new shared keys first (used by everything)
2. **navigation.json** + app/index.tsx — tab labels (small, high visibility)
3. **cards.json** + SwipeableCards + ExpandedCardModal + SwipeableBoardCards — core card experience
4. **discover.json** + DiscoverScreen — biggest file, most user-facing
5. **preferences.json** + PreferencesSections + PreferencesSectionsAdvanced — filter/preferences UI
6. **share.json** + ShareModal — sharing flow
7. **paywall.json** + PaywallScreen — subscription UI

---

## Discoveries for Orchestrator

None new.
