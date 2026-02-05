# Card Data & User Preferences Guide

## Overview
This document explains what data Mingla's experience cards display to users and how user preferences filter and customize that information.

---

## User Preferences Available

### 1. **Experience Types**
Users select from 6 experience types that determine the nature of the activity:
- **Solo Adventure** - All categories available
- **First Date** - Curated for romantic first meetings (7 categories)
- **Romantic** - Intimate experiences (4 categories: Sip & Chill, Picnics, Dining Experiences, Wellness)
- **Friendly** - Casual hangouts (all categories except none)
- **Group Fun** - Activities for groups (5 categories: Play & Move, Creative, Casual Eats, Screen & Relax, Freestyle)
- **Business** - Professional settings (3 categories: Stroll, Sip & Chill, Dining Experiences)

### 2. **Budget Range**
Users set minimum and maximum price constraints:
- **Preset Options**: $0-25, $25-75, $75-150, $150+
- **Custom Range**: Users can input specific min/max values
- **Cards Filtered**: Only experiences within budget range appear

### 3. **Categories (10 Total)**
Users select specific activity types:
1. **Take a Stroll** - Parks, trails, waterfronts
2. **Sip & Chill** - Bars, cafés, wine bars, lounges
3. **Casual Eats** - Casual restaurants, diners, food trucks
4. **Screen & Relax** - Movies, theaters, comedy shows
5. **Creative & Hands-On** - Classes, workshops, arts & crafts
6. **Picnics** - Outdoor dining, scenic spots, park setups
7. **Play & Move** - Bowling, mini golf, sports, kayaking
8. **Dining Experiences** - Upscale or chef-led restaurants
9. **Wellness Dates** - Yoga, spas, sound baths, healthy dining
10. **Freestyle** - Pop-ups, festivals, unique or quirky events

### 4. **Date & Time**
Users choose when they want to go:
- **Now** - Immediate availability
- **Today** - Later today with time selection
- **This Weekend** - Weekend scheduling with time selection
- **Pick a Date** - Custom date with time selection

**Time Slots Available**:
- Brunch (11am-1pm)
- Afternoon (2pm-5pm)
- Dinner (6pm-9pm)
- Late Night (10pm-12am)

### 5. **Travel Mode**
Determines how travel time/distance is calculated:
- **Walking** (~5 km/h) - Good for short distances
- **Biking** (~15 km/h) - Faster than walking
- **Public Transit** (~20 km/h avg) - Includes wait time
- **Driving** (~30 km/h city) - Fastest option

### 6. **Travel Constraints**
Users set maximum acceptable travel:
- **Time-based**: Max minutes willing to travel
- **Distance-based**: Max km/miles willing to travel

### 7. **Location**
Starting point for travel calculations:
- **GPS** - Uses current device location
- **Search** - Manual address entry

---

## Card Data Display

### **Primary Card View (Collapsed)**

#### Visual Elements:
1. **Hero Image** - Full-width main photo
2. **Match Score Badge** - Top left (e.g., "87% Match")
3. **Gallery Indicator** - Top right (e.g., "1/4" if multiple photos)

#### Content Overlay (Bottom):
4. **Title** - Experience name (e.g., "Sightglass Coffee Roastery")
5. **Category Icon + Label** - Visual category identifier
6. **Action Buttons**:
   - **Buy Now** (if purchaseOptions available) OR **Schedule** (for free activities)
   - **Share** button

#### Quick Stats Bar:
7. **Rating** - Star rating (e.g., "4.6 (89)")
8. **Travel Time** - Based on selected travel mode (e.g., "12m")
9. **Price Range** - Quick price reference (e.g., "$15-40")

#### Additional Info:
10. **Description** - Brief teaser (2 lines max)
11. **Highlights** - Top 2 key features as pills (e.g., "Single Origin Coffee", "Cozy Atmosphere")
12. **+N indicator** - If more than 2 highlights exist

---

### **Expanded Card View (Modal)**

When user taps to expand, they see comprehensive details:

#### Header:
- **Match Score Badge** - Centered at top
- **Close Button** - To return to card stack

#### Image Gallery:
- **Full Image Carousel** - Swipeable photo gallery
- **Navigation Arrows** - Previous/next buttons
- **Dot Indicators** - Current position in gallery
- **Image Counter** - "3/4" display

#### Detailed Information:

**Title & Classification**:
- Full experience title
- Category icon + name
- Experience type label (e.g., "First Date")

**Stats Row**:
- ⭐ **Rating** (e.g., "4.6")
- 🧭 **Travel Time** (e.g., "12m")
- 💲 **Price Range** (e.g., "$15-40")

**Match Explanation Box** (Orange):
- Why this card was recommended based on preferences
- Example: "Suggested because it matches your preference for first date experiences, fits within your $25-75 budget range, and scheduled for your preferred afternoon time."

**Weather Forecast** (Context-Aware):
- Current weather conditions
- Temperature
- Weather icon (Sunny, Cloudy, Rain, etc.)
- Activity-specific recommendation
- Wind speed, humidity, UV index

