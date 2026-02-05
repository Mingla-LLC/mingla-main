# Mingla Explorer User Stories

## Table of Contents
1. [Authentication & Account Access](#1-authentication--account-access)
2. [Onboarding Experience](#2-onboarding-experience)
3. [Home & Discovery](#3-home--discovery)
4. [Card Interactions](#4-card-interactions)
5. [Collaboration System](#5-collaboration-system)
6. [Activity Management](#6-activity-management)
7. [Connections & Social](#7-connections--social)
8. [Messaging & Communication](#8-messaging--communication)
9. [Profile & Account Settings](#9-profile--account-settings)
10. [Coach Marks & Guidance](#10-coach-marks--guidance)
11. [Notifications](#11-notifications)
12. [Navigation](#12-navigation)

---

## 1. Authentication & Account Access

### User Story 1.1: Sign In with Email, Phone & Social Media
**As an** Explorer  
**I need** to sign in using multiple authentication methods (email, phone, or social media accounts)  
**So that** I can access my account securely and conveniently using my preferred method  

#### Details and Assumptions
* Sign-in page displays Mingla logo (80px/96px, left-aligned)
* Multiple authentication options available: email/password, phone number, Google, Facebook, Apple
* Email format validation (e.g., user@domain.com)
* Phone number format with country code selection
* Password must meet security requirements (min 8 characters, uppercase, lowercase, number, special character)
* "Remember me" option to stay logged in
* "Forgot password" link available
* Brand colors used throughout: #eb7825, #d6691f, white, black

#### Acceptance Criteria
```gherkin
Given I am on the sign-in page
When I enter valid credentials (email/phone) and password
And I click "Sign In"
Then I am authenticated and redirected to my last active page or home screen
And my session is maintained across app restarts if "Remember me" was checked

Given I am on the sign-in page
When I click "Sign in with Google/Facebook/Apple"
And I authorize the social media connection
Then I am authenticated using my social account
And I am redirected to my last active page or home screen

Given I am on the sign-in page
When I enter invalid credentials
And I click "Sign In"
Then I see an error message "Invalid email or password. Please try again."
And I remain on the sign-in page
```

---

### User Story 1.2: Sign In with Email Only
**As an** Explorer  
**I need** a simplified email-only sign-in option  
**So that** I can quickly access my account without social media or phone authentication  

#### Details and Assumptions
* Streamlined interface showing only email and password fields
* Same validation and security requirements as multi-method sign-in
* Faster load time with fewer authentication provider scripts
* Direct path to password reset

#### Acceptance Criteria
```gherkin
Given I am on the email-only sign-in page
When I enter my registered email and correct password
And I click "Sign In"
Then I am authenticated immediately
And redirected to the home screen

Given I am on the email-only sign-in page
When I enter an unregistered email
And I click "Sign In"
Then I see "No account found with this email. Would you like to sign up?"
And I see a "Create Account" button
```

---

### User Story 1.3: Create Account with Role Selection
**As a** new Explorer  
**I need** to create an account by selecting my user role  
**So that** I can access features appropriate to my use case (Explorer, Curator, Business, QA Manager, or Admin)  

#### Details and Assumptions
* Role selection screen shows 5 options with descriptions:
  - Explorer: Discover and plan experiences
  - Curator: Create experience cards for your city
  - Business: Manage business experiences and revenue
  - QA Manager: Handle support, edit API content, moderate platform
  - Admin: Full platform management and analytics
* Each role has distinct test credentials for demo purposes
* Explorers proceed to full onboarding flow
* Other roles have specialized onboarding

#### Acceptance Criteria
```gherkin
Given I am on the sign-up page
When I click "Sign Up with Test Account"
Then I see a role selection screen with 5 role options

Given I am on the role selection screen
When I select "Explorer" role
And I confirm my selection
Then I am assigned the Explorer role
And redirected to the Explorer onboarding flow

Given I am signed in as an Explorer
When I navigate to any page
Then I only see features available to Explorer users
And I do not see Curator/Business/QA/Admin features
```

---

### User Story 1.4: Password Reset
**As an** Explorer  
**I need** to reset my password if I forget it  
**So that** I can regain access to my account  

#### Details and Assumptions
* "Forgot Password" link available on all sign-in pages
* Email-based password reset flow
* Reset link expires after 24 hours
* New password must meet security requirements

#### Acceptance Criteria
```gherkin
Given I am on the sign-in page
When I click "Forgot Password"
And I enter my registered email address
And I click "Send Reset Link"
Then I receive an email with a password reset link
And I see a confirmation message "Check your email for reset instructions"

Given I receive a password reset email
When I click the reset link within 24 hours
And I enter a new valid password
And I confirm the new password
Then my password is updated
And I see a success message "Password updated successfully"
And I am redirected to the sign-in page

Given I receive a password reset email
When I click the reset link after 24 hours
Then I see "This reset link has expired. Please request a new one."
And I see a "Request New Link" button
```

---

## 2. Onboarding Experience

### User Story 2.1: Welcome & Profile Setup
**As a** new Explorer  
**I need** to complete an initial welcome and profile setup  
**So that** the app can personalize my experience  

#### Details and Assumptions
* Onboarding consists of 10 total steps
* Progress indicator shows current step (e.g., "Step 1 of 10")
* Can skip onboarding but receive generic recommendations
* Profile information: name, email, optional profile photo
* Data persisted locally and to backend

#### Acceptance Criteria
```gherkin
Given I have just created an Explorer account
When I complete authentication
Then I see a welcome screen with "Welcome to Mingla"
And I see a progress indicator showing "Step 1 of 10"

Given I am on the welcome step
When I enter my first and last name
And I optionally upload a profile photo
And I click "Continue"
Then my profile information is saved
And I progress to Step 2 (Intent Selection)

Given I am on the welcome step
When I click "Skip for now"
Then I am taken directly to the home screen with default preferences
And I can access onboarding later from settings
```

---

### User Story 2.2: Intent Selection
**As a** new Explorer  
**I need** to select my primary intentions for using Mingla  
**So that** I receive experience recommendations that match my goals  

#### Details and Assumptions
* 6 intent options available:
  1. Solo Adventure (🌍)
  2. Plan First Dates (💕)
  3. Find Romantic Activities (💘)
  4. Find Friendly Activities (👥)
  5. Find Activities for Groups (🎉)
  6. Business/Work Meetings (💼)
* Can select multiple intents
* Each intent filters available experience categories differently
* Progress shown: "Step 2 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the intent selection step (Step 2)
When I select one or more intent options
And I click "Continue"
Then my selected intents are saved to my preferences
And I progress to Step 3 (Vibes/Categories)

Given I am on the intent selection step
When I try to continue without selecting any intent
Then I see a prompt "Please select at least one intent to continue"
And I remain on the intent selection step

Given I have selected "First Date" as my intent
When I progress to the categories step
Then I only see the 7 categories suitable for first dates
And other categories are filtered out
```

---

### User Story 2.3: Vibe/Category Selection
**As a** new Explorer  
**I need** to select my preferred experience categories (vibes)  
**So that** I receive recommendations that match my interests  

#### Details and Assumptions
* 10 experience categories available:
  1. Take a Stroll 🚶
  2. Sip & Chill ☕
  3. Casual Eats 🍕
  4. Screen & Relax 🎬
  5. Creative & Hands-On 🎨
  6. Picnics 🧺
  7. Play & Move ⚽
  8. Dining Experiences 🍽️
  9. Wellness Dates 🧘
  10. Freestyle ✨
* Categories shown filtered by selected intents
* Can select multiple categories (minimum 1)
* Progress shown: "Step 3 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the vibe/category selection step (Step 3)
When I select one or more categories
And I click "Continue"
Then my selected categories are saved to my preferences
And I progress to Step 4 (Location)

Given I have selected "First Date" intent
When I view the category options
Then I see only 7 categories (Stroll, Sip & Chill, Picnics, Screen & Relax, Creative, Play & Move, Dining)
And "Casual Eats," "Wellness," and "Freestyle" are not shown

Given I have selected "Solo Adventure" intent
When I view the category options
Then I see all 10 categories available
```

---

### User Story 2.4: Location Setup
**As a** new Explorer  
**I need** to set my location  
**So that** I receive recommendations for experiences near me  

#### Details and Assumptions
* Two location options: GPS (current location) or manual address entry
* GPS requires browser/device location permission
* Manual entry uses Google Places autocomplete
* Location can be changed later in preferences
* Progress shown: "Step 4 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the location setup step (Step 4)
When I click "Use my current location"
And I grant location permissions
Then my GPS coordinates are captured
And displayed as a human-readable address (e.g., "San Francisco, CA")
And I can click "Continue" to proceed to Step 5

Given I am on the location setup step
When I click "Enter address manually"
And I type an address in the search field
Then I see autocomplete suggestions from Google Places
When I select an address from the suggestions
Then that location is set as my preferred location
And I can click "Continue" to proceed to Step 5

Given I am on the location setup step
When I deny location permissions
Then I see "Location access denied. Please enter your location manually"
And the manual address entry field is displayed
```

---

### User Story 2.5: Travel Mode Selection
**As a** new Explorer  
**I need** to select my preferred travel mode  
**So that** experience recommendations factor in realistic travel times  

#### Details and Assumptions
* 4 travel mode options:
  1. Walking (~5 km/h)
  2. Biking (~15 km/h)
  3. Public Transit (~20 km/h avg)
  4. Driving (~30 km/h city)
* Each mode shows speed and description
* Affects distance/time calculations for all recommendations
* Progress shown: "Step 5 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the travel mode selection step (Step 5)
When I select "Walking"
And I click "Continue"
Then "Walking" is set as my preferred travel mode
And all future recommendations calculate travel time at ~5 km/h
And I progress to Step 6 (Travel Constraints)

Given I am on the travel mode selection step
When I view the travel mode options
Then I see 4 options with speed indicators and descriptions
And each option shows an icon (person, bike, bus, car)

Given I complete onboarding with "Biking" selected
When I view experience cards on the home screen
Then travel time is calculated based on ~15 km/h biking speed
And displayed as "🚴 12 min away"
```

---

### User Story 2.6: Travel Constraint Setup
**As a** new Explorer  
**I need** to set maximum travel time or distance constraints  
**So that** I only see experiences within my acceptable travel range  

#### Details and Assumptions
* Two constraint types: Time-based or Distance-based
* Time-based: Input maximum minutes willing to travel
* Distance-based: Input maximum km/miles (based on measurement preference)
* Only one constraint type active at a time
* Progress shown: "Step 6 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the travel constraint step (Step 6)
When I select "Time-based constraint"
And I enter "30" minutes
And I click "Continue"
Then experiences more than 30 minutes away are filtered out
And I progress to Step 7 (Budget)

Given I am on the travel constraint step
When I select "Distance-based constraint"
And I enter "10" km
And I click "Continue"
Then experiences more than 10 km away are filtered out
And I progress to Step 7 (Budget)

Given I have set a time constraint of 20 minutes with walking mode
When I view the home screen
Then I only see experiences within a ~1.7 km radius
And cards beyond this distance are not shown
```

---

### User Story 2.7: Budget Range Setup
**As a** new Explorer  
**I need** to set my budget range for experiences  
**So that** I only see experiences I can afford  

#### Details and Assumptions
* Budget presets available: $0-25, $25-75, $75-150, $150+
* Custom range option with min/max input fields
* Budget shown per person
* Free experiences always shown regardless of budget
* Progress shown: "Step 7 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the budget setup step (Step 7)
When I select the "$25-75" preset
And I click "Continue"
Then my budget range is set to $25-75 per person
And I progress to Step 8 (Date & Time)

Given I am on the budget setup step
When I click "Custom range"
And I enter min "$40" and max "$100"
And I click "Continue"
Then my budget range is set to $40-100 per person
And only experiences within this range are shown

Given I have set a budget of $25-75
When I view experience cards
Then cards show pricing like "💰 $50 per person - Within your budget"
And cards outside my range are filtered out
And free experiences still appear with "🎉 Free! Perfect for any budget"
```

---

### User Story 2.8: Date & Time Preferences
**As a** new Explorer  
**I need** to set when I want to have experiences  
**So that** recommendations match my schedule and availability  

#### Details and Assumptions
* Date options: Now, Today, This Weekend, Pick a Date
* Time slots (except "Now"): Brunch (11am-1pm), Afternoon (2-5pm), Dinner (6-9pm), Late Night (10pm-12am)
* Filters experiences by operating hours and availability
* Progress shown: "Step 8 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the date & time preferences step (Step 8)
When I select "Now"
And I click "Continue"
Then recommendations prioritize currently open venues
And I progress to Step 9 (Invite Friends)

Given I am on the date & time preferences step
When I select "This Weekend"
Then I see time slot options (Brunch, Afternoon, Dinner, Late Night)
When I select "Dinner (6-9pm)"
And I click "Continue"
Then recommendations show experiences available Saturday/Sunday 6-9pm
And I progress to Step 9

Given I have selected "Today" and "Brunch"
When I view experience cards
Then venues closed during brunch hours are filtered out
And only venues open 11am-1pm today are shown
```

---

### User Story 2.9: Friend Invitation
**As a** new Explorer  
**I need** to invite friends to join Mingla  
**So that** I can collaborate on planning experiences together  

#### Details and Assumptions
* Can invite via email, phone, or select from contacts
* Multiple friends can be invited at once
* Can skip this step and invite later
* Mock contacts shown in demo: Alex Rivera, Taylor Kim, Morgan Chen, Casey Davis
* Progress shown: "Step 9 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the friend invitation step (Step 9)
When I enter friend email addresses "alex@email.com, taylor@email.com"
And I click "Send Invites"
Then invitation emails are sent to both friends
And I see "2 invites sent successfully"
And I progress to Step 10 (Completion)

Given I am on the friend invitation step
When I click "Select from contacts"
And I select 3 friends from my contact list
And I click "Send Invites"
Then invitation SMS/emails are sent to selected friends
And I progress to Step 10

Given I am on the friend invitation step
When I click "Skip for now"
Then I progress to Step 10 without sending invites
And I can invite friends later from the Connections page
```

---

### User Story 2.10: Onboarding Completion
**As a** new Explorer  
**I need** to see a completion summary of my preferences  
**So that** I understand how my choices will shape my experience  

#### Details and Assumptions
* Shows summary of all selections made during onboarding
* One-time completion message welcoming user to Mingla
* First-time users see coach marks after completing onboarding
* Progress shown: "Step 10 of 10"

#### Acceptance Criteria
```gherkin
Given I am on the onboarding completion step (Step 10)
When I view the completion screen
Then I see a summary of my preferences:
  - Selected intents
  - Preferred categories
  - Location
  - Travel mode and constraints
  - Budget range
  - Date/time preferences
  - Invited friends count
And I see a "Get Started" button

Given I am on the completion screen
When I click "Get Started"
Then I am redirected to the Home screen
And I see personalized experience cards based on my preferences
And the coach mark system begins (5 contextual steps)
```

---

## 3. Home & Discovery

### User Story 3.1: View Personalized Experience Cards
**As an** Explorer  
**I need** to view swipeable experience cards tailored to my preferences  
**So that** I can discover relevant experiences quickly  

#### Details and Assumptions
* Cards displayed in swipeable interface (Tinder-style)
* Each card shows: hero image, title, category, match score, rating, travel time, price, description, top 2 highlights
* Match score calculated from location, budget, category, time, and popularity factors
* Cards filtered by user preferences (intents, vibes, budget, location, travel constraints)
* Mingla logo displayed at top (80px/96px)
* Brand colors: #eb7825, #d6691f

#### Acceptance Criteria
```gherkin
Given I am on the Home screen
When the page loads
Then I see a stack of experience cards matching my preferences
And each card displays:
  - Match score badge (e.g., "87% Match")
  - Hero image with gallery indicator if multiple images
  - Title and category icon
  - Rating and review count
  - Travel time based on my preferred mode
  - Price range
  - Brief description (2 lines max)
  - Top 2 highlight badges

Given I have set preferences for "Sip & Chill" category and $25-75 budget
When I view the Home screen
Then I only see coffee shops, bars, cafés within my budget
And restaurants, museums, and sports venues are filtered out

Given there are no experiences matching my current filters
When I view the Home screen
Then I see "💡 No matches found" message
And suggestions to adjust my filters
And current filter summary (budget, categories, constraints)
```

---

### User Story 3.2: Swipe Through Cards
**As an** Explorer  
**I need** to swipe left/right/up/down on experience cards  
**So that** I can quickly browse and make decisions  

#### Details and Assumptions
* Swipe right or click heart icon: Save to favorites
* Swipe left or click X icon: Remove from deck
* Swipe up or tap card: Open expanded view
* Keyboard shortcuts available: Arrow keys, Space, Enter
* Smooth animations and transitions
* Cards removed from deck after swiping

#### Acceptance Criteria
```gherkin
Given I am viewing a card on the Home screen
When I swipe right on the card
Then the card is saved to my "Saved" tab in Activity page
And the next card appears
And I see a toast notification "❤️ Saved! [Card Title] has been added to your saved experiences"
And the card is removed from the deck

Given I am viewing a card on the Home screen
When I swipe left on the card
Then the card is removed from the deck without saving
And the next card appears immediately
And no notification is shown

Given I am viewing a card on the Home screen
When I swipe up or tap on the card
Then a modal opens showing the expanded card view
And I see all card details (full gallery, description, highlights, purchase options, etc.)

Given I have swiped through all available cards
When I swipe left on the last card
Then I see "No more cards! 🎉" message
And options to adjust my preferences to see more experiences
```

---

### User Story 3.3: Open Preferences Sheet
**As an** Explorer  
**I need** to access and modify my preferences from the Home screen  
**So that** I can refine my experience recommendations without navigating away  

#### Details and Assumptions
* Preferences icon (sliders) in top-left of header
* Opens bottom sheet/modal with all preference options
* Changes apply immediately and update card deck
* Preferences: intents, categories, location, travel mode, constraints, budget, date/time
* Orange highlight when in collaboration mode

#### Acceptance Criteria
```gherkin
Given I am on the Home screen in solo mode
When I click the preferences icon (sliders) in the top-left
Then a preferences sheet slides up from the bottom
And I see all my current preference selections
And the icon is gray (#6B7280)

Given the preferences sheet is open
When I change my budget from "$25-75" to "$75-150"
And I close the preferences sheet
Then the card deck refreshes immediately
And I see new cards matching the $75-150 budget range

Given I am on the Home screen in collaboration mode
When I view the preferences icon
Then the icon is orange (#eb7825)
And clicking it opens collaboration-specific preferences
```

---

### User Story 3.4: Switch Between Solo and Collaboration Modes
**As an** Explorer  
**I need** to switch between solo and collaboration modes  
**So that** I can discover experiences for myself or plan with friends  

#### Details and Assumptions
* Mode switcher button in top-right shows current mode
* Solo mode: Shows "Collaborate" button with Users icon
* Collaboration mode: Shows board name with dropdown
* Orange gradient background (from-orange-50 to-amber-50) for mode button
* Notification indicator (red dot) for pending board invites
* Opens collaboration modal to select/create boards

#### Acceptance Criteria
```gherkin
Given I am on the Home screen in solo mode
When I click the "Collaborate" button in the top-right
Then a collaboration modal opens
And I see three tabs: Sessions (boards), Create (new board), Invites (pending)
And I can select an existing board or create a new one

Given I am on the Home screen in solo mode
When I click "Collaborate" and select a board "Weekend Plans"
Then the mode switches to collaboration mode
And the button displays "Weekend Plans" with a dropdown chevron
And the preferences icon changes to orange
And I see cards relevant to the board's preferences

Given I am in collaboration mode on board "Date Night Ideas"
When I click the board name button
Then the collaboration modal opens
And I can switch to a different board, create a new one, or return to solo mode

Given I have 2 pending board invites
When I view the mode switcher button
Then I see a red notification dot on the button
And clicking it shows the pending invites in the modal
```

---

### User Story 3.5: View Expanded Card Details
**As an** Explorer  
**I need** to view detailed information about an experience  
**So that** I can make informed decisions before saving or purchasing  

#### Details and Assumptions
* Opened by swiping up or tapping on a card
* Shows full-screen modal with all card data
* Includes: full image gallery, match explanation, weather forecast, traffic/busy analysis, full description, all highlights, tags, practical details (address, hours, phone, website), social proof metrics, match factor breakdown, purchase options, timeline/itinerary
* Can save, schedule, purchase, or share from this view
* Swipeable gallery with dot indicators

#### Acceptance Criteria
```gherkin
Given I am viewing a card on the Home screen
When I swipe up or tap on the card
Then a full-screen modal opens with expanded details
And I see:
  - Full image gallery (swipeable)
  - Match score and explanation in orange box
  - Weather forecast with activity-specific recommendation
  - Current traffic and venue busy level
  - Full description
  - All highlight badges
  - Practical details section (address, hours, phone, website)
  - Match factor breakdown (5 visual bars)
  - Action buttons (Save, Schedule, Buy Now, Share)

Given the expanded card modal is open
When I swipe left/right on the image gallery
Then I can view all available images
And dot indicators show current image position

Given the expanded card modal is open
When I scroll down
Then I can view all sections of the card
And the header remains sticky at the top

Given the expanded card modal is open
When I click the X or back button
Then the modal closes
And I return to the card stack
```

---

### User Story 3.6: View Match Score Explanation
**As an** Explorer  
**I need** to understand why an experience was recommended  
**So that** I can trust the matching algorithm  

#### Details and Assumptions
* Match score shown as percentage (e.g., "87% Match")
* Explanation shown in orange box in expanded view
* Breakdown shows 5 factors: Location Match, Budget Match, Category Match, Time Match, Popularity
* Each factor has a visual bar (0-100%)
* Bonuses explained: +10% for intent match, +5% for vibe match, +3% for direct category match

#### Acceptance Criteria
```gherkin
Given I am viewing an expanded card with 87% match score
When I scroll to the "Why we recommend this" section
Then I see an orange box with match explanation
And I see 5 match factor bars:
  - Location Match: 95% (based on 2km distance)
  - Budget Match: 100% (price exactly in my range)
  - Category Match: 90% (direct category match)
  - Time Match: 85% (open during my preferred time)
  - Popularity: 80% (4.6 rating, high engagement)
And I see applied bonuses listed below

Given an experience has 98% match score (the maximum)
When I view the match explanation
Then I see "Perfect Match! 🎯" badge
And all factors show high percentages
```

---

### User Story 3.7: View Weather & Traffic Information
**As an** Explorer  
**I need** to see current weather and traffic conditions  
**So that** I can plan my visit at the optimal time  

#### Details and Assumptions
* Weather shows: conditions (sunny, cloudy, rain, etc.), temperature, wind, humidity, UV index
* Activity-specific recommendations (e.g., "Perfect weather for outdoor dining")
* Traffic shows: current traffic level (5 levels from Minimal to Heavy), travel time with delays, real-time updates
* Busy level shows: venue crowdedness (Quiet, Steady, Busy, Very Busy, Packed), peak hours, best times to visit

#### Acceptance Criteria
```gherkin
Given I am viewing an expanded card for an outdoor picnic spot
When I scroll to the weather section
Then I see current weather conditions (e.g., "Sunny, 72°F")
And I see an activity-specific recommendation like "Perfect weather for a picnic! ☀️"
And I see detailed metrics (wind: 5 mph, humidity: 45%, UV: 6)

Given I am viewing a card for a venue 5km away during rush hour
When I scroll to the traffic section
Then I see "Current traffic: Heavy 🚦"
And travel time shows "25 minutes (15 min longer than usual)"
And I see "Best time to avoid traffic: After 7:00 PM"

Given I am viewing a card for a popular restaurant on Saturday evening
When I scroll to the busy level section
Then I see "Very Busy - Currently packed 🔥"
And I see "Peak hours: 6:00 PM - 9:00 PM"
And I see "Quieter times: After 9:30 PM or before 5:30 PM"
```

---

## 4. Card Interactions

### User Story 4.1: Save Experience to Favorites
**As an** Explorer  
**I need** to save experiences I'm interested in  
**So that** I can review and plan them later  

#### Details and Assumptions
* Saved by swiping right or clicking heart icon
* Saved cards appear in Activity page > Saved tab
* Duplicates prevented with "Already saved" notification
* Timestamp recorded (savedAt)
* Tagged with session type (solo or board ID)
* Persisted to local storage and backend

#### Acceptance Criteria
```gherkin
Given I am viewing a card on the Home screen
When I swipe right or click the heart icon
Then the card is saved to my Saved tab
And I see a toast notification "❤️ Saved! [Card Title] has been added to your saved experiences"
And the card is removed from the swipe deck
And my savedExperiences count increases by 1

Given I have already saved "Sightglass Coffee"
When I encounter the same card again and try to save it
Then I see a notification "💖 Already Loved! Sightglass Coffee is already in your saved experiences"
And the card is not duplicated in my Saved tab

Given I save a card in solo mode
When I view the card in my Saved tab
Then the card shows "Solo" as the session type

Given I save a card while in collaboration mode on board "Weekend Plans"
When I view the card in my Saved tab
Then the card shows "Weekend Plans" as the session type
```

---

### User Story 4.2: Schedule Experience to Calendar
**As an** Explorer  
**I need** to schedule a saved experience to my calendar  
**So that** I can commit to a specific date and time  

#### Details and Assumptions
* Can be scheduled from Home (direct), Saved tab, or Board cards
* Requires date/time selection
* Creates calendar entry with status "locked-in"
* Generates suggested dates if date/time preferences exist
* Syncs to device calendar (Google/Apple/Outlook)
* Appears in Activity page > Calendar tab

#### Acceptance Criteria
```gherkin
Given I am viewing an expanded card
When I click "Schedule" button
Then a date/time picker modal opens
And I can select a date and time slot (Brunch, Afternoon, Dinner, Late Night)

Given I have selected a date and time for an experience
When I confirm the scheduling
Then a calendar entry is created with status "locked-in"
And the experience appears in my Calendar tab
And a notification shows "📅 Scheduled! [Card Title] added to your calendar"
And an event is added to my device calendar

Given I schedule an experience from a saved card
When I view my Calendar tab
Then the scheduled experience shows:
  - Date and time
  - Venue details
  - Status badge "Locked-In"
  - Option to propose new dates
  - Option to purchase if available

Given I schedule an experience in collaboration mode
When I view the board's calendar
Then all board members see the scheduled experience
And can vote on alternative dates if proposed
```

---

### User Story 4.3: Purchase Experience Tickets/Packages
**As an** Explorer  
**I need** to purchase tickets or packages for experiences  
**So that** I can secure my spot and access exclusive offerings  

#### Details and Assumptions
* Purchase options shown in expanded card view (Basic, Premium, Deluxe tiers)
* Each option shows: price, what's included, duration, special badges (Popular, Best Value)
* Payment processed via Stripe integration
* Multi-currency support based on account preferences
* Transparent fee breakdown shown before purchase
* QR code generated upon purchase for venue check-in
* Purchase history tracked in profile stats

#### Acceptance Criteria
```gherkin
Given I am viewing an expanded card with purchase options
When I scroll to the "Purchase Options" section
Then I see multiple tiers (e.g., Basic $50, Premium $85, Deluxe $120)
And each tier shows:
  - Price per person
  - What's included (itemized list)
  - Duration
  - Special badges if applicable

Given I click "Buy Now" on the Premium option
When the purchase modal opens
Then I see:
  - Selected package details
  - Price breakdown (subtotal, fees, taxes, total)
  - Currency selector based on my account preferences
  - Date/time picker if not already scheduled
  - Payment method input (Stripe)
  - Terms and conditions checkbox

Given I complete a purchase successfully
When the payment processes
Then I receive a confirmation notification "✅ Purchase Complete! Your tickets for [Experience] are ready"
And a QR code is generated
And the purchase appears in my Calendar tab with "Purchased" badge
And my purchasedExperiences count increases by 1

Given I have purchased tickets for an experience
When I view the calendar entry
Then I see a "View QR Code" button
And clicking it displays my check-in QR code
And venue details for easy access
```

---

### User Story 4.4: Share Experience with Friends
**As an** Explorer  
**I need** to share experiences with friends  
**So that** I can get their opinions or invite them to join  

#### Details and Assumptions
* Share button available on all cards (collapsed, expanded, saved, calendar)
* Share options: Copy link, Email, SMS, Social media (Facebook, Twitter, WhatsApp), Add to board
* Pre-filled share text includes card title, description, and link
* Tracks share count for social proof
* Can share with specific Mingla friends or external contacts

#### Acceptance Criteria
```gherkin
Given I am viewing any card (Home, Saved, Calendar)
When I click the "Share" button
Then a share modal opens
And I see share options:
  - Copy Link
  - Email
  - SMS
  - WhatsApp
  - Facebook
  - Twitter
  - Add to Board (if in solo mode)

Given I click "Copy Link"
When the link is copied to clipboard
Then I see a notification "Link copied to clipboard!"
And I can paste the link anywhere

Given I click "Email" in the share modal
When the email composer opens
Then the email contains:
  - Subject: "Check out this experience on Mingla: [Card Title]"
  - Body: Card description and link
  - Pre-filled from my account email

Given I click "Add to Board"
When the board selection modal opens
Then I see all my active collaboration boards
And I can select one or more boards to add the experience to
And board members receive a notification about the shared experience

Given I share an experience
When I view the card later
Then the share count increments (e.g., "📤 Shares: 15")
```

---

### User Story 4.5: Remove Card from Deck
**As an** Explorer  
**I need** to dismiss cards I'm not interested in  
**So that** I can focus on relevant experiences  

#### Details and Assumptions
* Removed by swiping left or clicking X icon
* Cards removed from current session only
* No confirmation required
* Card ID stored in removedCardIds to prevent reshowing
* Can be undone within 3 seconds via undo button

#### Acceptance Criteria
```gherkin
Given I am viewing a card on the Home screen
When I swipe left or click the X icon
Then the card is removed from the deck
And the next card appears immediately
And the card ID is added to removedCardIds

Given I have removed a card
When I refresh the page or return later
Then that card does not reappear in the deck

Given I accidentally swipe left on a card
When I see the next card appear
Then I see a brief "Undo" button for 3 seconds
When I click "Undo" within 3 seconds
Then the previous card returns to the deck
And it is removed from removedCardIds
```

---

### User Story 4.6: Leave Review & Rating
**As an** Explorer  
**I need** to leave reviews and ratings for experiences I've attended  
**So that** I can help other users make informed decisions  

#### Details and Assumptions
* Reviews prompted after experience date passes
* Can be left from Calendar tab entries
* Star rating required (1-5 stars)
* Written review optional (max 500 characters)
* Can upload photos (max 5 images)
* Review appears on card for other users
* Queue system for multiple reviews

#### Acceptance Criteria
```gherkin
Given I have a past calendar entry for an experience I attended
When I view the entry in my Calendar tab
Then I see a "Leave Review" button

Given I click "Leave Review"
When the review modal opens
Then I see:
  - Experience title and image
  - Star rating selector (1-5 stars)
  - Text area for written review (optional, 500 char max)
  - Photo upload option (max 5 images)
  - "Submit Review" button

Given I select a 4-star rating and write a review
When I click "Submit Review"
Then my review is saved and linked to the experience
And I see a notification "⭐ Review Posted! Thank you for sharing your experience"
And the review modal closes
And the calendar entry shows "Review Posted" badge

Given I have multiple past experiences without reviews
When I complete one review
Then the next review in the queue automatically opens
And I see "X more reviews pending" indicator

Given other users view the experience I reviewed
When they open the expanded card
Then they see my review with my name, rating, text, and photos
And the overall rating is updated to include my review
```

---

## 5. Collaboration System

### User Story 5.1: Create New Collaboration Board
**As an** Explorer  
**I need** to create a collaboration board  
**So that** I can plan experiences with friends  

#### Details and Assumptions
* Created from Collaborate button > Create tab
* Requires: board name, optional description, privacy setting (Public/Private)
* Can add members during creation or later
* Creator automatically assigned as Admin
* Board has unique ID and appears in Sessions tab
* Brand colors used for board UI

#### Acceptance Criteria
```gherkin
Given I click the Collaborate button
When I navigate to the "Create" tab
Then I see a form to create a new board with fields:
  - Board Name (required)
  - Description (optional)
  - Privacy (Public or Private)
  - Add Members (optional)

Given I fill in "Weekend Adventures" as board name
And I set privacy to "Private"
And I add 2 friends as members
When I click "Create Board"
Then a new board is created with ID "board-[timestamp]"
And I am set as the Admin
And the 2 friends receive board invitations
And the board appears in my Sessions tab
And I see a notification "🎉 Board Created! Weekend Adventures is ready"

Given I create a board without adding members
When the board is created
Then I can add members later from the board settings
And the board is active with just me as a member

Given I try to create a board without entering a name
When I click "Create Board"
Then I see an error "Board name is required"
And the board is not created
```

---

### User Story 5.2: Invite Members to Board
**As an** Explorer with a collaboration board  
**I need** to invite friends to my board  
**So that** we can plan experiences together  

#### Details and Assumptions
* Invites sent via in-app notification, email, or SMS
* Can invite Mingla users or external contacts
* External invites include link to sign up
* Pending invites shown with status
* Invites can be resent or cancelled
* Members can be added at any time

#### Acceptance Criteria
```gherkin
Given I am the Admin of a board "Date Night Ideas"
When I click "Invite Members" in the board settings
Then a member invitation modal opens
And I see options to:
  - Select from Mingla friends
  - Enter email addresses
  - Enter phone numbers

Given I select 2 Mingla friends to invite
When I click "Send Invites"
Then invitations are sent to both friends
And they appear in my Connections page with "Board Invite Sent" status
And the friends receive in-app notifications
And the board shows "2 pending invites"

Given I invite a friend via email who doesn't have Mingla
When they receive the invitation email
Then the email contains:
  - Board name and description
  - My name as the inviter
  - Link to join Mingla and accept the invite

Given a friend accepts my board invite
When they click "Accept"
Then they are added to the board as a Member
And I receive a notification "[Friend Name] joined your board [Board Name]"
And they can now see the board in their Sessions tab
```

---

### User Story 5.3: Accept/Decline Board Invitations
**As an** Explorer  
**I need** to respond to board invitations  
**So that** I can join boards I'm interested in  

#### Details and Assumptions
* Invites shown in Collaborate button > Invites tab
* Red notification dot on Collaborate button when invites pending
* Can accept or decline each invite
* Declining removes invite without notifying sender
* Accepting adds to my Sessions tab

#### Acceptance Criteria
```gherkin
Given I have 2 pending board invitations
When I click the Collaborate button
Then I see a red notification dot (indicator)
And the "Invites" tab shows "2"

Given I navigate to the Invites tab
When I view the pending invitations
Then I see each invite with:
  - Board name
  - Description
  - Inviter name
  - Number of current members
  - Accept and Decline buttons

Given I click "Accept" on a board invite for "Summer Trip Planning"
When the acceptance processes
Then I am added to the board as a Member
And the board appears in my Sessions tab
And I see a notification "✅ You joined Summer Trip Planning"
And the inviter receives a notification that I joined

Given I click "Decline" on a board invite
When the decline processes
Then the invite is removed from my Invites tab
And I am not added to the board
And the inviter is not notified of my decline
```

---

### User Story 5.4: Add Experience Cards to Board
**As an** Explorer in a collaboration board  
**I need** to add experience cards to the board  
**So that** members can review and vote on them  

#### Details and Assumptions
* Cards can be added from: Home swipe deck, Saved tab, Share function, Board card creator
* Added cards appear in board's discussion area
* All members can see added cards immediately
* Card shows who added it and when
* Cards start in "voting" state

#### Acceptance Criteria
```gherkin
Given I am viewing the Home screen in board mode "Weekend Plans"
When I swipe right on a card or click heart icon
Then the card is added to the "Weekend Plans" board
And I see "💙 Added to Weekend Plans!"
And the card appears in the board's Cards tab

Given I am viewing my Saved tab
When I click "Share" on a saved card
And select "Add to Board" > "Weekend Plans"
Then the card is added to the board
And all board members see the card in their board view
And a notification is sent to members "[My Name] added a new experience"

Given I add a card to a board
When other members view the board
Then they see the card with:
  - Full card details
  - "Added by [My Name]" label
  - Timestamp
  - Voting options (upvote/downvote)
  - Comment section

Given I am in a board
When I click "Create Experience" in the board
Then the Card Creator opens
And I can create a custom experience for the board
And once created, it's added to the board's cards
```

---

### User Story 5.5: Vote on Board Cards
**As an** Explorer in a collaboration board  
**I need** to vote on proposed experiences  
**So that** the group can decide which experiences to pursue  

#### Details and Assumptions
* Voting options: Upvote (👍), Downvote (👎), or Abstain
* Vote counts visible to all members
* Can change vote at any time
* Cards with majority upvotes can be "locked in"
* Admin can lock in cards regardless of votes

#### Acceptance Criteria
```gherkin
Given I am viewing cards in board "Weekend Plans"
When I see a card proposed by another member
Then I see voting buttons: 👍 Upvote and 👎 Downvote
And current vote tally (e.g., "3 up, 1 down")

Given I click "Upvote" on a card
When my vote is recorded
Then the upvote count increases by 1
And my profile icon appears in the "Voted Yes" section
And other members see the updated vote count

Given I have already upvoted a card
When I click "Downvote"
Then my vote changes from upvote to downvote
And vote counts update (upvote -1, downvote +1)

Given a card has 4 upvotes and 1 downvote
When the Admin views the card
Then they see "Majority Approved ✅" badge
And a "Lock In" button to finalize the decision

Given a card is locked in by Admin
When members view the card
Then voting buttons are disabled
And the card shows "Locked-In 🔒" status
And the card appears in the board's Calendar tab
```

---

### User Story 5.6: Participate in Board Discussion
**As an** Explorer in a collaboration board  
**I need** to discuss experiences with board members  
**So that** we can coordinate and make decisions together  

#### Details and Assumptions
* Two discussion areas: General board chat and per-card comments
* Real-time messaging (or polling-based updates)
* Can mention members with @username
* Can attach images, links, and location pins
* Messages timestamped and show sender avatar/name

#### Acceptance Criteria
```gherkin
Given I am in board "Date Night Ideas"
When I click the "Discussion" tab
Then I see a chat interface with:
  - Message history
  - Input field for new messages
  - Send button
  - Members list sidebar

Given I type a message "What about trying this new tapas place?"
When I press Enter or click Send
Then my message appears in the chat
And all board members see the message
And members receive a notification (if offline)

Given I am viewing a specific card in the board
When I scroll to the Comments section
Then I see card-specific comments
And I can add a new comment about that card
And comments show member name, avatar, and timestamp

Given I want to mention a board member
When I type "@" in the message input
Then I see an autocomplete list of board member names
And selecting a name inserts "@username" in the message
And that member receives a specific notification about being mentioned
```

---

### User Story 5.7: Manage Board Member Roles
**As an** Explorer who is a board Admin  
**I need** to manage member roles and permissions  
**So that** I can control who can perform certain actions  

#### Details and Assumptions
* Two roles: Admin and Member
* Admins can: add/remove members, promote/demote members, lock in cards, change board settings, delete board
* Members can: add cards, vote, comment, invite friends (if allowed)
* Creator is original Admin and cannot be demoted unless they transfer ownership
* Multiple Admins allowed

#### Acceptance Criteria
```gherkin
Given I am the Admin of board "Weekend Plans"
When I open board settings and view the Members tab
Then I see all members with their roles (Admin or Member)
And I see action buttons for each member: "Promote to Admin", "Demote", "Remove"

Given I click "Promote to Admin" for member "Alex Rivera"
When the action confirms
Then Alex is promoted to Admin role
And Alex can now perform Admin actions (lock cards, manage members, etc.)
And I see a notification "Alex Rivera is now an Admin"

Given I click "Demote" on Admin "Taylor Kim" (who is not the creator)
When the action confirms
Then Taylor is demoted to Member role
And Taylor loses Admin permissions
And I see a notification "Taylor Kim is now a Member"

Given I try to demote myself and I'm the only Admin
When I click "Demote"
Then I see an error "Cannot demote yourself. The board must have at least one Admin."
And my role is not changed

Given I click "Remove" for member "Morgan Chen"
When I confirm the removal
Then Morgan is removed from the board
And Morgan's board access is revoked
And Morgan receives a notification "You have been removed from [Board Name]"
```

---

### User Story 5.8: Leave Collaboration Board
**As an** Explorer in a collaboration board  
**I need** to leave a board I no longer want to be part of  
**So that** I can manage my board memberships  

#### Details and Assumptions
* Any member can leave a board at any time
* Leaving removes access immediately
* If leaving as Admin, must promote another member first (if not sole member)
* Can be re-invited later
* Past contributions (cards, votes, comments) remain visible but attributed to "Former Member"

#### Acceptance Criteria
```gherkin
Given I am a Member of board "Summer Trip Planning"
When I open board settings and click "Leave Board"
Then I see a confirmation dialog "Are you sure you want to leave this board?"
And options: "Cancel" and "Leave Board"

Given I confirm leaving the board
When I click "Leave Board"
Then I am removed from the board
And the board disappears from my Sessions tab
And I see a notification "You left Summer Trip Planning"
And other members see "[My Name] left the board"

Given I am an Admin of a board with other Admins
When I leave the board
Then my Admin role is transferred to another Admin (if multiple)
And I am removed as a member

Given I am the only Admin of a board with other members
When I try to leave the board
Then I see "You must promote another member to Admin before leaving"
And I cannot leave until I promote someone

Given I am the sole member of a board I created
When I leave the board
Then the board is deleted
And I see "Board deleted as you were the only member"
```

---

## 6. Activity Management

### User Story 6.1: View All Boards
**As an** Explorer  
**I need** to view all my collaboration boards in one place  
**So that** I can manage multiple group planning sessions  

#### Details and Assumptions
* Boards shown in Activity page > Boards tab
* Each board card shows: name, member count, locked-in count, last activity, status (active/voting/locked/completed)
* Can search and filter boards
* Filters: All, Active, Voting, Locked, Completed
* Search by board name or member name

#### Acceptance Criteria
```gherkin
Given I have 5 collaboration boards
When I navigate to Activity page > Boards tab
Then I see all 5 boards displayed as cards
And each board card shows:
  - Board name
  - Member avatars (up to 4, then "+N")
  - Number of locked-in experiences
  - Last activity timestamp
  - Status badge (Active/Voting/Locked/Completed)

Given I have boards in different states
When I click the filter dropdown
Then I see filter options: All, Active, Voting, Locked, Completed
And selecting a filter shows only boards in that state

Given I search for "weekend" in the board search
When I type in the search field
Then I see only boards with "weekend" in the name
And boards with members named "weekend" (if any)

Given I click on a board card "Date Night Ideas"
When the board details open
Then I see the full board interface with:
  - Discussion tab
  - Cards tab
  - Members tab
  - Settings
```

---

### User Story 6.2: View Saved Experiences
**As an** Explorer  
**I need** to view all my saved experiences  
**So that** I can review and schedule them later  

#### Details and Assumptions
* Saved experiences shown in Activity page > Saved tab
* Two sections: Active (current interests) and Archives (past experiences)
* Active section shows recently saved cards
* Archives section auto-populated with cards older than 30 days
* Can manually archive/unarchive cards
* Search and filter by category, session type (Solo/Board)
* Each card shows: image, title, category, rating, price, saved date

#### Acceptance Criteria
```gherkin
Given I have 10 saved experiences
When I navigate to Activity page > Saved tab
Then I see two collapsible sections: "Active" and "Archives"
And Active section is expanded by default
And Archives section is collapsed by default

Given I have 7 cards saved in the last 30 days
When I view the Active section
Then I see all 7 cards displayed
And each card shows:
  - Thumbnail image
  - Title and category
  - Rating and review count
  - Price range
  - "Saved [X days] ago" timestamp
  - Action buttons (Schedule, Share, Archive, Remove)

Given I have 3 cards saved more than 30 days ago
When I expand the Archives section
Then I see the 3 archived cards
And they show "Archived [X days] ago" instead of "Saved"

Given I click "Schedule" on a saved card
When the date/time picker opens
And I select a date and time
And I confirm
Then the card is added to my Calendar tab
And remains in my Saved tab (marked as "Scheduled")

Given I click "Archive" on an active saved card
When the action confirms
Then the card moves from Active to Archives section
And I see "Card archived"

Given I search for "coffee" in the Saved tab
When I type in the search field
Then I see only saved cards with "coffee" in title, description, or category
```

---

### User Story 6.3: View Calendar Entries
**As an** Explorer  
**I need** to view all my scheduled and purchased experiences  
**So that** I can manage my upcoming plans  

#### Details and Assumptions
* Calendar entries shown in Activity page > Calendar tab
* Two sections: Active (upcoming) and Past (historical)
* Active section shows entries with future dates or within last 7 days
* Past section shows entries older than 7 days
* Each entry shows: date/time, experience details, status (Locked-In/Purchased), QR code access (if purchased)
* Can search and filter by date range (Today, This Week, This Month, Upcoming)
* Can filter by type (All, Purchased, Scheduled)

#### Acceptance Criteria
```gherkin
Given I have 5 upcoming calendar entries and 3 past entries
When I navigate to Activity page > Calendar tab
Then I see two sections: "Active" and "Past"
And Active section shows 5 upcoming entries
And Past section shows 3 historical entries

Given I have a calendar entry for tomorrow
When I view the Active section
Then I see the entry with:
  - Date and time (e.g., "Tomorrow, Dec 15 at 7:00 PM")
  - Experience title, image, and category
  - Status badge ("Locked-In" or "Purchased")
  - Venue address
  - Action buttons (View QR Code if purchased, Propose New Date, Cancel, Leave Review if past)

Given I have a purchased experience
When I view the calendar entry
Then I see a "View QR Code" button
And clicking it displays my check-in QR code
And venue contact information for easy access

Given I have a past entry from 10 days ago that I attended
When I view the Past section
Then I see the entry marked as "Past"
And I see a "Leave Review" button
And clicking it opens the review modal

Given I filter the calendar by "This Week"
When I select the time filter
Then I see only entries scheduled for the current week
And past entries are hidden

Given I filter by "Purchased" type
When I select the type filter
Then I see only entries with purchased tickets
And entries that are just scheduled are hidden
```

---

### User Story 6.4: Propose Alternative Dates
**As an** Explorer with a scheduled experience  
**I need** to propose alternative dates  
**So that** I can coordinate with friends if plans need to change  

#### Details and Assumptions
* Available for calendar entries in collaboration boards
* Can propose up to 3 alternative dates
* All board members notified of proposal
* Members can vote on proposed dates
* Majority vote changes the scheduled date
* Original date remains until new date is agreed upon

#### Acceptance Criteria
```gherkin
Given I have a scheduled experience in board "Weekend Plans"
When I view the calendar entry
Then I see a "Propose New Date" button

Given I click "Propose New Date"
When the date proposal modal opens
Then I see:
  - Current scheduled date
  - Option to propose up to 3 alternative dates
  - Date/time pickers for each proposal
  - "Send Proposal" button

Given I propose 2 alternative dates (Friday 7pm, Saturday 6pm)
When I click "Send Proposal"
Then all board members receive a notification "New date proposal for [Experience]"
And the calendar entry shows "Date Change Proposed" badge
And members can vote on the proposed dates

Given 3 out of 4 board members vote for "Saturday 6pm"
When the majority is reached
Then the calendar entry date updates to Saturday 6pm
And all members see "Date changed to Saturday, Dec 16 at 6:00 PM"
And device calendars are updated automatically

Given I am the Admin of the board
When I view date proposals
Then I can "Accept" any proposed date immediately
And override the voting process
```

---

### User Story 6.5: Cancel Calendar Entry
**As an** Explorer  
**I need** to cancel a scheduled experience  
**So that** I can remove plans that are no longer happening  

#### Details and Assumptions
* Available for all calendar entries
* For purchased experiences, shows refund policy before canceling
* For board entries, all members notified of cancellation
* Canceled entries moved to Past section with "Canceled" status
* Cannot cancel within 2 hours of scheduled time for purchased experiences

#### Acceptance Criteria
```gherkin
Given I have a scheduled experience (not purchased)
When I click "Cancel" on the calendar entry
Then I see a confirmation dialog "Cancel this experience?"
And options: "Cancel Experience" and "Keep It"

Given I confirm the cancellation
When I click "Cancel Experience"
Then the entry is removed from Active section
And moved to Past section with "Canceled" status
And I see "Experience canceled"

Given I have a purchased experience
When I click "Cancel"
Then I see the refund policy displayed
And a warning "Refund: $0 (non-refundable within 24 hours)"
And options: "Proceed with Cancellation" and "Keep Reservation"

Given I cancel a purchased experience outside refund window
When I confirm cancellation
Then my ticket is canceled
And no refund is issued
And the entry shows "Canceled (No refund)"

Given I try to cancel a purchased experience 1 hour before start time
When I click "Cancel"
Then I see "Cannot cancel within 2 hours of scheduled time. Please contact venue directly."
And the cancellation is prevented

Given I cancel a board entry
When the cancellation processes
Then all board members receive "Calendar entry canceled by [My Name]"
And the entry is removed from the board's calendar
```

---

### User Story 6.6: Remove Saved Experience
**As an** Explorer  
**I need** to remove experiences from my Saved tab  
**So that** I can keep my list current and relevant  

#### Details and Assumptions
* Available for all saved cards in Active and Archives
* Permanent removal (not recoverable)
* Confirmation required
* Removed cards can be re-discovered and saved again later

#### Acceptance Criteria
```gherkin
Given I have a saved experience "Golden Gate Park Picnic"
When I click "Remove" on the card
Then I see a confirmation dialog "Remove this from saved?"
And options: "Remove" and "Cancel"

Given I confirm the removal
When I click "Remove"
Then the card is permanently deleted from my Saved tab
And I see "Removed from saved"
And my savedExperiences count decreases by 1

Given I remove a card from Saved
When I encounter the same card again on the Home screen
Then I can save it again
And it appears in my Saved tab as if newly saved
```

---

## 7. Connections & Social

### User Story 7.1: View Friends List
**As an** Explorer  
**I need** to view all my friends on Mingla  
**So that** I can see who I'm connected with and their activity  

#### Details and Assumptions
* Friends shown in Connections page > Friends tab
* Each friend card shows: avatar, name, username, last active status, mutual friends count
* Search by name or username
* Sort options: Recent Activity, Name (A-Z), Mutual Friends
* Can view friend profiles

#### Acceptance Criteria
```gherkin
Given I have 15 friends on Mingla
When I navigate to Connections page > Friends tab
Then I see all 15 friends displayed as cards
And each friend card shows:
  - Profile avatar
  - Full name
  - @username
  - Last active status (e.g., "Active now" or "Last seen 2 hours ago")
  - Mutual friends count (e.g., "5 mutual friends")
  - Action buttons (Message, View Profile)

Given I search for "alex" in the friends search
When I type in the search field
Then I see only friends with "alex" in their name or username

Given I sort friends by "Recent Activity"
When I select the sort option
Then friends are ordered by most recently active first

Given I click "View Profile" on a friend card
When the profile opens
Then I see their full profile with:
  - Cover photo and avatar
  - Bio and location
  - Stats (experiences saved, boards joined)
  - Recent activity (if visible per privacy settings)
```

---

### User Story 7.2: Send Friend Requests
**As an** Explorer  
**I need** to send friend requests to other users  
**So that** I can connect with people I know  

#### Details and Assumptions
* Search for users by name, username, or email
* Can browse suggested friends (mutual connections, same boards)
* Friend request includes optional message
* Pending requests shown with status
* Can cancel pending requests

#### Acceptance Criteria
```gherkin
Given I am on the Connections page
When I click "Add Friend" button
Then a friend search modal opens
And I see:
  - Search field
  - Suggested friends section
  - Recent interactions section

Given I search for "jordan.explorer@mingla.com"
When I find the user in search results
Then I see their profile card with "Add Friend" button

Given I click "Add Friend"
When the request form opens
Then I can add an optional message (e.g., "Hey! Let's plan some adventures together")
And click "Send Request"

Given I send a friend request
When the request is sent
Then the user receives a notification
And I see "Friend request sent to [Name]"
And the Add Friend button changes to "Request Sent"
And I can cancel the request if desired

Given I have sent 3 friend requests
When I view my Connections page
Then I see "3 pending requests" indicator
And can view the list of pending outgoing requests
```

---

### User Story 7.3: Accept/Decline Friend Requests
**As an** Explorer  
**I need** to respond to incoming friend requests  
**So that** I can control who I connect with  

#### Details and Assumptions
* Incoming requests shown in Connections page or notification center
* Badge count on Connections tab shows pending requests
* Can accept or decline
* Accepting adds friend to Friends tab
* Declining removes request without notifying sender
* Can block user during decline

#### Acceptance Criteria
```gherkin
Given I have 2 incoming friend requests
When I navigate to Connections page
Then I see a notification badge "2" on the page
And a "Friend Requests" section at the top

Given I view the Friend Requests section
When I see the pending requests
Then each request shows:
  - Requester's avatar and name
  - Optional message they sent
  - Mutual friends count
  - Accept and Decline buttons

Given I click "Accept" on a friend request from "Alex Rivera"
When the acceptance processes
Then Alex is added to my Friends tab
And I am added to Alex's Friends tab
And we both see "You are now friends with [Name]"
And we can now message each other directly

Given I click "Decline" on a friend request
When the decline processes
Then the request is removed
And the requester is not notified
And I see "Friend request declined"

Given I want to decline and block a user
When I click "Decline" and select "Block User"
Then the request is declined
And the user is blocked from sending future requests
And I see "User blocked"
```

---

### User Story 7.4: Remove Friend
**As an** Explorer  
**I need** to remove a friend from my connections  
**So that** I can manage my network  

#### Details and Assumptions
* Available from friend card or profile
* Requires confirmation
* Removes friendship for both users
* Does not notify removed friend
* Can re-add later via friend request

#### Acceptance Criteria
```gherkin
Given I have "Taylor Kim" in my Friends list
When I click the menu icon on their friend card
Then I see options including "Remove Friend"

Given I click "Remove Friend"
When the confirmation dialog appears
Then I see "Remove Taylor Kim from your friends?"
And options: "Remove" and "Cancel"

Given I confirm the removal
When I click "Remove"
Then Taylor is removed from my Friends list
And I am removed from Taylor's Friends list
And we can no longer see each other's private activity
And I see "Friend removed"
And Taylor is not notified of the removal

Given I want to re-add a removed friend
When I search for them and send a friend request
Then the process works as if we were never friends
And they can accept or decline the new request
```

---

### User Story 7.5: View Conversation List
**As an** Explorer  
**I need** to view all my message conversations  
**So that** I can keep track of my communications  

#### Details and Assumptions
* Conversations shown in Connections page > Messages tab
* Each conversation shows: participant avatars, last message preview, timestamp, unread badge
* Sorted by most recent activity
* Search by participant name or message content
* Unread count badge on Connections tab

#### Acceptance Criteria
```gherkin
Given I have 8 active conversations
When I navigate to Connections page > Messages tab
Then I see all 8 conversations displayed as cards
And each conversation card shows:
  - Participant avatar(s)
  - Participant name(s)
  - Last message preview (truncated)
  - Timestamp of last message
  - Unread badge if messages are unread

Given I have 3 conversations with unread messages
When I view the Connections tab in navigation
Then I see a badge "3" indicating unread conversations

Given I search for "alex" in messages
When I type in the search field
Then I see conversations with "alex" as a participant
And conversations containing "alex" in message text

Given I click on a conversation card
When the conversation opens
Then I see the full chat view with message history
And can send new messages
```

---

## 8. Messaging & Communication

### User Story 8.1: Send Direct Messages
**As an** Explorer  
**I need** to send direct messages to friends  
**So that** I can communicate one-on-one  

#### Details and Assumptions
* Available for all friends
* Real-time or polling-based message delivery
* Text messages up to 1000 characters
* Can attach images, links, experience cards
* Messages timestamped
* Read receipts shown

#### Acceptance Criteria
```gherkin
Given I am viewing a conversation with "Alex Rivera"
When I type a message "Hey! Want to check out that new café?"
And press Enter or click Send
Then my message appears in the chat
And Alex receives the message in real-time (or on next poll)
And the message shows timestamp

Given Alex has not yet read my message
When I view the conversation
Then I see "Sent" indicator below my message

Given Alex reads my message
When their client marks it as read
Then I see "Read" indicator and timestamp
And their avatar appears below the message

Given I want to share an experience
When I click the attachment button
And select "Share Experience"
And choose a card from my Saved or Current deck
Then the experience card is sent as a rich message
And Alex sees the full card preview with action buttons
```

---

### User Story 8.2: Create Group Chat
**As an** Explorer  
**I need** to create group chats with multiple friends  
**So that** we can coordinate plans together  

#### Details and Assumptions
* Can add up to 10 friends to a group chat
* Requires group name
* All members can send messages
* Admin can add/remove members
* Different from board discussions (no voting/card features)

#### Acceptance Criteria
```gherkin
Given I am on the Messages tab
When I click "New Group Chat"
Then a group creation modal opens
And I see:
  - "Group Name" field
  - Friend selector (multi-select)
  - "Create Group" button

Given I enter "Coffee Lovers" as group name
And select 3 friends to add
When I click "Create Group"
Then a new group chat is created
And all 3 friends receive "You were added to Coffee Lovers" notification
And the group appears in my Messages tab

Given I am in a group chat
When I send a message
Then all group members see the message
And it shows my name and avatar

Given I am the group admin
When I open group settings
Then I can add more members, remove members, or rename the group
```

---

### User Story 8.3: Receive and View Notifications
**As an** Explorer  
**I need** to receive notifications for important events  
**So that** I stay informed about activity relevant to me  

#### Details and Assumptions
* Notification types: Friend requests, Board invites, Messages, Board activity, Date proposals, Reviews, Purchases, System updates
* Shown in notification center (bell icon in navigation)
* Badge count shows unread notifications
* Can mark as read or delete
* Push notifications if enabled

#### Acceptance Criteria
```gherkin
Given I have 5 unread notifications
When I view the navigation bar
Then I see a red badge "5" on the bell icon

Given I click the bell icon
When the notification center opens
Then I see all notifications listed chronologically
And each notification shows:
  - Icon representing type
  - Title and message
  - Timestamp
  - Mark as read / Delete options

Given I receive a new friend request
When the notification arrives
Then I see a notification with:
  - Type: Friend Request
  - Message: "[Name] sent you a friend request"
  - Actions: View Request

Given I receive a message
When the notification arrives
Then I see:
  - Type: Message
  - Message: "[Name]: [Message preview]"
  - Action: Open Conversation

Given I click "Mark All as Read"
When the action processes
Then all notifications are marked as read
And the badge count resets to 0
```

---

## 9. Profile & Account Settings

### User Story 9.1: View My Profile
**As an** Explorer  
**I need** to view my profile  
**So that** I can see how others see me and my activity stats  

#### Details and Assumptions
* Profile includes: cover photo, avatar, name, username, bio, location, join date
* Stats: saved experiences count, boards joined, friends count, purchased experiences
* Recent activity feed (based on privacy settings)
* Edit button to update profile

#### Acceptance Criteria
```gherkin
Given I am on the Profile page
When the page loads
Then I see my profile with:
  - Cover photo (default or custom)
  - Profile avatar (80px/96px)
  - Full name and @username
  - Bio (if set)
  - Location (if set)
  - "Member since [Month Year]"

Given I scroll down on my profile
When I view the stats section
Then I see:
  - "X Saved Experiences"
  - "X Boards Joined"
  - "X Friends"
  - "X Purchased Experiences"

Given I have recent activity (saved cards, boards joined)
When I view the activity feed
Then I see recent actions with timestamps
And actions are filtered by my privacy settings
```

---

### User Story 9.2: Edit Profile Information
**As an** Explorer  
**I need** to edit my profile information  
**So that** I can keep my profile current and accurate  

#### Details and Assumptions
* Editable fields: First name, Last name, Username, Email, Bio, Location, Cover photo, Avatar
* Username must be unique and lowercase
* Email verification required for email changes
* Bio max 200 characters
* Image uploads supported for photos

#### Acceptance Criteria
```gherkin
Given I am on the Profile page
When I click "Edit Profile"
Then I see the profile settings screen
And all editable fields are shown in a form

Given I edit my first name from "Jordan" to "Alex"
And I click "Save"
When the update processes
Then my name is updated to "Alex"
And I see "Profile updated successfully"
And my new name appears throughout the app

Given I try to change my username to one already taken
When I enter "alex_rivera" and click "Save"
Then I see an error "This username is already taken"
And my username is not changed

Given I upload a new profile avatar
When I select an image file
Then the image is uploaded and cropped to square
And my avatar updates across the app
And I see "Profile photo updated"

Given I change my email address
When I enter a new email and click "Save"
Then I receive a verification email at the new address
And my email is not changed until I verify
And I see "Verification email sent to [new email]"
```

---

### User Story 9.3: Update Account Preferences
**As an** Explorer  
**I need** to update my account preferences  
**So that** I can customize my experience  

#### Details and Assumptions
* Preferences include: Currency, Measurement system (Metric/Imperial), Language, Notification settings, Privacy settings, Theme (Light/Dark)
* Changes apply immediately across the app
* Some preferences affect card display (currency, measurements)

#### Acceptance Criteria
```gherkin
Given I am on the Account Settings page
When I view the preferences section
Then I see options for:
  - Currency (USD, EUR, GBP, CAD, etc.)
  - Measurement System (Metric or Imperial)
  - Language (English, Spanish, French, etc.)
  - Notification Preferences
  - Privacy Settings
  - Theme (Light, Dark, Auto)

Given I change my currency from USD to EUR
When I save the preference
Then all prices across the app display in EUR
And I see "€" instead of "$"
And the Connections page shows "Currency updated to EUR"

Given I change my measurement system to Metric
When I save the preference
Then distances show in km instead of miles
And temperatures show in Celsius instead of Fahrenheit

Given I disable push notifications
When I toggle off "Push Notifications"
Then I stop receiving push notifications
And I still see in-app notifications
And I see "Push notifications disabled"
```

---

### User Story 9.4: Configure Privacy Settings
**As an** Explorer  
**I need** to control my privacy settings  
**So that** I can manage who sees my information  

#### Details and Assumptions
* Privacy options: Profile visibility (Public/Friends Only/Private), Activity status (show online/offline), Saved experiences visibility (Public/Friends/Private)
* Public: Anyone can see
* Friends Only: Only connected friends can see
* Private: Only me
* Default: Friends Only for most settings

#### Acceptance Criteria
```gherkin
Given I am on the Privacy Settings page
When I view the privacy options
Then I see:
  - "Profile Visibility" with options (Public, Friends Only, Private)
  - "Activity Status" toggle (Show when online)
  - "Saved Experiences" with options (Public, Friends Only, Private)

Given I set Profile Visibility to "Friends Only"
When I save the setting
Then only my friends can view my profile
And non-friends see "This profile is private"

Given I disable "Activity Status"
When I toggle it off
Then my friends don't see "Active now" status
And I appear as "Offline" even when online

Given I set Saved Experiences to "Private"
When I save the setting
Then only I can view my saved experiences
And they don't appear in my public profile
```

---

### User Story 9.5: Change Password
**As an** Explorer  
**I need** to change my password  
**So that** I can maintain account security  

#### Details and Assumptions
* Requires current password verification
* New password must meet security requirements (min 8 chars, uppercase, lowercase, number, special character)
* Confirmation required to prevent typos
* Session maintained after password change

#### Acceptance Criteria
```gherkin
Given I am on the Account Settings page
When I click "Change Password"
Then a password change form opens
And I see fields for:
  - Current Password
  - New Password
  - Confirm New Password

Given I enter my current password correctly
And enter a valid new password
And confirm the new password
When I click "Update Password"
Then my password is changed
And I see "Password updated successfully"
And I remain logged in

Given I enter an incorrect current password
When I try to update
Then I see "Current password is incorrect"
And my password is not changed

Given I enter a weak new password (e.g., "12345")
When I try to update
Then I see "Password must be at least 8 characters with uppercase, lowercase, number, and special character"
And my password is not changed
```

---

### User Story 9.6: Update Email Preferences
**As an** Explorer  
**I need** to update my email address  
**So that** I receive communications at my current email  

#### Details and Assumptions
* Email change requires verification at new address
* Verification link expires in 24 hours
* Old email remains active until verification complete
* Duplicate emails not allowed

#### Acceptance Criteria
```gherkin
Given I am viewing my Profile Settings
When I see the "Email" field in Personal Information section
Then I see my current email with an edit button

Given I click the edit button on the email field
When the field becomes editable
Then I see an input field with my current email
And Save (check) and Cancel (X) buttons

Given I change my email from "jordan@old.com" to "jordan@new.com"
And click Save
When the change processes
Then I receive a verification email at "jordan@new.com"
And I see "Verification email sent. Please check jordan@new.com"
And my email is not changed until I verify

Given I click the verification link in my email
When the verification completes
Then my email is updated to "jordan@new.com"
And I see "Email updated successfully"
And I can now log in with the new email

Given I try to change to an email already in use
When I enter "alex@mingla.com" (already registered)
And click Save
Then I see "This email is already associated with another account"
And my email is not changed
```

---

### User Story 9.7: View Purchase History
**As an** Explorer  
**I need** to view my purchase history  
**So that** I can track my spending and past experiences  

#### Details and Assumptions
* Purchase history shown in Profile > Purchases section
* Each purchase shows: experience title, date purchased, date scheduled, price paid, payment method, QR code access
* Can search and filter by date range
* Export option for records

#### Acceptance Criteria
```gherkin
Given I have made 5 purchases
When I navigate to Profile > Purchases
Then I see all 5 purchases listed chronologically
And each purchase shows:
  - Experience title and image
  - Date purchased
  - Date scheduled
  - Amount paid with currency
  - Payment method (e.g., "Visa ****1234")
  - "View Receipt" and "View QR Code" buttons

Given I click "View Receipt" on a purchase
When the receipt opens
Then I see detailed breakdown:
  - Experience package details
  - Subtotal
  - Fees
  - Taxes
  - Total paid
  - Transaction ID
  - Purchase date

Given I filter purchases by "Last 30 days"
When I select the date filter
Then I see only purchases from the last 30 days

Given I click "Export" on my purchase history
When the export processes
Then I receive a CSV file with all purchase records
```

---

## 10. Coach Marks & Guidance

### User Story 10.1: Complete Coach Mark Flow
**As a** new Explorer  
**I need** guided tooltips on my first visit  
**So that** I understand how to use the app  

#### Details and Assumptions
* Coach marks appear after completing onboarding
* 5 contextual steps with mobile-first design
* Non-obtrusive tooltips with arrows pointing to elements
* Brand-colored dashed lines (#eb7825) connecting tooltips to UI
* Progress shown (Step X of 5)
* Can skip at any time
* One-time experience (won't show again after completion)

#### Acceptance Criteria
```gherkin
Given I have just completed onboarding
When I land on the Home screen for the first time
Then the coach mark system automatically starts
And I see "Step 1 of 5" indicator
And a tooltip appears explaining the first feature

Given I am on coach mark Step 1
When the tooltip appears above the preferences button
Then I see:
  - Orange dashed arrow pointing to the button
  - Tooltip with title "Personalize Your Experience"
  - Description explaining the preferences feature
  - "Next" and "Skip Tour" buttons

Given I click "Next"
When I progress through the steps
Then I see tooltips for:
  - Step 1: Preferences button
  - Step 2: Mode switcher (Collaborate button)
  - Step 3: Card swipe actions
  - Step 4: Activity tab navigation
  - Step 5: Profile and settings

Given I complete all 5 steps
When I click "Finish" on Step 5
Then the coach marks disappear
And I see "You're all set! Start exploring 🎉"
And the completion is saved
And coach marks won't appear again on future visits

Given I click "Skip Tour" at any step
When I confirm skipping
Then all coach marks close immediately
And I can use the app normally
And I can restart the tour from Settings > Help > Restart Tour
```

---

### User Story 10.2: Access Help & Support
**As an** Explorer  
**I need** to access help documentation and support  
**So that** I can resolve issues and learn features  

#### Details and Assumptions
* Help available from Profile > Help & Support
* Sections: FAQs, Feature Guides, Contact Support, Restart Tour
* FAQs cover common questions organized by topic
* Contact support opens ticket system
* Feature guides provide detailed walkthroughs

#### Acceptance Criteria
```gherkin
Given I am on the Profile page
When I click "Help & Support"
Then I see the help center with sections:
  - Frequently Asked Questions
  - Feature Guides
  - Contact Support
  - Restart Coach Marks Tour

Given I click "Frequently Asked Questions"
When the FAQ section opens
Then I see questions organized by categories:
  - Getting Started
  - Discovering Experiences
  - Collaboration & Boards
  - Payments & Purchases
  - Account & Privacy
And each question expands to show the answer

Given I click "Contact Support"
When the support form opens
Then I see fields:
  - Issue Category (dropdown)
  - Subject
  - Description
  - Attach Screenshots (optional)
  - "Submit Ticket" button

Given I submit a support ticket
When the submission processes
Then I receive a confirmation "Support ticket submitted. We'll respond within 24 hours."
And I get a ticket ID for reference
And can track ticket status in Support section

Given I want to see the coach marks again
When I click "Restart Coach Marks Tour"
Then the coach mark system resets
And I see "Tour will start on your next visit to the Home screen"
```

---

## 11. Notifications

### User Story 11.1: Receive Real-Time Notifications
**As an** Explorer  
**I need** to receive real-time notifications  
**So that** I stay updated on important events  

#### Details and Assumptions
* Notification types categorized: Social (friend requests, messages), Activity (board updates, date proposals), Transactions (purchases, refunds), System (updates, maintenance)
* Appear in notification center and as toast popups
* Auto-hide after 5 seconds (configurable)
* Persist in notification history
* Sound and vibration (if enabled)

#### Acceptance Criteria
```gherkin
Given a friend sends me a message
When the message arrives
Then I see a toast notification popup showing:
  - Friend's avatar
  - "[Friend Name] sent you a message"
  - Message preview
And the notification auto-hides after 5 seconds
And the bell icon badge increments

Given someone invites me to a board
When the invite arrives
Then I see a toast notification:
  - Board icon
  - "[Name] invited you to [Board Name]"
  - "View Invite" action
And the notification appears in the notification center

Given I complete a purchase
When the transaction confirms
Then I see a success notification:
  - "✅ Purchase Complete!"
  - Experience name
  - "View QR Code" action
And the notification plays a success sound (if enabled)

Given I have notifications disabled in account settings
When an event occurs
Then notifications are logged to notification center only
And no toast popups or sounds appear
```

---

### User Story 11.2: Manage Notification Preferences
**As an** Explorer  
**I need** to control which notifications I receive  
**So that** I'm not overwhelmed by alerts  

#### Details and Assumptions
* Granular control by notification type
* Can enable/disable: Push notifications, Email notifications, SMS notifications, In-app notifications
* Can mute specific boards or users
* Quiet hours feature (no notifications during set times)

#### Acceptance Criteria
```gherkin
Given I am on Account Settings > Notifications
When I view the notification preferences
Then I see toggles for:
  - Push Notifications (master toggle)
  - Email Notifications
  - SMS Notifications
  - Notification Types:
    - Friend Requests
    - Messages
    - Board Activity
    - Date Proposals
    - Purchases & Payments
    - System Updates

Given I disable "Board Activity" notifications
When I toggle it off
Then I stop receiving notifications for board updates
And I see "Board activity notifications disabled"

Given I enable "Quiet Hours"
When I set quiet hours from 10 PM to 8 AM
Then no notifications arrive during those hours
And they queue up to deliver at 8 AM

Given I want to mute a specific board
When I open board settings and select "Mute Notifications"
Then I stop receiving notifications for that board
And other boards remain unaffected
```

---

## 12. Navigation

### User Story 12.1: Navigate Using Bottom Tab Bar
**As an** Explorer  
**I need** to navigate between main sections using a bottom tab bar  
**So that** I can quickly access different parts of the app  

#### Details and Assumptions
* 5 tabs: Home, Activity, Connections, Messages, Profile
* Icons with labels
* Active tab highlighted in brand orange (#eb7825)
* Badge counts shown on Activity, Connections, Messages (for unread/pending items)
* Persistent across sessions

#### Acceptance Criteria
```gherkin
Given I am using the app
When I view the bottom of the screen
Then I see 5 navigation tabs:
  - Home (house icon)
  - Activity (calendar icon)
  - Connections (users icon)
  - Messages (message icon)
  - Profile (user icon)

Given I am on the Home tab
When I view the navigation bar
Then the Home icon and label are orange (#eb7825)
And other tabs are gray

Given I tap the Activity tab
When the navigation occurs
Then I am taken to the Activity page
And the Activity icon turns orange
And the previous tab (Home) turns gray

Given I have 3 unread messages
When I view the navigation bar
Then I see a red badge "3" on the Messages tab icon

Given I have 2 pending friend requests and 1 board invite
When I view the navigation bar
Then I see a red badge "3" on the Connections tab icon
```

---

### User Story 12.2: Access Settings & Account Menu
**As an** Explorer  
**I need** to access app settings and account options  
**So that** I can manage my account and preferences  

#### Details and Assumptions
* Accessed from Profile tab
* Menu includes: Edit Profile, Account Settings, Privacy Settings, Help & Support, About, Log Out
* Settings organized by category
* Changes saved automatically or with explicit save button

#### Acceptance Criteria
```gherkin
Given I am on the Profile tab
When I scroll down below my profile info
Then I see a menu with options:
  - Edit Profile
  - Account Settings
  - Privacy Settings
  - Help & Support
  - Terms of Service
  - Privacy Policy
  - About Mingla
  - Log Out

Given I tap "Account Settings"
When the settings page opens
Then I see categories:
  - Personal Information
  - Account Preferences
  - Notifications
  - Security

Given I tap "Log Out"
When the confirmation dialog appears
Then I see "Are you sure you want to log out?"
And options: "Log Out" and "Cancel"
When I confirm
Then I am logged out
And redirected to the sign-in page
And my session is cleared
```

---

### User Story 12.3: Perform Global Search
**As an** Explorer  
**I need** to search across the entire app  
**So that** I can quickly find experiences, friends, boards, and content  

#### Details and Assumptions
* Search available from Home screen (magnifying glass icon)
* Searches: Experience cards, Friends, Boards, Saved items, Calendar entries
* Results categorized by type
* Recent searches saved
* Autocomplete suggestions

#### Acceptance Criteria
```gherkin
Given I am on the Home screen
When I tap the search icon in the header
Then a search modal opens
And I see a search input field with placeholder "Search experiences, friends, boards..."

Given I type "coffee" in the search
When I press Enter or click search
Then I see results categorized:
  - Experiences (5 cards with "coffee" in title/description)
  - Friends (2 friends with "coffee" in name/bio)
  - Boards (1 board named "Coffee Lovers")
  - Saved (3 saved experiences related to coffee)

Given I tap on an experience result
When the action processes
Then the expanded card view opens for that experience

Given I search for "alex rivera"
When I view results
Then I see Alex Rivera in the Friends category
And tapping opens their profile

Given I perform multiple searches
When I open the search modal again
Then I see "Recent Searches" with my last 5 searches
And can tap to re-run a search
```

---

## Implementation Checklist

### Phase 1: Core Authentication & Onboarding
- [ ] User Story 1.1: Multi-method sign-in
- [ ] User Story 1.2: Email-only sign-in
- [ ] User Story 1.3: Account creation with role selection
- [ ] User Story 1.4: Password reset
- [ ] User Story 2.1-2.10: Complete onboarding flow (10 steps)

### Phase 2: Discovery & Card Interactions
- [ ] User Story 3.1: View personalized cards
- [ ] User Story 3.2: Swipe functionality
- [ ] User Story 3.3: Preferences sheet
- [ ] User Story 3.4: Solo/collaboration mode switcher
- [ ] User Story 3.5-3.7: Expanded card details with match, weather, traffic
- [ ] User Story 4.1: Save experiences
- [ ] User Story 4.2: Schedule to calendar
- [ ] User Story 4.3: Purchase tickets
- [ ] User Story 4.4: Share experiences
- [ ] User Story 4.5: Remove cards
- [ ] User Story 4.6: Leave reviews

### Phase 3: Collaboration Features
- [ ] User Story 5.1: Create boards
- [ ] User Story 5.2: Invite members
- [ ] User Story 5.3: Accept/decline invites
- [ ] User Story 5.4: Add cards to boards
- [ ] User Story 5.5: Vote on cards
- [ ] User Story 5.6: Board discussions
- [ ] User Story 5.7: Manage member roles
- [ ] User Story 5.8: Leave boards

### Phase 4: Activity Management
- [ ] User Story 6.1: View all boards
- [ ] User Story 6.2: Saved experiences management
- [ ] User Story 6.3: Calendar entries
- [ ] User Story 6.4: Propose alternative dates
- [ ] User Story 6.5: Cancel calendar entries
- [ ] User Story 6.6: Remove saved experiences

### Phase 5: Social & Messaging
- [ ] User Story 7.1: Friends list
- [ ] User Story 7.2: Send friend requests
- [ ] User Story 7.3: Accept/decline requests
- [ ] User Story 7.4: Remove friends
- [ ] User Story 7.5: Conversation list
- [ ] User Story 8.1: Direct messaging
- [ ] User Story 8.2: Group chats
- [ ] User Story 8.3: Notifications

### Phase 6: Profile & Settings
- [ ] User Story 9.1: View profile
- [ ] User Story 9.2: Edit profile
- [ ] User Story 9.3: Account preferences
- [ ] User Story 9.4: Privacy settings
- [ ] User Story 9.5: Change password
- [ ] User Story 9.6: Update email
- [ ] User Story 9.7: Purchase history

### Phase 7: UX Enhancements
- [ ] User Story 10.1: Coach marks flow
- [ ] User Story 10.2: Help & support
- [ ] User Story 11.1: Real-time notifications
- [ ] User Story 11.2: Notification preferences
- [ ] User Story 12.1: Bottom tab navigation
- [ ] User Story 12.2: Settings menu
- [ ] User Story 12.3: Global search

---

## Related Documentation

- [MINGLA_COMPLETE_SYSTEM_GUIDE.md](./MINGLA_COMPLETE_SYSTEM_GUIDE.md) - System architecture and data flow
- [COACH_MARK_QUICK_START.md](./COACH_MARK_QUICK_START.md) - Coach mark system details
- [GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md](./GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md) - Payment system
- [MULTI_USER_SYSTEM.md](./MULTI_USER_SYSTEM.md) - Role-based permissions
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Technical architecture
- [README.md](./README.md) - Project overview

---

**Version**: 1.0  
**Last Updated**: October 25, 2025  
**Author**: Mingla Product Team
