# Mingla Explorer Mobile App - Complete User Experience

## Table of Contents
1. [App Launch & Authentication](#1-app-launch--authentication)
2. [Onboarding Flow](#2-onboarding-flow)
3. [Home Screen (Explore)](#3-home-screen-explore)
4. [Discover Screen](#4-discover-screen)
5. [Connections Screen](#5-connections-screen)
6. [Activity Screen (Likes)](#6-activity-screen-likes)
7. [Profile Screen](#7-profile-screen)
8. [Modals & Overlays](#8-modals--overlays)
9. [Guided Tour System](#9-guided-tour-system)
10. [Visual Design & Animations](#10-visual-design--animations)

---

## 1. App Launch & Authentication

### App Launch
When the user opens the Mingla app for the first time, they see a beautiful splash screen with the Mingla logo on a gradient background using the brand colors orange (#eb7825) and darker orange (#d6691f). The logo gently pulses with a breathing animation while the app loads.

---

### Sign In Screen
The sign in screen appears after the splash screen fades away. The entire screen features a soft gradient background with the Mingla brand colors. At the center is a glass-like card with subtle transparency and blur effects - this is where users enter their credentials.

**What Users See:**
- The Mingla logo at the top of the card, animated with a gentle pulse
- An email input field with a floating label that moves up when users tap to type
- A password input field with a show/hide icon on the right side to toggle password visibility
- A large "Sign In" button with an orange gradient that spans the full width
- Below that, a "Don't have an account? Sign Up" text link
- A "Forgot Password?" link for password recovery
- Social login options with Google and Apple buttons

**Interactions:**
- When users tap the sign in button, it scales down slightly (pressed state), then back up
- If credentials are wrong, the card shakes side-to-side and a red error message appears below
- When sign in succeeds, the entire screen smoothly fades out and transitions to either the onboarding flow (first time) or the home screen (returning users)
- Loading states show a spinner on the sign in button with the text "Signing in..."

---

### Sign Up Screen
Accessed by tapping the "Sign Up" link from the sign in screen. Similar visual design but with additional fields.

**What Users See:**
- Email input field
- Password input field with strength indicator (weak/medium/strong shown in colors)
- Confirm password field
- First name and last name fields
- A checkbox for agreeing to terms and privacy policy
- "Create Account" button (orange gradient)

**Interactions:**
- Password fields show real-time validation (minimum 8 characters, special character required, etc.)
- Email field checks format as user types and shows checkmark when valid
- Create button is disabled (grayed out) until all fields are valid and terms are accepted
- On successful creation, users see a brief success animation before transitioning to onboarding

---

## 2. Onboarding Flow

First-time users go through a six-step onboarding flow to set up their profile and preferences. The flow uses smooth page transitions with slides coming in from the right when moving forward.

### Progress Indicator
At the top of every onboarding screen is a progress bar showing which step the user is on (e.g., "Step 2 of 6"). The progress bar fills with orange as users advance, giving a sense of completion.

---

### Step 1: Personal Information
**What Users See:**
A friendly welcome message: "Welcome to Mingla! Let's set up your profile."

Four input fields appear vertically:
- First Name (text input)
- Last Name (text input)
- Username (text input with live availability checking)
- Profile Picture upload area (optional, shown as a dashed circle with camera icon)

**Username Validation:**
As users type their desired username, the app checks in real-time if it's available. A small green checkmark appears when the username is free, or a red X with "Username taken" message if it's already in use.

**Profile Picture:**
Users can tap the circle to either take a photo with the camera or choose from their photo library. A preview appears immediately after selection. This step is optional and can be skipped.

**Continue Button:**
An orange gradient button at the bottom that's disabled until first name, last name, and an available username are entered. When ready, the button pulses subtly to draw attention.

---

### Step 2: What Brings You to Mingla?
**What Users See:**
The heading: "What brings you to Mingla?" with subtitle "Choose your main vibe"

Six large, tappable cards appear in a vertical scrollable list:
- First Date (with a heart icon)
- Romantic (with a heart icon)
- Friendly Hangout (with a people icon)
- Group Fun (with a people icon)  
- Solo Adventure (with a star icon)
- Business Meeting (with a target icon)

**Interactions:**
Each card has a subtle shadow and when tapped, it scales up slightly and gets an orange gradient border with a checkmark in the top right corner. Only one option can be selected at a time - tapping a new card deselects the previous one.

**Continue Button:**
Appears at the bottom, disabled until a selection is made.

---

### Step 3: Budget Range
**What Users See:**
The heading: "What's your typical budget?" with subtitle "We'll show you experiences in your price range"

A dual-handle slider fills most of the screen, showing a range from $0 to $1000+. The selected range is highlighted in orange, with the rest in gray. Above the slider, the current selected range is displayed in large numbers (e.g., "$25 - $150").

Below the slider are four quick preset buttons:
- "$0-25" (Free & Budget)
- "$25-75" (Moderate)
- "$75-150" (Premium)
- "$150+" (Luxury)

**Interactions:**
Users can drag either handle of the slider to adjust the range. The numbers update in real-time as they drag. Alternatively, tapping a preset button instantly sets the range to that preset and the slider handles jump to position with a smooth animation.

**Currency Note:**
The currency symbol shown ($ for USD) matches whatever the user's phone is set to for their region.

**Continue Button:**
Always enabled since a default range is pre-selected.

---

### Step 4: Choose Your Categories
**What Users See:**
The heading: "What experiences excite you?" with subtitle "Pick as many as you like"

A grid of category cards (two columns) that users can scroll through:
- Take a Stroll (walking figure icon)
- Sip & Chill (coffee cup icon)
- Casual Eats (fork and knife icon)
- Screen & Relax (screen icon)
- Creative & Hands-On (palette icon)
- Picnics (sun and cloud icon)
- Play & Move (dumbbell icon)
- Dining Experiences (plate icon)
- Wellness Dates (tree icon)
- Freestyle (sparkles icon)

**Interactions:**
Each card shows an icon at the top and the category name below. When users tap a card, it gets an orange border and the icon fills with orange color. A small checkmark badge appears in the top right corner. Multiple cards can be selected. Tapping again deselects.

**Minimum Selection:**
Users must select at least one category. A small text below the grid says "Select at least 1 category".

**Continue Button:**
Disabled until at least one category is selected.

---

### Step 5: Location & Travel
**What Users See:**
The heading: "Where are you exploring?" with subtitle "We'll find experiences near you"

**Location Input:**
A search input field with a location pin icon. As users type, a dropdown list of suggestions appears (powered by Google Places). Users can also tap a "Use My Current Location" button below the input to automatically detect their location using GPS.

**Travel Radius Section:**
Below location is the heading "How far will you travel?" with a single-handle slider ranging from 1 to 50 (km or miles based on phone settings). The selected distance is shown above the slider in large text (e.g., "25 km").

**Travel Mode Icons:**
Four icon buttons in a row below the slider:
- Walking figure (shows ~5 km/h estimate)
- Bicycle (shows ~15 km/h estimate)
- Bus/Train (shows ~20 km/h estimate)
- Car (shows ~30 km/h estimate)

**Interactions:**
When a travel mode is tapped, it highlights with an orange background and shows an estimated travel time (e.g., "~30 min max travel"). Only one can be selected at a time.

**Continue Button:**
Disabled until a location is entered and a travel mode is selected.

---

### Step 6: Review & Complete
**What Users See:**
The heading: "You're all set!" with subtitle "Here's what we know about you"

A summary card showing all their selections:
- Profile picture thumbnail (or initials if none uploaded)
- Name and username
- Intent type (e.g., "First Date")
- Budget range (e.g., "$25 - $150")
- Selected categories (shown as small pill badges)
- Location and travel preferences

**Edit Buttons:**
Each section has a small "Edit" text link that takes users back to that specific onboarding step. The back button at the top also works normally to go step-by-step backward.

**Complete Setup Button:**
A large orange gradient button at the bottom reading "Complete Setup & Start Exploring"

**Interactions:**
When users tap the complete button:
1. A loading spinner appears with text "Setting up your profile..."
2. After 1-2 seconds, colorful confetti bursts from the top and falls down the screen
3. A success checkmark appears briefly
4. The screen smoothly transitions to the home screen with the guided tour ready to start

**Data Persistence:**
All onboarding data is saved to the device's local storage and synced to the backend. A flag is set indicating onboarding is complete so users never see this flow again unless they sign out and create a new account.

---

## 3. Home Screen (Explore)

The home screen is where users spend most of their time discovering local experiences. It consists of three main areas: the top navigation bar, the collaboration sessions bar, and the main swipeable cards area.

---

### Top Navigation Bar
This bar is fixed at the top of the screen and has a glass-like appearance with blur effects behind it.

**Left Side:**
A circular button with a sliders icon. This is the Preferences button.
- In solo mode, the icon appears gray
- In collaboration mode, the icon appears orange
- Tapping opens either the solo preferences sheet or the collaboration preferences sheet depending on mode
- The icon has a subtle rotation animation when tapped

**Center:**
The Mingla logo, sized appropriately for mobile screens. It has a gentle breathing pulse animation that's always active.

**Right Side:**
A circular button with a bell icon. This is the Notifications button.
- Has a small red pulsing dot in the top-right corner indicating unread notifications
- Tapping opens a dropdown panel showing recent notifications
- The bell icon has a gentle shake animation when tapped

---

### Collaboration Sessions Bar
Directly below the top navigation is a horizontal scrollable bar showing session pills. The bar has a soft orange-tinted glass background with subtle shadows.

**Components in Order:**

**Solo Pill (appears when there are active sessions):**
- A rounded pill button with the text "Solo"
- When selected: Orange gradient background, white text, shadow underneath
- When not selected: White background, gray text, thin border
- Tapping switches the app to solo mode where users browse alone

**Plus Button:**
- A circular orange gradient button with a white plus icon
- Tapping opens the collaboration creation modal
- Has a subtle shadow and slightly scales up when pressed

**Active Session Pills:**
- Each active collaboration session shows as a pill with initials (e.g., "SC" for Sarah Chen)
- When selected: Orange gradient background, white text, shadow
- When not selected: White background, gray text, border
- Tapping switches to that collaboration session

**Invite Pills:**
- Pending invites show as grayed-out pills (light gray background, darker gray text)
- Sent invites show the initials of the person invited
- Received invites show the initials of the person who sent the invite
- Tapping opens a modal to accept/decline (received) or cancel (sent)

**Scroll Behavior:**
The pills scroll horizontally. When there are more pills than fit on screen, small circular arrow buttons appear on the left and right edges, allowing users to tap to scroll in that direction. The scrollbar itself is hidden for a cleaner look.

**Visual Indicators:**
A subtle gradient fade appears on the edges when content extends beyond the visible area, indicating more content to scroll.

---

### Swipeable Cards Area
This is the main content area filling most of the screen. Cards appear stacked with a slight 3D depth effect - you can see the edges of the next 2-3 cards behind the top card.

**Card Structure:**

**Image Section:**
The top portion shows a full-width image of the experience. If there are multiple images, small dot indicators appear at the bottom showing which image is currently visible. Users can swipe left/right within the image area to view different photos. Each swipe has a smooth sliding transition.

**Content Section:**
Below the image:
- **Title:** Bold, large text (experience name)
- **Location:** Gray text with a location pin icon, showing city/neighborhood
- **Price Badge:** A small orange pill showing the price range (e.g., "$25-$75")
- **Category Badge:** A gray pill showing the category (e.g., "Dining Experience")
- **Description:** A few lines of gray text describing the experience (truncated with "...")
- **Details Row:** Small icons with info:
  - Star icon with rating (e.g., "4.8")
  - Clock icon with duration (e.g., "2 hours")
  - Navigation icon with distance (e.g., "3.2 km")
  - People icon with capacity (e.g., "2-8 people")

**Action Buttons at Bottom:**
Three circular buttons in a row:
- **Left (Red X button):** Dislike/Pass on this experience
- **Center (Gray Info button):** View full details
- **Right (Green Heart button):** Like/Save this experience

---

### Swipe Gestures

**Swipe Right (Like):**
1. As the user drags the card to the right, it begins to rotate clockwise (up to 15 degrees)
2. A green overlay with a large heart icon gradually appears over the card
3. If they drag far enough (about 1/3 of the screen width), the card flies off to the right with a spring animation
4. A heart icon pulses briefly in the top-right corner of the screen
5. A toast notification appears at the bottom: "💖 Added to Likes!"
6. The card is saved to the user's Saved collection
7. The next card smoothly animates forward from behind

**Swipe Left (Dislike):**
1. As the user drags the card to the left, it rotates counterclockwise (up to 15 degrees)
2. A red overlay with a large X icon gradually appears
3. If dragged far enough, the card flies off to the left with a spring animation
4. No notification appears (just silently removed)
5. The card ID is saved so it won't appear again
6. The next card animates forward

**Snap Back:**
If users don't drag far enough and release, the card smoothly snaps back to center position with a spring animation.

**Button Taps:**
- Tapping the red X button triggers the same animation as swiping left
- Tapping the green heart button triggers the same animation as swiping right
- Both have a brief scale-down press animation before executing

---

### Card Details View
Tapping the gray info button (or tapping anywhere in the card content area) opens a full-screen modal showing complete details.

**Modal Appearance:**
The modal slides up from the bottom with a spring animation. A semi-transparent dark overlay appears behind it. The modal has a white background with rounded top corners.

**Close Button:**
A small X button in a circle appears in the top-right corner. Tapping it or swiping down dismisses the modal.

**Content (Scrollable):**

**Image Gallery:**
A full-width image carousel at the top. Users can swipe through all images. Page indicator dots show at the bottom. Images have a slight parallax effect as users scroll down the content.

**Title and Location:**
Large bold title with location text below (with pin icon).

**Action Buttons Row:**
- Share button (share icon)
- Add to Calendar button (calendar icon)  
- Save button (heart icon, filled if already saved)

**Details Section:**
- Price range displayed prominently
- Category badges
- Full description text (multiple paragraphs)
- Rating (stars) with review count

**Specifications Grid:**
Two-column grid showing:
- Duration
- Distance from user
- Capacity
- Age restrictions (if any)
- Accessibility info (if any)

**Reviews Section:**
Heading "Reviews" with overall star rating. Below are user review cards showing:
- User avatar/initials
- User name
- Star rating
- Review date
- Review text
- Review photos (if any, shown as small thumbnails)

**Purchase Options:**
If the experience offers tickets, a section shows different ticket types in cards:
- Ticket name (e.g., "General Admission", "VIP", "Group Package")
- Price
- Description of what's included
- Availability status
- "Select" button

**Bottom Action Bar:**
Fixed to the bottom of the modal:
- Total price if any tickets selected
- Large "Purchase" button (orange gradient, full-width) if tickets available
- Or "Add to Calendar" button if it's a free/self-guided experience

---

### Empty State
When users have swiped through all available cards:

**What Users See:**
- A friendly illustration in the center (perhaps a character looking at an empty folder)
- Large text: "All caught up!"
- Smaller text: "You've seen all experiences that match your preferences right now. New ones are added daily!"
- An orange button: "Update Preferences" (opens preferences sheet)
- A secondary button: "See Archived" (shows previously passed cards)

**Auto-Refresh:**
The app automatically generates new card batches in the background. A subtle pull-to-refresh gesture at the top can also trigger a manual refresh.

---

### Card Generation Logic
The app intelligently generates personalized experience cards:

**Initial Load:**
When users first open the home screen, 15 cards are loaded into the stack.

**Progressive Loading:**
When only 5 cards remain, the app automatically loads another batch of 10-15 cards in the background without interrupting the user.

**Personalization Factors:**
Cards are filtered and sorted based on:
- Selected intent type from onboarding
- Budget range
- Chosen categories
- Location and travel radius
- Time of day (morning experiences in morning, evening events in evening)
- Day of week (weekend vs weekday experiences)
- User's past likes and interaction history
- In collaboration mode: the group's shared preferences

---

## 4. Discover Screen

The Discover screen is accessed by tapping the compass icon in the bottom navigation. It's designed for deeper exploration and planning, especially for specific people or occasions.

---

### Tab Bar at Top
Two large tabs with smooth sliding underline animation:

**For You Tab:**
- Icon: Star (filled when active)
- Text: "For You"
- Active state: Orange color with animated underline sliding underneath
- Inactive state: Gray color

**Night Out Tab:**
- Icon: Moon with sparkles
- Text: "Night Out"
- Active state: Orange color with animated underline
- Inactive state: Gray color

The underline smoothly slides from one tab to the other when switching, and the content cross-fades.

---

### For You Tab

**Hero Section:**
At the very top, a personalized greeting:
- "Discover for You, [FirstName]" in large text
- Subtitle: "Plan experiences for the people you care about"

**Add Person Card (Prominent):**
A large, tappable card with an orange gradient background:
- Icon: Outline of a person with a plus sign
- Text: "Plan for Someone Special"
- Subtitle: "Get personalized recommendations"
- Tapping opens a modal to add a person

---

**People You're Planning For Section:**

**When No People Added:**
A white card with dashed border shows:
- Illustration of people connecting
- Text: "No one added yet"
- Subtitle: "Add friends, family, or dates to get curated experience ideas for them"
- "Add Person" button (orange)

**When People Exist:**
A horizontal scrollable row of person cards. Each card shows:
- A circular avatar with colored background and initials
- Full name below avatar
- Relationship tag (e.g., "Date", "Friend", "Mom")
- Birthday date (e.g., "Mar 15")
- Small gender icon (to help with personalization)

**Card Actions:**
Tapping a person card reveals a bottom sheet with options:
- Generate Ideas (wand icon) - Creates AI-powered experience suggestions
- Edit Person (pencil icon) - Edit their details
- View Calendar (calendar icon) - See planned experiences for them
- Delete (trash icon, red) - Remove this person

---

**Generate Ideas Flow:**

When users tap "Generate Ideas" on a person:
1. A loading overlay appears with text "Finding perfect experiences for [Name]..." and a sparkle animation
2. After 2-3 seconds, a new screen slides in from the right showing results
3. The results screen shows:
   - "[Name]'s Experience Ideas" as the heading
   - 8-12 suggestion cards in a vertical scrollable list

**Each Suggestion Card Shows:**
- A relevant icon for the category
- Experience title (e.g., "Sunset Rooftop Drinks", "Pottery Class for Two")
- Category badge
- Brief description (1-2 lines)
- Estimated price range
- "Add to Calendar" button

**Personalization Examples:**
- For a romantic date: Suggests intimate dining, sunset spots, couple activities
- For a mom's birthday: Suggests brunch spots, spa experiences, theater shows
- For a friend: Suggests casual hangouts, games, sports activities

**Tapping "Add to Calendar":**
Opens a date/time picker modal. Once date is selected and confirmed, the experience is added to the Calendar tab with that person tagged.

---

**Category Inspiration Section:**

Below the people section is a heading "Get Inspired" with a grid of category cards (2 columns).

**Each Category Card Shows:**
- Large icon representing the category
- Category name (e.g., "Take a Stroll")
- Small badge with number of suggestions (e.g., "5 ideas")
- Subtle shadow and border

**Tapping a Category:**
Opens a modal showing 5 specific suggestions for that category. For example, "Take a Stroll" might show:
- "Walk a 'History of Us' route (first date spot)"
- "Visit a botanical garden"
- "Explore a Christmas tree trail during the holidays"
- "Scenic waterfront walk at sunset"
- "Historic neighborhood tour"

Each suggestion can be tapped to add it to a planning list or calendar.

**Categories Include:**
- Take a Stroll
- Sip & Chill
- Casual Eats
- Screen & Relax
- Creative & Hands-On
- Picnics
- Play & Move
- Dining Experiences
- Wellness Dates
- Freestyle

---

**Curated Trips Section (Bottom):**

A heading "Curated Trips" with subtitle "Multi-day adventure ideas"

A horizontal scrollable row of trip cards. Each card shows:
- A beautiful landscape photo (16:9 ratio)
- Destination name overlaid on image (e.g., "Weekend in Charleston")
- Duration badge in corner (e.g., "3 days")
- Price starting from (e.g., "From $1,200")
- Subtle gradient overlay for text readability

**Tapping a Trip Card:**
Opens a full-screen modal with trip details:
- Hero image carousel
- Trip name and duration
- Brief overview paragraph
- Day-by-day itinerary:
  - Day 1: Morning/Afternoon/Evening activities
  - Day 2: Morning/Afternoon/Evening activities
  - Day 3: Activities
- Included experiences (cards showing each activity)
- Accommodation suggestions
- Total cost breakdown
- "Save Trip" button
- "Book Trip" button (orange gradient)

---

### Night Out Tab

This tab is focused on parties, events, and nightlife.

**Hero Banner:**
A full-width image showing a vibrant nightlife scene with gradient overlay. Text overlaid:
- "Find Your Perfect Night" (large, white, bold)
- "Parties, events, and unforgettable experiences" (smaller, white)

**Filter Bar:**
Below the hero, a horizontally scrollable row of filter pills:
- Date filters: "Today", "This Week", "This Weekend", "Custom"
- Type filters: "All", "Party", "Live Music", "Rooftop", "Club", "Bar", "Event"
- Price filters: "Free", "$", "$$", "$$$", "$$$$"

Active filters have orange background and white text. Inactive ones have white background and gray text. Tapping toggles them on/off.

**Events Grid:**
Below filters, a vertical scrolling grid of event cards.

**Each Event Card Shows:**
- Event photo (full-width, 4:3 aspect ratio)
- Date badge in top-left corner (e.g., "SAT MAR 15")
- Event name (bold, 2 lines max)
- Venue name with location pin icon (gray text)
- Time range with clock icon (e.g., "9 PM - 2 AM")
- Price badge or "FREE" tag
- Tag pills (e.g., "21+", "DJ Night", "Rooftop")
- RSVP count (e.g., "124 interested" with people icon)
- Bottom row of action buttons:
  - "Interested" button (outline)
  - Share icon
  - Calendar icon

**Tapping an Event Card:**
Opens a full-screen modal with complete event details.

---

**Event Details Modal:**

**Header:**
- Close button (X) in top-right
- Event image gallery (swipeable)
- Event name (large, bold)
- Date, time, and location badges in a row
- Share and save buttons

**Content (Scrollable):**

**About Section:**
Full event description with all details. Can be several paragraphs.

**Lineup/Schedule (if applicable):**
For events with multiple performers or activities:
- Timeline view showing:
  - 9:00 PM - Opening DJ
  - 10:30 PM - Main Act
  - 12:00 AM - After Party
  - Etc.

**Venue Details:**
- Full address with "Get Directions" link
- Map preview (small embedded map)
- Venue capacity
- Dress code information
- Age restrictions clearly stated
- Parking information

**Tickets Section:**
Cards showing different ticket tiers:
- Early Bird: $25 (if available)
- General Admission: $35
- VIP: $75
- Group Package (4 people): $120

**Each Ticket Card Shows:**
- Tier name
- Price (large)
- What's included (bullet points)
- Availability (e.g., "Only 12 left!" in orange)
- Quantity selector (+ and - buttons)
- "Add to Cart" button

**Reviews Section:**
Star rating with count (e.g., "4.7 ★ (89 reviews)")
Recent reviews from attendees of past events at this venue.

**Similar Events:**
Horizontal scrollable row of similar event cards.

**Bottom Action Bar (Fixed):**
- Selected ticket summary (if any): "2 tickets"
- Total price
- "Purchase Tickets" button (orange gradient, full-width)

**After Purchase:**
A success screen appears:
- Checkmark animation
- "Tickets Purchased!" heading
- QR code displayed (for venue entry)
- Ticket details
- "Add to Calendar" button
- "View in Calendar" button

---

## 5. Connections Screen

The Connections screen is accessed via the people icon in the bottom navigation. It's the hub for managing friendships and messaging.

---

### Tab Bar at Top
Two tabs with smooth transition:

**Friends Tab:**
- Icon: Multiple people silhouettes
- Text: "Friends"
- Active state: Orange underline and orange icon
- Inactive state: Gray

**Messages Tab:**
- Icon: Chat bubble
- Text: "Messages"
- Badge: Red circle with unread message count (if any)
- Active state: Orange underline and orange icon
- Inactive state: Gray

---

### Friends Tab

**Header Actions Bar:**
A row of icon buttons below the tabs:

- **Add Friend Button (leftmost):**
  - Icon: Person with plus sign
  - Orange gradient background
  - Tapping opens the Add Friend modal

- **Friend Requests Button:**
  - Icon: Bell
  - Badge: Red circle with pending request count
  - Tapping opens Friend Requests modal

- **Block List Button:**
  - Icon: Shield
  - Tapping opens Block List modal

- **QR Code Button (rightmost):**
  - Icon: QR code square
  - Tapping opens a modal showing user's personal QR code for easy friending

**Search Bar:**
Below the action buttons, a search input with a magnifying glass icon. Placeholder: "Search friends by name..."
As users type, the list below filters in real-time.

---

**Friends List:**
A vertical scrollable list of friend cards. Each card shows:

**Left Side:**
- Circular avatar (profile picture or colored circle with initials)
- Small status dot in bottom-right of avatar:
  - Green: Online now
  - Gray: Offline

**Center:**
- Name (bold)
- Username (@handle) in gray
- Status line below (e.g., "Online" in green, "Last seen 2h ago" in gray, or custom status message)

**Right Side:**
Two icon buttons:
- Message bubble icon (tapping opens direct chat)
- Three-dot menu icon (tapping opens action menu)

**Action Menu Options:**
When three-dot icon is tapped, a bottom sheet slides up with options:
- Add to Board (icon: users) - Opens board selection modal
- Send Collaboration Invite (icon: send)
- View Profile (icon: person)
- Mute Notifications (icon: bell with slash)
- Remove Friend (icon: person with X, red text)
- Block User (icon: shield, red text)
- Report User (icon: flag, red text)

**Friend States:**
- Online friends appear at the top of the list with a subtle highlight
- Offline friends appear below
- Muted friends show a small muted speaker icon next to their name
- The list automatically updates as friends come online/offline

**Empty State:**
If user has no friends yet:
- Illustration of people connecting
- Text: "No friends yet"
- Subtitle: "Start connecting to plan experiences together!"
- "Add Friend" button (orange gradient)

---

### Messages Tab

**Header:**
A "New Message" button in the top-right (icon: pencil in square or plus icon). Tapping opens a friend selection modal to start a new conversation.

**Search Bar:**
Similar to Friends tab, but searches message content and friend names.

**Conversations List:**
Vertical scrollable list of conversation cards. Each shows:

**Left Side:**
- Circular avatar with online status dot

**Center:**
- Friend name (bold)
- Last message preview (gray text, truncated to 1 line)
- If last message is from user: "You: [message]"
- If message contains an image: "📷 Photo" instead of text

**Right Side:**
- Timestamp (e.g., "5m", "2h", "Yesterday", "Jan 12")
- Unread badge: Orange circle with message count (if unread)

**Visual States:**
- Unread conversations: Friend name is bold, subtle background highlight
- Read conversations: Normal text weight
- Active conversation (currently open): Orange left border accent
- Muted conversations: Gray text, speaker with slash icon

**Swipe Actions:**
- Swipe left on a conversation: Red "Delete" option appears
- Swipe right on a conversation: Gray "Mute" option appears

**Typing Indicator:**
If a friend is currently typing a message, the last message preview is replaced with animated dots and "typing..." text in orange.

**Empty State:**
If no conversations exist:
- Illustration of chat bubbles
- Text: "No messages yet"
- Subtitle: "Start a conversation with a friend!"
- "New Message" button (orange)

---

### Message Interface

When a user taps a conversation, a new screen slides in from the right showing the chat.

**Header:**
- Back button (left arrow) on the left
- Friend's avatar (small, circular) next to name
- Friend's name (bold)
- Online status below name:
  - "Online" in green
  - "Last seen 5m ago" in gray
  - "Typing..." in orange (when actively typing)
- Three action icons on the right:
  - Video call icon (currently inactive/grayed out for future feature)
  - Phone call icon (currently inactive/grayed out)
  - Info icon (opens friend detail sheet)

**Messages Area (Scrollable):**
Messages are displayed in a chat bubble format with date separators between different days.

**Received Messages (Left-aligned):**
- Gray background bubble
- Black text
- Friend's avatar appears to the left
- Timestamp below bubble (small, gray)

**Sent Messages (Right-aligned):**
- Orange gradient background bubble
- White text
- No avatar
- Timestamp below bubble
- Delivery status icons:
  - One checkmark: Sent
  - Two checkmarks: Delivered
  - Two orange checkmarks: Read

**Message Types:**

**Text Messages:**
Standard bubbles with text, supporting multi-line.

**Images:**
Sent/received images appear in bubbles. Tapping opens full-screen viewer with pinch-to-zoom.

**Link Previews:**
When a URL is shared, a card preview appears showing:
- Small preview image
- Link title
- Brief description
- Domain name

**Experience Shares:**
When an experience is shared from Mingla, a rich card appears showing:
- Experience photo (small)
- Experience title
- Price and category
- "View" button that opens the experience details modal

**Emoji Reactions:**
Users can long-press any message to add emoji reactions. Available reactions appear in a popup row. Added reactions show as small emoji badges below the message bubble.

**Date Separators:**
Between messages from different days, a centered gray text shows the date (e.g., "Today", "Yesterday", "Monday, Feb 27").

---

**Input Area (Bottom, Fixed):**

A white bar fixed to the bottom containing:

**Left Side:**
- Plus icon button (tapping opens attachment menu)

**Center:**
- Text input field (expands from 1 to 4 lines as user types)
- Placeholder: "Type a message..."

**Right Side:**
- Emoji picker button (smiley face icon)
- Send button (paper airplane icon)
  - Grayed out when input is empty
  - Orange gradient when there's text
  - Tapping sends message with a brief scale animation

**Attachment Menu:**
When plus icon is tapped, a bottom sheet slides up with options:
- Photo or Video (icon: image) - Opens camera/gallery
- Share Experience (icon: ticket) - Opens saved experiences list
- Share Location (icon: map pin) - Sends current location
- Add to Calendar (icon: calendar) - Schedules a meet-up
- Record Voice (icon: microphone) - Currently inactive/future

**Emoji Picker:**
Tapping the emoji button opens a panel above the keyboard showing:
- Recently used emojis
- Categories (smileys, animals, food, etc.) with horizontal scroll
- Tapping an emoji inserts it at cursor position

**Typing Indicator (Received):**
When friend is typing, an animated three-dot bubble appears on the left side in real-time.

**Auto-Scroll:**
The chat automatically scrolls to the bottom when a new message is sent or received.

**Keyboard Behavior:**
The input area and messages smoothly adjust up when the keyboard appears, keeping the latest message visible.

---

### Add Friend Modal

Triggered by tapping the "Add Friend" button.

**Modal Design:**
Slides up from bottom, white background, rounded top corners.

**Header:**
"Add Friend" title with close button (X) on right.

**Three Tabs:**

**Search Tab (Default):**
- Search input: "Search by username, email, or phone"
- As user types, results appear below in a list
- Each result shows:
  - Avatar
  - Name
  - Username
  - Mutual friends count (e.g., "3 mutual friends")
  - "Add Friend" button (if not already friends)
  - "Pending" badge (if request already sent)
  - "Friends" checkmark (if already friends)

**QR Code Tab:**
Two sections:

**Your QR Code:**
- Large QR code displayed
- User's name and username below
- "Save to Photos" button
- Other users can scan this to add them

**Scan Code:**
- "Scan Friend's Code" button
- Opens camera view to scan QR codes
- Automatically adds friend when valid code detected

**Nearby Tab (Future Feature):**
- Uses Bluetooth/location to detect nearby Mingla users
- List updates in real-time
- Each nearby user shows distance (e.g., "12 feet away")
- Quick "Add" button next to each

---

### Friend Requests Modal

Shows two sections with a toggle at top:

**Received Requests:**
List of people who sent friend requests. Each shows:
- Avatar and name
- Mutual friends count
- Time ago (e.g., "2 hours ago")
- Two buttons:
  - Accept (green)
  - Decline (gray)

**Sent Requests:**
List of outgoing pending requests. Each shows:
- Avatar and name
- Status: "Pending"
- Time sent
- "Cancel Request" button (gray)

**Empty States:**
- Received: "No friend requests"
- Sent: "No pending requests"

---

### Block List Modal

Shows all blocked users.

**Each Blocked User Shows:**
- Avatar and name
- Date blocked (e.g., "Blocked Jan 15, 2026")
- "Unblock" button (red)

**Unblock Confirmation:**
Tapping unblock shows an alert:
- "Unblock [Name]?"
- "They will be able to send you messages and see your profile again."
- Cancel / Unblock buttons

**Empty State:**
- Shield icon
- "No blocked users"

---

## 6. Activity Screen (Likes)

The Activity screen (heart icon in bottom nav) is where users manage saved experiences, collaboration boards, and scheduled events.

---

### Tab Bar at Top
Three tabs with smooth transitions:

**Saved Tab:**
- Icon: Heart
- Text: "Saved"
- Badge: Number of saved experiences
- Active: Orange underline

**Boards Tab:**
- Icon: Multiple people
- Text: "Boards"
- Subtitle: "Collaboration sessions"
- Badge: Number of active boards
- Active: Orange underline

**Calendar Tab:**
- Icon: Calendar
- Text: "Calendar"
- Badge: Number of upcoming events
- Active: Orange underline

---

### Saved Tab

This is where all liked/saved experiences appear.

**Header Actions:**

**Search Bar:**
Input field with magnifying glass icon. Placeholder: "Search saved experiences..."
Searches titles, locations, and categories.

**Filter Button:**
Icon showing filter lines. Tapping opens a bottom sheet with filter options:

**Source Filter:**
- All (default)
- Solo (experiences saved in solo mode)
- Collaboration (experiences saved in boards)

**Category Filter:**
Multi-select checkboxes for all 10 categories.

**Budget Filter:**
Range slider from $0 to $1000+.

**Experience Type Filter:**
Checkboxes for intent types (First Date, Romantic, Group Fun, etc.).

**Apply Filters Button:**
Orange gradient button at bottom. Active filters show as orange pill badges below the search bar with X to remove.

---

**Content Sections:**

The saved experiences are organized into two collapsible sections:

**Active Section:**
- Header shows "Active" with count badge (e.g., "Active (24)")
- Chevron icon on right (down when expanded, right when collapsed)
- Tapping header toggles collapse/expand

**Archive Section:**
- Header shows "Archive" with count badge
- Starts collapsed by default
- Contains past/expired experiences

**Experience Cards Grid:**
Two-column grid (or single column on smaller screens).

**Each Card Shows:**
- Experience photo (4:3 ratio)
- Title (bold, 2 lines max)
- Location text with pin icon (1 line, truncated)
- Price badge (orange pill)
- Category badge (gray pill)
- Source badge: Either "Solo" or board name (e.g., "Weekend Plans")

**Card Actions (Visible on Tap):**
Tapping a card shows action buttons overlaid:
- Schedule (calendar icon) - Pick a date/time, moves to Calendar tab
- Purchase (ticket icon) - Opens purchase flow
- Share (share icon) - Opens share modal
- Remove (trash icon, red) - Removes from saved

**Long Press:**
Long-pressing a card shows the same actions in a bottom sheet menu for easier access.

**Tapping Card Image/Title:**
Opens the full experience details modal (same as from swipe cards).

---

**Empty States:**

**No Saved Experiences:**
- Large heart icon outline
- "No saved experiences yet"
- "Start swiping to discover and save experiences you love!"
- "Go to Explore" button (orange gradient)

**No Results from Filters:**
- Filter icon with slash
- "No experiences match your filters"
- "Clear Filters" button

**Archive Empty:**
- Clock icon
- "No archived experiences"

---

**Auto-Archive Logic:**
Experiences automatically move to Archive when:
- The scheduled date has passed
- Tickets have expired
- User manually archives them

Users can manually move experiences back to Active from Archive.

---

### Boards Tab

Shows all collaboration boards the user is part of.

**Board List (Vertical Scroll):**

Each board appears as a large card showing:

**Header Row:**
- Board name (bold, large)
- Status badge:
  - Active (green)
  - Pending (yellow) - waiting for invites to be accepted
  - Archived (gray)

**Participant Row:**
- Circular avatars overlapping (max 4 visible + "+3" if more)
- If pending participants exist, a yellow badge shows count

**Stats Row:**
Small icons with counts:
- People icon: Total participants (e.g., "5 members")
- Card icon: Experiences in board (e.g., "12 cards")
- Clock icon: Last activity (e.g., "Active 2h ago")

**Action Buttons Row:**
- "Switch to Board" button (orange gradient if not active, gray outline if active)
- Chat button (message icon) - Opens board discussion
- Settings button (gear icon) - Opens board settings

**Tapping a Board Card:**
Opens board details modal showing:
- Board name and description
- All participants with roles
- All saved experiences with voting
- Discussion/chat
- Board settings

---

**Empty State:**
- People icon illustration
- "No collaboration boards yet"
- "Create a session to plan experiences with friends!"
- "Create Session" button (orange)

---

### Board Details Modal

When a board card is tapped, a full-screen modal opens.

**Header:**
- Back button on left
- Board name (title)
- Participant avatars
- Settings icon on right

**Two Tabs:**

**Cards Tab:**
Shows all experiences added to this board.

**Each Experience Card Shows:**
- Experience photo
- Title and location
- Added by (avatar + name + timestamp)
- Voting section:
  - Thumbs up button with count
  - Thumbs down button with count
  - User's vote highlighted in orange
- RSVP section:
  - "Going" / "Maybe" / "Not Going" buttons
  - Count of each response
  - User's response highlighted
- Actions:
  - View details button
  - Purchase tickets button
  - Schedule date button
  - Remove from board (creator/admin only)

**Discussion Tab:**
A real-time chat interface for board members.

**Message Types:**
- Regular text messages
- Experience shares (from board cards)
- System messages (e.g., "Sarah added an experience", "Mike voted 👍")
- Date proposals (e.g., "Emily proposed Saturday at 7 PM")

**Special Features:**
- @mentions (typing @ shows participant list)
- Reply threads (long-press message to reply)
- Emoji reactions on messages
- Pin important messages (admin/creator)

**Input Bar:**
Same as regular messaging but with quick action to share board experiences.

---

**Board Settings (Gear Icon):**

Opens a scrollable settings sheet:

**General:**
- Board name (editable by creator)
- Description (editable)
- Board color theme (color picker)

**Participants:**
List of all members showing:
- Avatar and name
- Role badge (Creator / Admin / Member)
- Online status
- Actions (Creator/Admin only):
  - Promote to Admin
  - Demote from Admin
  - Remove from Board
- "Invite More People" button at bottom

**Permissions (Creator/Admin only):**
Toggle switches:
- Who can add cards: All / Admins Only / Creator Only
- Who can remove cards: All / Admins Only / Creator Only
- Who can invite others: All / Admins Only / Creator Only

**Notifications:**
Toggle switch: Board notifications (on/off)
Dropdown: Notification level
- All activity
- Only @mentions
- Mute

**Danger Zone:**
- "Leave Board" button (red, shows confirmation)
- "Archive Board" button (creator only)
- "Delete Board" button (creator only, requires password confirmation)

---

### Calendar Tab

Shows scheduled and purchased experiences on a timeline.

**View Toggle (Top):**
Two options:
- List View (default): Vertical list
- Month View: Traditional calendar grid

**Time Filter Pills (Below Toggle):**
Horizontal scrollable filter pills:
- Today
- This Week
- This Month
- Upcoming
- Custom Range (opens date picker)

**Type Filter:**
- All
- Purchased (experiences with tickets)
- Scheduled (date reserved, no tickets)

**Search Bar:**
Filter by experience title or location.

---

**List View:**

**Two Collapsible Sections:**

**Active Events:**
- Header: "Active" with count
- Chevron to collapse/expand

**Archive:**
- Past events
- Collapsed by default

**Each Event Card Shows:**

**Left Side:**
Large date block:
- Month abbreviated (small, uppercase)
- Day number (large, bold)
- Both in white on orange gradient background

**Right Side:**
- Event title (bold)
- Location with pin icon
- Time range with clock icon
- Type badge:
  - "Purchased" (green) - has tickets
  - "Scheduled" (orange) - date only
- Attendees row (if from board): Avatar stack
- Status indicator:
  - Confirmed (checkmark)
  - Pending (clock)
  - Needs Action (warning icon)

**Action Buttons Row:**
- **View QR Code** (purchased events only):
  - Opens full-screen QR code for entry
  - Animated scanning line effect
  - Ticket details below
  - "Save to Photos" button
- **Propose New Date:**
  - Opens date/time picker
  - Sends proposal to all attendees
  - Shows proposal status
- **Leave Review** (after event date):
  - Opens review modal
  - Star rating + text + photos
- **Share:**
  - Opens share modal
- **Remove:**
  - Trash icon (red)
  - Confirmation alert

**Tapping Event Card:**
Opens full event details modal (similar to experience details).

---

**Month View:**

Traditional calendar grid showing current month.

**Grid Layout:**
- Days of week header row (S M T W T F S)
- 5-6 week rows
- Each day cell shows date number
- Small colored dots below dates that have events:
  - Green dot: Purchased event
  - Orange dot: Scheduled event
  - Multiple dots: Multiple events
- Today's date: Orange border
- Selected date: Filled orange background

**Tapping a Date:**
Bottom sheet slides up showing all events for that date in list format.

**Month Navigation:**
Swipe left/right to change months, or use arrow buttons in header.

---

**Empty States:**

**No Calendar Events:**
- Calendar icon
- "No scheduled experiences"
- "Browse your saved experiences to schedule them!"
- "View Saved" button (navigates to Saved tab)

**No Results from Filters:**
- Filter icon
- "No events match your filters"
- "Clear Filters" button

---

## 7. Profile Screen

The Profile screen (person icon in bottom nav) is the user's personal dashboard.

---

### Profile Header

**Profile Picture Section:**

**Without Uploaded Photo:**
- Large circular area with Mingla gradient background (orange colors)
- User's initials in white (large, bold)
- Small camera badge in bottom-right corner:
  - White circular background
  - Orange border
  - Camera icon in orange
- Tapping anywhere opens photo picker:
  - "Take Photo" option (opens camera)
  - "Choose from Library" option
  - "Cancel" option

**With Uploaded Photo:**
- Displays the uploaded profile picture
- Camera badge still visible for changing photo
- Smooth fade-in when image loads

---

**Profile Completion Box:**

Appears below profile picture when profile is incomplete.

**Design:**
- Glass card with blur effect
- Rounded corners
- Subtle shadow

**Content:**
- "Complete Your Profile" heading
- Progress bar:
  - Gray background
  - Orange gradient fill showing completion percentage
  - Smooth animation as percentage increases
- Percentage text (e.g., "67%")
- Checklist with items:
  - ✓ Upload profile picture (green checkmark when done)
  - ✓ Add name (green checkmark)
  - ✓ Save experiences (green checkmark)
  - ○ Connect with friends (gray circle when not done)
  - ○ Create boards (gray circle)
  - ○ Visit places (gray circle)

**Completion Behavior:**
When profile reaches 100%:
1. Colorful confetti bursts from the top
2. Box smoothly fades out over 2 seconds
3. Disappears completely
4. Never shows again (state persisted)

---

**User Information:**

Below the profile picture/completion box:
- Full name (large, bold, e.g., "Jordan Smith")
- Username (gray, e.g., "@jordansmith")
- Location (pin icon + city, state, country)
  - Auto-updates from GPS when app opens
  - Manual update button (circular arrow icon) on right
  - Shows small spinner when updating
  - Tapping location text also triggers update

---

**Stats Row:**

Four cards in a 2x2 grid:

**Saved Card:**
- Heart icon (orange)
- Large number (e.g., "24")
- Label: "Saved"
- Tapping navigates to Activity > Saved tab

**Boards Card:**
- People icon (orange)
- Large number (e.g., "6")
- Label: "Boards"
- Tapping navigates to Activity > Boards tab

**Connections Card:**
- People icon (orange)
- Large number (e.g., "13")
- Label: "Friends"
- Tapping navigates to Connections screen

**Places Visited Card:**
- Trophy icon (orange)
- Large number (e.g., "8")
- Label: "Visited"
- Tapping shows visited places list (future feature)

Each card has a subtle shadow and scale animation when tapped.

---

### Your Vibes Section

A card showing the user's top 3 experience preferences based on saved/scheduled experiences.

**Header:**
"Your Vibes" with sparkles icon

**Content:**
Three horizontal progress bars stacked vertically.

**Each Bar Shows:**
- Category label on left (e.g., "Screen & Relax")
- Percentage on right (e.g., "35%")
- Experience count below (e.g., "12 experiences")
- Horizontal bar:
  - Gray background
  - Orange gradient fill to percentage
  - Smooth animation on load

**Calculation:**
- Analyzes all saved cards + calendar entries
- Counts categories
- Shows top 3 by percentage
- Updates in real-time as user saves experiences

**Empty State (No Data):**
Three bars at 0% with message:
"Save experiences to see your vibes!"

---

### Recent Activity Grid

Below vibes section, a heading "Recent Activity" with a 3-column grid of small square thumbnails showing recently saved/attended experiences.

Each thumbnail:
- Experience photo (square crop)
- Subtle border
- Tapping opens experience details modal

**Empty State:**
- Dashed border squares (placeholders)
- "Your recent experiences will appear here"

---

### Quick Actions Section

**Switch to Business Account:**
Large card with gradient background (only shown for Explorer users):
- Building icon
- "Switch to Business Account"
- Subtitle: "List your experiences and earn revenue"
- Tapping opens Business Onboarding flow

**Help Center:**
White card with border:
- Question mark circle icon
- "Help Center"
- Subtitle: "FAQs and support"
- Tapping opens help articles modal

---

### Settings Section

**Notifications Toggle:**
A row with:
- Bell icon on left
- "Notifications" label
- Toggle switch on right (orange when enabled, gray when disabled)
- Tapping anywhere toggles notifications on/off

**Settings List:**
Vertical list of tappable rows. Each has:
- Icon on left
- Label text
- Chevron (right arrow) on right
- Subtle divider between rows

**Profile Settings:**
- Person icon
- "Profile Settings"
- Tapping navigates to Profile Settings screen
- Edit name, username, bio, profile picture, location

**Account Settings:**
- Gear icon
- "Account Settings"
- Tapping navigates to Account Settings screen
- Email, password, privacy, currency, measurements, data

**Privacy Policy:**
- Shield icon
- "Privacy Policy"
- Tapping navigates to Privacy Policy screen (scrollable legal text)

**Terms of Service:**
- Document icon
- "Terms of Service"
- Tapping navigates to Terms screen (scrollable legal text)

**Sign Out:**
- Logout icon (red)
- "Sign Out" (red text)
- Tapping shows confirmation alert:
  - "Are you sure you want to sign out?"
  - Cancel / Sign Out buttons
- On confirm:
  - Shows loading spinner briefly
  - Clears all session data
  - Returns to Sign In screen
  - Toast message: "Signed out successfully"

---

### Profile Settings Screen

**Header:**
- Back button (left)
- "Profile Settings" title (center)
- Save button (right, orange text)

**Content (Scrollable):**

**Profile Picture:**
- Current image preview (large, circular)
- "Change Photo" button (opens photo picker)
- "Remove Photo" button (red text, only if photo exists)

**Personal Information Fields:**
- First Name (text input)
- Last Name (text input)
- Username (text input with real-time validation):
  - Green checkmark when available
  - Red X when taken
  - Character limit indicator
- Bio (multi-line text area, 160 char limit):
  - Character counter below (e.g., "42/160")

**Location:**
- Current Location (display-only field)
- "Update Location" button:
  - Requests GPS permission
  - Shows loading spinner
  - Updates on success
  - Shows error if permission denied

**Footer Buttons:**
- Cancel (gray, outline)
- Save Changes (orange gradient, filled)
  - Validates all fields
  - Shows loading spinner when saving
  - Success message: "Profile updated!"
  - Returns to Profile screen

---

### Account Settings Screen

**Header:**
- Back button (left)
- "Account Settings" title (center)

**Content (Scrollable, Organized in Sections):**

**Email & Security:**
- Current email (display + edit icon)
- "Change Password" button:
  - Opens modal with:
    - Current password field
    - New password field
    - Confirm new password field
    - Save button
  - Shows password strength indicator

**Privacy Settings:**
- Profile Visibility (dropdown):
  - Public (anyone can see)
  - Friends Only
  - Private
- Show Online Status (toggle)
- Show Last Active (toggle)
- Allow Friend Requests (toggle)
- Allow Collaboration Invites (toggle)

**Display Preferences:**
- Currency (dropdown):
  - USD, EUR, GBP, CAD, AUD, JPY, etc.
  - Updates all price displays throughout app
- Measurement System (dropdown):
  - Metric (kilometers, Celsius)
  - Imperial (miles, Fahrenheit)
  - Updates all distance/temperature displays
- Language (dropdown) - currently English only
- Time Format (toggle):
  - 12-hour (1:00 PM)
  - 24-hour (13:00)

**Notification Settings:**
- Push Notifications (toggle)
- Email Notifications (toggle)
- SMS Notifications (toggle)

**Detailed Notification Types:**
Each with individual toggle:
- Friend Requests
- New Messages
- Board Activity
- Experience Recommendations
- Event Reminders
- Special Offers

**Data Management:**
- "Download My Data" button:
  - Shows confirmation
  - Generates JSON export of all user data
  - Email sent with download link
- "Clear Cache" button:
  - Confirmation alert
  - Clears app cache
  - Message: "Cache cleared successfully"

**Danger Zone Section (Red border):**
- "Deactivate Account" button (orange):
  - Opens modal explaining deactivation
  - Password required
  - Temporary suspension (can reactivate)
  - Confirmation alert
- "Delete Account" button (red):
  - Multi-step confirmation process
  - Password required
  - Warning: Irreversible action
  - 30-day grace period before permanent deletion
  - Final "I understand, delete my account" checkbox

**Save Changes Button (Bottom):**
Orange gradient, full-width. Saves all settings changes.

---

## 8. Modals & Overlays

### Collaboration Module

A comprehensive modal for creating and managing collaboration sessions.

**Trigger Points:**
- Tapping the plus button in collaboration sessions bar
- Tapping "Create Session" button in various places
- Auto-opens when a friend is pre-selected for collaboration

**Modal Design:**
- Slides up from bottom (on mobile)
- Dark semi-transparent backdrop
- White rounded-corner card
- Spring animation on appearance

**Header:**
- "Collaboration Mode" title
- Subtitle that changes per tab
- Close button (X) in top-right
  - Disabled during guided tour

**Three Tabs:**

---

**Sessions Tab:**

Shows all available modes for browsing experiences.

**Solo Explorer Card:**
- Purple/blue gradient background
- Person icon
- "Solo Explorer" title
- "Browse experiences just for you" subtitle
- If currently active: Orange border + checkmark
- Tapping switches to solo mode

**Active Sessions List:**
Cards showing collaboration boards.

Each session card displays:
- Session name (bold)
- Status badge (Active / Pending / Archived):
  - Active: Green
  - Pending: Yellow
  - Archived: Gray
- Participant info:
  - Avatar stack (overlapping circles, max 4 shown)
  - "+2" overflow badge if more participants
  - Pending invitation count (yellow badge)
- Stats row:
  - Participant count (e.g., "5 members")
  - Card count (e.g., "12 experiences")
  - Last activity (e.g., "Active 2h ago")
- Action buttons:
  - "Switch to This Session" (or "Active" if current)
  - Chat icon (opens board discussion)
  - Settings icon (opens board settings)

**Currently Active Session:**
- Orange left border accent
- Checkmark icon
- "Active" button instead of "Switch"

**Empty State:**
- People icon illustration
- "No Active Sessions"
- "Create a new session to start collaborating"

---

**Invites Tab:**

Toggle at top: Received | Sent

**Received Invites:**
List of incoming collaboration invitations.

Each invite card shows:
- Session name
- From user (name + avatar)
- Time ago (e.g., "2 hours ago")
- Expiration timer if applicable (e.g., "Expires in 3 days")
- Accept button (green gradient)
- Decline button (gray outline)

When accepted:
- Brief success animation
- Session moves to Sessions tab as Active
- Toast: "Joined [Session Name]!"

**Sent Invites:**
List of outgoing invitations.

Each shows:
- Session name
- To user (name + avatar)
- Status: Pending / Accepted / Declined
- Time sent
- Cancel button (red outline) for pending only

**Empty States:**
- "No pending invites" for received
- "No sent invites" for sent

**Badge on Tab:**
Red notification dot if received invites > 0.

---

**Create Tab:**

A 3-step wizard for creating a new collaboration session.

**Step Indicator:**
Three dots at bottom showing current step (filled orange for current, gray for upcoming).

**Step 1: Name Your Session**

- Text input field
- Placeholder: "e.g., Weekend Plans, Date Night, Girl's Trip"
- Character limit: 50
- Validation: Real-time character counter
- Continue button (disabled until valid name entered)

**Step 2: Invite Friends**

- Search bar at top to filter friends
- Scrollable list of all friends
- Each friend shows:
  - Avatar
  - Name
  - Online status dot
  - Checkbox for selection
- Selected friends appear in a preview section at top:
  - Small avatar chips
  - X button to remove
- If friend was pre-selected (from elsewhere in app):
  - Automatically checked
  - Highlighted
- Continue button text: "Continue (X selected)"
  - Disabled if none selected
- Back button returns to step 1

**Step 3: Review & Create**

Summary card showing:
- Session name (large, bold)
- Creator (you) with "Creator" badge
- All invited participants:
  - Avatars in grid layout
  - Names below
  - "Invited" badge on each

Create Session button:
- Large orange gradient, full-width
- Text: "Create Session & Send Invites"
- Disabled while creating
- Loading spinner when processing

**Post-Creation:**
1. Success animation (confetti burst)
2. Modal auto-switches to Sessions tab
3. New session appears in list
4. Automatically switches to new session mode
5. Toast: "Session created! Invites sent to [X] friends."

**Navigation:**
- Back button on steps 2-3 goes to previous step
- Can exit entirely with X button

---

### Collaboration Preferences Modal

Similar to solo PreferencesSheet but optimized for groups.

**Header:**
- "Collaboration Preferences" title
- Session name subtitle (e.g., "Weekend Plans")
- Participant avatars row
- Close button (X)

**Key Differences from Solo:**

**Experience Types:**
- Multiple selection allowed (checkboxes instead of radio)
- Example: Select both "Romantic" and "Group Fun"

**Budget Range:**
- Labeled as "Group Budget"
- Typically higher range than solo
- Note: "Budget that works for everyone"

**Categories:**
- Same multi-select interface
- Note: "Shared preferences for the group"

**Date & Time:**
- Flexible options emphasized
- "Group Availability" section
- Time slots with voting/consensus indicators (future feature)

**Location:**
- Labeled as "Meeting Location"
- Can set to central point between participants
- Or specific venue

**Save Button:**
- "Save Group Preferences"
- Updates for all participants
- Toast: "Group preferences saved!"

---

### Share Modal

**Triggered By:**
- Share button on experience cards
- Share button in boards
- Share button in calendar events

**Modal Design:**
- Bottom sheet style
- Slides up from bottom

**Header:**
- "Share Experience" title
- Close button

**Experience Preview (Top):**
- Small thumbnail image
- Experience title
- Location
- Price range

**Share Options Grid:**
Six large tappable cards:

**Copy Link:**
- Link icon
- Taps to copy URL to clipboard
- Brief feedback: "Link copied!"

**Message Friend:**
- Chat bubble icon
- Opens friend selection
- Selected friend opens with experience pre-attached

**Add to Board:**
- People icon
- Opens board selection modal
- Choose which collaboration board to add to

**Post to Social:**
- Share icon
- Opens native share sheet
- Options: Twitter, Facebook, Instagram, etc.

**Generate QR Code:**
- QR code icon
- Generates scannable code
- Full-screen display
- "Save to Photos" option

**Email:**
- Envelope icon
- Opens email composer
- Experience details pre-filled in body

Each option has a brief scale animation when tapped.

---

### Purchase Modal

**Triggered By:**
- Purchase button on experience details
- Purchase button on saved cards
- Purchase button on board cards

**Modal Design:**
- Full-screen takeover
- Slides up from bottom

**Header:**
- "Purchase Tickets" title
- Experience name
- Close button (X)

**Experience Summary (Top):**
- Small image
- Title
- Location
- Selected date/time (if chosen, else "Select date below")

**Ticket Options Section:**

Grid of ticket type cards. Each card shows:
- Ticket name (e.g., "General Admission")
- Price (large, bold)
- Description (bullet points of what's included)
- Availability (e.g., "Only 15 left!" in orange)
- Quantity selector:
  - Minus button (-)
  - Number display
  - Plus button (+)
- "Add to Cart" button when quantity > 0

**Cart Summary (Fixed Bottom):**
- Selected items list:
  - "2x General Admission"
  - "1x VIP Pass"
- Subtotal
- Service fee
- Total (large, bold)
- "Proceed to Payment" button (orange gradient, full-width)

**Payment Flow:**
Tapping "Proceed to Payment" shows new screen:

**Payment Form:**
- Card number input (with card type icon)
- Expiration date (MM/YY)
- CVV code
- Cardholder name
- Billing address (auto-filled if available)
- "Save this card" checkbox
- "Complete Purchase" button

**Processing:**
- Loading overlay with spinner
- "Processing payment..." text
- Cannot be dismissed

**Success Screen:**
- Large checkmark animation
- "Purchase Successful!" heading
- Order number
- QR code displayed (for venue entry)
- Ticket details summary
- "Add to Calendar" button
- "View Tickets" button
- "Done" button

**Post-Purchase:**
- Experience added to Calendar tab with "Purchased" badge
- QR code saved for offline access
- Email confirmation sent
- Push notification: "Tickets ready for [Experience Name]!"

---

### Propose Date Modal

**Triggered By:**
- "Propose New Date" button on calendar events
- When rescheduling is needed

**Modal Design:**
- Bottom sheet
- White background

**Header:**
- "Propose New Date" title
- Event name subtitle
- Close button

**Date Picker:**
- Calendar grid view showing current month
- Today highlighted
- Selected date: Orange background
- Unavailable dates: Gray, crossed out
- Swipe left/right to change months

**Time Picker:**
- Hour selector (scrollable wheel)
- Minute selector (scrollable wheel)
- AM/PM toggle
- Or time slots if venue has specific times

**Message to Attendees:**
- Optional text area
- Placeholder: "Why does this date work better?"
- Character limit: 200

**Attendees List:**
- Shows all participants
- Checkboxes to select who receives proposal
- All selected by default

**Action Buttons:**
- Cancel (gray outline)
- Send Proposal (orange gradient)

**After Sending:**
- Toast: "Date proposal sent!"
- Modal closes
- Event on calendar shows "Proposal Pending" badge
- Attendees receive notification

**Attendee Response Options:**
When others receive proposal, they can:
- Accept (event date updates)
- Decline (keeps original date)
- Counter-propose (sends new proposal)

---

### Review Modal

**Triggered By:**
- "Leave Review" button after event date has passed
- Review request notification

**Modal Design:**
- Full-screen
- Slides up from bottom

**Header:**
- "Leave a Review" title
- Event name subtitle
- Close button (X)

**Event Details (Top):**
- Small thumbnail
- Event name
- Date attended
- Location

**Star Rating (Required):**
- 5 large stars
- Tapping fills stars from left
- Animated scale on selection
- Orange fill

**Category Ratings (Optional):**
Additional 5-star ratings for:
- Atmosphere
- Service
- Value for Money
- Would Recommend (thumbs up/down instead)

**Written Review:**
- Multi-line text area
- Placeholder: "Share your experience... What did you love? Any tips for others?"
- Character limit: 500
- Counter below

**Photo Upload:**
- "Add Photos" button
- Opens camera or gallery
- Max 5 photos
- Shows grid of uploaded images
- Tap image to preview or delete

**Privacy Setting:**
Toggle or dropdown:
- Share publicly (visible to all)
- Friends only
- Private (only for your records)

**Submit Button:**
- Orange gradient, full-width
- Text: "Submit Review"
- Validates rating is provided
- Shows loading spinner while uploading

**Post-Submission:**
- Success checkmark animation
- "Thank you for your review!" message
- Points/badge earned notification (gamification)
- Modal closes
- Toast: "Review submitted!"

**Review Visibility:**
Review appears on:
- Experience detail page
- User's profile review section
- Business dashboard (for business owner)

---

### Notifications Dropdown

**Triggered By:**
- Tapping bell icon in top nav
- Push notification tap (navigates to relevant content)

**Dropdown Design:**
- Slides down from bell icon
- White card with shadow
- Rounded corners
- Max height (scrollable if more notifications)
- Tap outside to close
- **Highest z-index in the app** - appears above all other content including modals, overlays, and navigation elements
- Semi-transparent dark backdrop behind dropdown (dimming everything else)

**Header:**
- "Notifications" title
- "Mark All as Read" text button (gray)

**Notification Items:**

Each notification card shows:
- Icon representing type (left side):
  - Person plus: Friend request
  - Chat bubble: New message
  - People: Board invite
  - Calendar: Event reminder
  - Star: Review request
- User avatar if from a person
- Title (bold): Action summary
- Message: Details (gray text, 1-2 lines)
- Timestamp (e.g., "5m ago", "2h ago", "Yesterday")
- Unread indicator: Orange dot on left edge (if unread)
- Action buttons if applicable

**Notification Types:**

**Friend Request:**
- "Sarah Chen sent you a friend request"
- Accept / Decline buttons inline

**New Message:**
- "Mike Johnson sent you a message"
- Message preview: First line of message
- Tapping opens chat with that friend

**Board Invite:**
- "Emily invited you to Weekend Plans"
- Accept / Decline buttons

**Event Reminder:**
- "Sunset Drinks is tomorrow at 6 PM!"
- "View Details" button

**Review Request:**
- "How was Jazz Night at Blue Note?"
- "Leave Review" button

**Date Proposal:**
- "Alex proposed Saturday, March 18 at 7 PM"
- Accept / Counter / Decline buttons

**System Notification:**
- "New experiences added near you!"
- "Tap to explore" button

**Interaction:**
- Tapping a notification marks it as read
- Navigates to relevant screen (chat, event, etc.)
- Unread count badge on bell icon decreases

**Empty State:**
- Bell icon
- "All caught up!"
- "No new notifications"

**Footer:**
- "View All Notifications" button
  - Opens dedicated notifications screen with full history

---

### Toast Notifications

Small popup messages that appear briefly and auto-dismiss.

**Position:**
- Bottom of screen (above bottom nav)
- Centered horizontally

**Design:**
- Rounded rectangle
- Shadow
- Colored left border indicating type

**Types:**

**Success (Green):**
- Checkmark icon
- Examples:
  - "💖 Added to Likes!"
  - "✓ Preferences saved!"
  - "✓ Session created!"
  - "✓ Purchase successful!"

**Error (Red):**
- X icon
- Examples:
  - "❌ Failed to load experiences"
  - "❌ Connection lost"
  - "❌ Payment declined"

**Info (Blue):**
- Info icon
- Examples:
  - "ℹ️ New experiences available"
  - "ℹ️ Profile updated"

**Warning (Orange):**
- Warning icon
- Examples:
  - "⚠️ Invitation expires soon"
  - "⚠️ Event date changed"

**Loading (Gray):**
- Spinner icon
- Examples:
  - "Loading experiences..."
  - "Syncing data..."

**Behavior:**
- Slides up from bottom with spring animation
- Stays visible for 3-5 seconds
- User can swipe down to dismiss early
- Multiple toasts stack vertically
- Auto-queues if many appear at once

---

## 9. Guided Tour System

First-time users who complete onboarding are greeted with an interactive guided tour highlighting key features.

**Tour Structure:**
13 steps total, spanning across all main screens.

**Visual Design:**
- Dark semi-transparent overlay covers entire screen
- Spotlight effect highlights specific element:
  - Circle spotlight for buttons
  - Rounded rectangle for larger areas
- Spotlight has animated pulse effect
- Everything outside spotlight is dimmed and non-interactive

**Tour Card:**
Floating card appears near highlighted element showing:
- Emoji icon
- Step number (e.g., "Step 1 of 13")
- Title (bold)
- Description (2-3 sentences)
- "Next" button (orange gradient)
- "Skip Tour" button (gray text)

**Auto-Navigation:**
Tour automatically navigates between screens as needed, updating the bottom navigation to show current location.

---

### Tour Steps:

**Step 1: Preferences Button (Home)**
- 🎯 Icon
- Highlights the sliders icon button
- "Personalize Your Experience"
- "Tap here to set your vibe, budget, location radius, and favorite categories. Your feed adapts instantly to show exactly what you love."
- Spotlight: Circle around preferences button
- Position: Above or below button

**Step 2: Collaboration Sessions Bar (Home)**
- 👥 Icon
- Highlights entire horizontal pill bar
- "Solo & Collaboration Modes"
- "Switch between Solo and Collaboration modes here! Each mode can have its own preferences. Solo shows experiences tailored just for you, while collaboration sessions adapt to group preferences."
- Spotlight: Rounded rectangle around entire bar

**Step 3: Solo Button (Home)**
- 🙋 Icon
- Highlights the "Solo" pill
- "Solo Mode"
- "Tap 'Solo' to browse experiences on your own. Your personal preferences will guide what you see."
- Spotlight: Pill-shaped around solo button

**Step 4: Create Session Button (Home)**
- ✨ Icon
- Highlights the orange plus button
- "Create Collaboration Session"
- "Tap the + button to create a new collaboration session and invite friends to swipe experiences together!"
- Spotlight: Circle around plus button

**Step 5: Swipe Cards (Home)**
- ✨ Icon
- Highlights the top card
- "Discover Local Experiences"
- "Swipe right to save experiences you love, left to pass. Tap any card to see full details, photos, and booking options."
- Spotlight: Rounded rectangle around card

After step 5, tour navigates to Discover screen.

**Step 6: For You Tab (Discover)**
- 🎯 Icon
- Highlights the "For You" tab
- "Personalized Feed"
- "Your curated feed shows experiences tailored to your preferences. Explore local activities, events, and parties just for you."
- Spotlight: Rectangle around tab

**Step 7: Add Person Button (Discover)**
- 👥 Icon
- Highlights the "Plan for Someone Special" card
- "Plan for Friends & Family"
- "Add people to get personalized experience recommendations for them! Perfect for planning birthdays, date nights, or special occasions."
- Spotlight: Rectangle around button

**Step 8: Night Out Tab (Discover)**
- 🎉 Icon
- Highlights the "Night Out" tab
- "Night-Out Experiences"
- "Discover parties, events, and nightlife! From rooftop soirées to live music, find the perfect way to make your night unforgettable."
- Spotlight: Rectangle around tab

Tour navigates to Connections screen.

**Step 9: Friends Tab (Connections)**
- 👥 Icon
- Highlights the "Friends" tab
- "Your Social Circle"
- "Connect with friends, send collaboration invites, and build your network. See who's online and what experiences they're exploring."
- Spotlight: Rectangle around tab

**Step 10: Messages Tab (Connections)**
- 💬 Icon
- Tour switches to Messages tab automatically
- Highlights the "Messages" tab
- "Direct Messaging"
- "Chat with friends about experiences, share recommendations, and coordinate plans. Keep all your conversations in one place."
- Spotlight: Rectangle around tab

Tour navigates to Activity screen.

**Step 11: Saved Tab (Activity)**
- 💾 Icon
- Highlights the "Saved" tab
- "Your Saved Experiences"
- "All experiences you've liked are saved here. Browse your collection, schedule them, or purchase tickets when you're ready."
- Spotlight: Rectangle around tab

**Step 12: Calendar Tab (Activity)**
- 📅 Icon
- Tour switches to Calendar tab
- Highlights the "Calendar" tab
- "Your Calendar"
- "Track all your scheduled and purchased experiences in one place. Get QR codes for entry, propose new dates, and manage your upcoming adventures."
- Spotlight: Rectangle around tab

Tour navigates to Profile screen.

**Step 13: Profile Overview (Profile)**
- 👤 Icon
- Highlights entire profile screen content
- "Your Profile Hub"
- "View your stats, manage settings, track your vibes, and customize your Mingla experience. This is your personal dashboard for everything Mingla!"
- Spotlight: Large rectangle around main content
- **Last Step:** Button text changes to "Finish Tour"

**Completion:**
- Confetti animation
- Toast: "Tour complete! Start exploring!"
- Overlay fades away
- User lands on Home screen ready to use app
- Tour completion flag saved (won't show again)

**User Controls:**

**Next Button:**
- Advances to next step
- Auto-navigates to new screen if needed
- Smooth transitions

**Skip Tour:**
- Available on every step
- Shows confirmation: "Are you sure? You can restart the tour from Profile > Help"
- Skip / Cancel buttons
- If skipped, flag saved as "tour skipped"

**Restart Tour:**
Users can restart from Profile > Help Center > "Restart Tour"

---

## 10. Visual Design & Animations

### Color Palette

**Brand Colors:**
The entire app uses Mingla's signature orange palette:
- Primary Orange: #eb7825
- Darker Orange: #d6691f
- White: #ffffff
- Black: #000000

**Gradients:**
Primary gradient (used on buttons, badges, backgrounds):
- Flows from #eb7825 to #d6691f
- Direction: Left to right or top to bottom

Soft orange tint (used on backgrounds):
- Very light orange with high transparency
- Creates warm, welcoming feel

**Semantic Colors:**
- Success: Green (used for confirmations, online status)
- Error: Red (used for warnings, delete actions)
- Warning: Yellow/Amber (used for pending states)
- Info: Blue (used for informational messages)

**Text Colors:**
- Primary text: Dark gray (almost black)
- Secondary text: Medium gray
- Muted/disabled text: Light gray
- Active/selected text: Orange (#eb7825)

---

### Typography

**Hierarchy:**
- Large headings: Bold, large size (titles, names)
- Medium headings: Semi-bold, medium size (section headers)
- Body text: Regular weight, comfortable reading size
- Small text: Regular weight, smaller (timestamps, labels)

**Font Weights:**
- Bold: Titles, names, important information
- Semi-bold: Headings, tabs
- Regular: Body text, descriptions
- Light: Subtle labels (rarely used)

---

### Glass Morphism Effect

The app features modern glass-like surfaces throughout:

**Characteristics:**
- Semi-transparent white backgrounds
- Blur effect behind the element (backdrop blur)
- Subtle shadows for depth
- Soft, rounded corners

**Where Applied:**
- Top navigation bar
- Collaboration sessions bar
- Cards and modals
- Buttons
- Dropdowns and sheets

**Effect:**
Creates a layered, premium feel where content behind elements shows through with a frosted glass appearance.

---

### Animations

All animations run at 60fps for buttery-smooth performance.

**Spring Animations:**
Used for natural, physics-based movement:
- Modals sliding up/down
- Cards entering/exiting
- Button presses
- Drawer opens/closes

**Characteristics:**
- Initial fast movement
- Slight overshoot
- Gentle settle into place
- Feels responsive and alive

**Fade Animations:**
Used for content changes:
- Screen transitions
- Tab switches
- Toast notifications appearing/disappearing

**Scale Animations:**
Used for interactive feedback:
- Button taps: Scales down to 0.95 (pressed), back to 1.0 (released)
- Card hovers: Scales up slightly to 1.05
- Pulse effects: Gently scales between 1.0 and 1.05

**Slide Animations:**
Used for directional transitions:
- Screens slide in from right when navigating forward
- Screens slide out to right when going back
- Bottom sheets slide up from bottom
- Dropdowns slide down from trigger element

**Rotation Animations:**
Used for state changes:
- Icons rotating when activated (e.g., preferences slider icon rotates 90°)
- Chevrons rotating when expanding/collapsing sections
- Loading spinners with continuous rotation

**Stagger Animations:**
Used for lists and grids:
- Items appear one after another with slight delay
- Creates cascading effect
- First item appears, then next, then next
- Very fast stagger (50-100ms between items)

**Special Effects:**

**Pulse:**
- Mingla logo: Gentle breathing effect (scale 1.0 to 1.05, continuous)
- Notification dot: Opacity and scale pulse (draws attention)
- Active elements: Subtle pulse on first appearance

**Confetti:**
- Appears on major achievements (onboarding complete, tour finished, profile 100%)
- Colorful particles burst from top
- Fall down with gravity simulation
- Fade out as they fall

**Shimmer/Skeleton Loading:**
- Used while content loads
- Gray placeholder shapes
- Animated gradient shimmer passes across
- Replaced by actual content when loaded

**Shake:**
- Error feedback (e.g., wrong password)
- Card shakes side-to-side quickly
- Draws attention to problem

**Checkmark:**
- Success confirmation
- Animated drawing of checkmark
- Starts from bottom-left, draws upward and right
- Green color

**Progress Bar Fill:**
- Animated smoothly from 0% to target percentage
- Uses easing for natural acceleration/deceleration
- Orange gradient fill

---

### Touch Interactions

**Tap:**
- Single tap on buttons, cards, list items
- Brief scale-down animation on press
- Haptic feedback (light impact)
- Action executes on release

**Long Press:**
- Hold finger on element for ~500ms
- Triggers alternative action menu
- Haptic feedback when menu appears
- Used on cards, messages, etc.

**Swipe:**
- Horizontal swipe on cards (left/right to dislike/like)
- Horizontal swipe on conversations (left for delete, right for mute)
- Vertical swipe on modals (down to dismiss)
- Smooth follow of finger position
- Spring animation when released

**Pull to Refresh:**
- Pull down at top of scrollable content
- Spinner appears and rotates
- Release to trigger refresh
- Content updates and scroll returns to top

**Scroll:**
- Smooth, momentum-based scrolling
- Bounce effect at top and bottom
- Scroll indicators fade in when scrolling, fade out when stopped

**Pinch to Zoom:**
- On images in gallery views
- Smooth scaling
- Can zoom in/out
- Double-tap to reset zoom

---

### Screen Transitions

**Forward Navigation:**
- New screen slides in from right
- Current screen slides out to left
- Duration: ~300ms
- Spring easing

**Back Navigation:**
- Current screen slides out to right
- Previous screen slides in from left
- Duration: ~300ms
- Spring easing

**Tab Switching:**
- Cross-fade between tab contents
- Duration: ~200ms
- Linear easing
- Tab underline slides smoothly to new position

**Modal Presentation:**
- Bottom sheets: Slide up from bottom
- Full-screen modals: Slide up from bottom or fade in
- Backdrop: Fade in to semi-transparent dark
- Duration: ~300ms
- Spring easing

**Modal Dismissal:**
- Reverse of presentation animation
- Can also swipe down to dismiss
- Duration: ~250ms
- Deceleration easing

---

### Loading States

**Spinner:**
- Circular spinner with orange color
- Continuous rotation
- Used in buttons during processing
- Used in center of screen for page loads

**Skeleton Screens:**
- Gray placeholder shapes matching content layout
- Shimmer animation passes across
- Replaced by actual content when loaded
- Prevents jarring layout shifts

**Progressive Loading:**
- Content loads in stages
- Critical content first (titles, images)
- Secondary content second (details, descriptions)
- Creates perception of faster loading

**Pull to Refresh:**
- Pull indicator at top
- Spinner animation while refreshing
- Content updates when complete

---

### Empty States

Every screen with potentially empty content has a designed empty state:

**Characteristics:**
- Friendly illustration or icon
- Clear message explaining why it's empty
- Encouraging subtitle
- Call-to-action button to resolve empty state
- Centered vertically and horizontally

**Examples:**
- No saved experiences: Heart icon, "Start swiping to save!"
- No friends: People icon, "Connect with friends!"
- No messages: Chat bubble icon, "Start a conversation!"
- No calendar events: Calendar icon, "Schedule an experience!"

---

### Error States

When errors occur:

**Network Errors:**
- Icon showing disconnected signal
- "Connection Lost" message
- "Check your internet and try again"
- "Retry" button

**Content Load Failures:**
- Icon showing broken image or error symbol
- "Couldn't load content" message
- "Tap to try again"

**Form Validation Errors:**
- Red text below input field
- Red border on input field
- Clear explanation of what's wrong
- Real-time validation as user corrects

**Permission Errors:**
- Icon showing lock or blocked symbol
- "Permission Required" message
- Explanation of why permission needed
- "Grant Permission" button linking to settings

---

### Accessibility Features

**Touch Targets:**
- Minimum 44x44 points (iOS guideline)
- Ensures easy tapping on all interactive elements
- Extra padding around small icons

**Text Size:**
- Respects system text size settings
- Scales appropriately when user increases text size
- Maintains readability at all sizes

**Color Contrast:**
- All text meets 4.5:1 contrast ratio minimum
- Important elements have higher contrast
- Orange on white tested for accessibility

**Screen Reader Support:**
- All images have descriptive labels
- Buttons have clear accessibility labels
- Screen reader announces navigation changes
- Form fields have associated labels

**Haptic Feedback:**
- Light impact on button taps
- Medium impact on important actions
- Success/error patterns for confirmations/errors
- Helps users with visual impairments

**Focus Indicators:**
When navigating with external keyboard or assistive technology:
- Clear focus outlines on interactive elements
- Logical focus order (top to bottom, left to right)

---

### Performance Optimizations

**Image Loading:**
- Lazy loading: Images load only when about to be visible
- Thumbnail versions load first, full-res loads after
- Caching: Previously loaded images stored locally
- Compression: Images optimized for mobile

**Data Management:**
- Local storage: Recent data cached on device
- Background sync: Data updates when app is backgrounded
- Incremental loading: Load 10-15 cards at a time, not all at once

**Animation Performance:**
- GPU acceleration: Animations use device graphics processor
- Smooth 60fps maintained even during complex animations
- Reduced motion option respects system accessibility settings

**App Size:**
- Assets optimized and compressed
- Code split to load features as needed
- Regular cleanup of unused code

---

### Offline Support

**Cached Content:**
- Recently viewed experiences available offline
- Saved experiences always accessible
- Profile data and preferences cached
- Images previously loaded are viewable

**Offline Indicators:**
- Banner appears at top when offline: "No internet connection"
- Some actions disabled with explanation
- Queued actions (like sending messages) wait for connection

**Sync on Reconnect:**
- When internet returns, queued actions execute
- Data syncs automatically
- User notified of successful sync

---

This comprehensive mobile app experience document covers every aspect of the Mingla Explorer user journey from first launch through daily usage, designed specifically for React Native and Expo mobile implementation with smooth 60fps animations and modern mobile interaction patterns.