**Traffic & Busy Analysis**:
- Current traffic conditions to venue
- Estimated travel time with delays
- Venue busy level (5 levels: Quiet, Moderate, Busy, Very Busy, Packed)
- Time-based recommendations (best times to visit)
- Peak hours indicator

**Full Description**:
- Complete venue/activity description
- What to expect
- Atmosphere details

**Complete Highlights List**:
- All key features (not just top 2)
- Displayed as pill badges

**Tags**:
- Searchable keywords (e.g., "Coffee", "Cozy", "Local", "Casual")

**Practical Details**:
- 📍 **Address** - Full street address
- 🕐 **Opening Hours** - Operating schedule
- 📞 **Phone Number** (if available)
- 🌐 **Website Link** (if available)

**Social Proof**:
- 👁️ **Views** - How many users viewed this card
- ❤️ **Likes** - How many users liked it
- 🔖 **Saves** - How many users saved it
- 📤 **Shares** - How many times shared

**Match Breakdown**:
Visual bars showing 5 match factors (0-100%):
1. **Location Match** - How well venue location fits travel constraints
2. **Budget Match** - How well price aligns with user's budget
3. **Category Match** - Alignment with selected categories
4. **Time Match** - Availability during preferred time
5. **Popularity** - Overall rating and engagement

**Purchase Options** (if available):
Multiple tiers with:
- Option title (e.g., "Coffee Tasting Experience")
- Description
- Price
- What's included (itemized list)
- Duration
- Special badges ("Popular", "Best Value")
- Buy button for each tier

**Timeline/Itinerary** (for multi-venue experiences):
- Step-by-step schedule
- Location for each step
- Duration for each activity
- Map integration for navigation

---

## How Preferences Affect Cards

### **Filtering Logic**

1. **Experience Type Filter**:
   - Cards shown must match at least one selected experience type
   - Example: If "Romantic" selected, only shows Sip & Chill, Picnics, Dining, Wellness

2. **Category Filter** (Applied AFTER Experience Type):
   - Cards shown must be in selected categories
   - Example: If only "Sip & Chill" selected, no restaurant cards appear

3. **Budget Filter**:
   - Cards outside budget range are hidden
   - Free activities always show if budget includes $0
   - Budget text updates: "💰 $27 per person - Within your budget"

4. **Date/Time Filter**:
   - Cards must have availability during selected date/time
   - Venue hours checked against selected time slot

5. **Travel Constraint Filter**:
   - Distance from user location to venue calculated
   - Travel time estimated using selected travel mode
   - Cards beyond time/distance limit hidden

### **Match Score Calculation**

The overall match percentage (e.g., "87% Match") combines:

**Base Factors (5 components)**:
- **Location Match** (0-100%): Closer = higher score
- **Budget Match** (0-100%): Perfect fit = 100%, edges of range = lower
- **Category Match** (0-100%): Direct category match = high score
- **Time Match** (0-100%): Open during preferred time = higher
- **Popularity** (0-100%): Based on rating and engagement

**Onboarding Bonuses**:
- +10% if experience type matches onboarding intent
- +5% if tags/vibes match onboarding selections
- +3% if direct category match

**Maximum**: 98% (intentionally not 100% to maintain authenticity)

### **Dynamic Budget Text**

Budget display changes based on filtering:
- **Free**: "🎉 Free! Perfect for any budget"
- **Within Range**: "💰 $15-40 per person - Within your budget"
- **Perfect Match**: "Perfect for your $25-75 budget range"

### **No Results Handling**

When filters are too restrictive, user sees:
- Empty state message
- Active filter summary showing:
  - Budget range set
  - Number of categories selected
- **Reset button** to clear filters and start over

---

## Purchase Flow Integration

When user purchases an experience, they receive:

### **Immediate Actions**:
1. **Apple Pay Processing** - Secure payment modal
2. **Confirmation Screen** - Purchase success

### **Data Captured**:
From the purchase:
- Selected package tier
- Price paid
- What's included
- Duration
- Date/time preferences (from preferences sheet)

### **Automatic Calendar Integration**:
3. **Device Calendar Event** - Auto-created with:
   - Event title (experience name)
   - Location (venue address)
   - Date/time (user's selected preference)
   - Duration (from package)
   - Notes (what's included)

4. **Locked-In Tab** - Added to Activity page as scheduled event

### **Post-Purchase Access**:
- QR Code for venue check-in
- Confirmation details
- Booking reference
- Ability to reschedule
- Ability to cancel

---

## Summary: Complete Data Package

When a user sets preferences, each card provides:

✅ **Relevance**: Only shows cards matching ALL filters
✅ **Transparency**: Shows WHY card was matched (percentage breakdown)
✅ **Context**: Weather, traffic, busy times for informed decisions
✅ **Convenience**: Direct purchase, calendar integration, navigation
✅ **Social Proof**: Views, likes, saves, shares, reviews
✅ **Flexibility**: Multiple purchase tiers or free scheduling
✅ **Practical Info**: Hours, address, contact, website
✅ **Visual Appeal**: Gallery photos, icons, badges
✅ **Smart Recommendations**: Based on onboarding + real-time preferences

The system ensures users only see highly relevant options while providing all information needed to make confident decisions.
