# Card Generation with OpenAI & Google Places - Implementation Guide
## No Code, Strict Guidelines for Developers

---

## Table of Contents
1. [System Overview](#system-overview)
2. [The Card Generation Pipeline](#the-card-generation-pipeline)
3. [Preference Sheet to API Translation](#preference-sheet-to-api-translation)
4. [Google Places Query Construction](#google-places-query-construction)
5. [OpenAI Prompt Engineering](#openai-prompt-engineering)
6. [Card Validation & Quality Control](#card-validation--quality-control)
7. [Real-World Scenarios](#real-world-scenarios)
8. [Error Handling & Fallbacks](#error-handling--fallbacks)
9. [Performance Considerations](#performance-considerations)
10. [Testing & Validation](#testing--validation)

---

## System Overview

### The Problem We're Solving

When a user sets preferences in the Preferences Sheet, we need to generate highly relevant experience cards that EXACTLY match their criteria. This requires:

1. **Understanding user intent** from their preference selections
2. **Translating preferences** into specific API queries
3. **Generating rich card content** that goes beyond basic venue data
4. **Validating results** to ensure they actually match what was requested
5. **Enriching data** with context-aware details

### The Two-API Approach

**Google Places API** provides:
- Verified venue locations and addresses
- Real operating hours
- User ratings and review counts
- Photos of actual venues
- Contact information
- Price level indicators
- Accessibility information

**OpenAI API** provides:
- Rich, contextual descriptions
- Experience-type appropriate framing
- Ambience scoring and categorization
- Activity suggestions
- Match reasoning explanations
- Creative naming for multi-stop experiences
- Social context interpretation

### Core Principle: Preferences Are Requirements, Not Suggestions

**ABSOLUTE RULE**: Every preference selected by the user is a HARD REQUIREMENT. The system should NEVER generate cards that violate user preferences. If a user sets a budget of $25-75, do not show $100 experiences hoping they'll "upgrade their budget." If they select only "Sip & Chill," do not show dining experiences.

---

## The Card Generation Pipeline

### Phase 1: Preference Analysis (Before Any API Calls)

**Step 1: Extract User Intent**

From the Preferences Sheet, determine:

- **Primary Experience Context**: What social situation is this? (romantic date, business meeting, solo adventure, group hangout)
- **Activity Category**: What type of activity? (coffee, dining, outdoor, entertainment)
- **Budget Constraints**: Absolute min/max they're willing to spend per person
- **Time Requirements**: When they want to go and how long they can spend getting there
- **Location Constraints**: Starting point and maximum travel distance/time
- **Availability Needs**: Must be open at their scheduled time

**Step 2: Build Query Strategy**

Before calling APIs, determine:

- **Google Places Query Type**: Text search vs Nearby search vs Place Details
- **Search Radius**: Based on travel constraint and mode
- **Search Keywords**: Derived from categories and experience types
- **OpenAI Prompt Type**: Enhancement vs Generation vs Validation
- **Required Data Fields**: What information is mandatory vs optional

**Step 3: Validate Feasibility**

Check if the user's preferences are achievable:

- **Too Restrictive**: If budget is $0-10, categories are "Dining Experiences," and location constraint is 5 minutes walking, likely zero results
- **Contradictory**: If experience type is "Business" but category is "Play & Move," this is unusual
- **Incomplete**: If date is "Pick a Date" but no date selected, cannot check availability

If preferences are problematic, alert the user BEFORE making API calls.

---

### Phase 2: Google Places Query Construction

**The Google Places Query Builder**

For each category selected, construct specific queries:

#### Example: User Selects "Sip & Chill" Category

**Base Query Construction:**

1. **Determine Place Types** (Google's taxonomy):
   - cafe
   - bar
   - coffee_shop
   - wine_bar
   - lounge

2. **Add Context Keywords** based on Experience Type:
   - If "Romantic": Add "cozy," "intimate," "quiet," "date night"
   - If "Business": Add "wifi," "work-friendly," "quiet," "professional"
   - If "First Date": Add "casual," "relaxed," "conversation-friendly"
   - If "Friendly": Add "social," "lively," "gathering spot"
   - If "Group Fun": Add "spacious," "groups welcome," "social"

3. **Incorporate Budget Signals**:
   - $0-25: Add "affordable," "casual," "budget-friendly"
   - $25-75: Add "moderate," "mid-range"
   - $75-150: Add "upscale," "premium," "elevated"
   - $150+: Add "luxury," "fine," "high-end"

4. **Add Time-of-Day Context**:
   - Morning (6am-11am): Emphasize "breakfast," "coffee," "morning"
   - Afternoon (12pm-5pm): Emphasize "lunch," "afternoon tea," "daytime"
   - Evening (6pm-10pm): Emphasize "dinner," "cocktails," "evening"
   - Late Night (10pm+): Emphasize "late night," "nightlife," "open late"

5. **Location & Radius Calculation**:
   - Get user's starting location (GPS coordinates or searched address)
   - Calculate search radius based on travel constraint:
     - If time-based (e.g., "20 minutes walking"): Calculate radius in meters
       - Walking at 5 km/h: 20 min = 1,667 meters radius
       - Biking at 15 km/h: 20 min = 5,000 meters radius
       - Driving at 30 km/h: 20 min = 10,000 meters radius
     - If distance-based (e.g., "5 km"): Use directly as radius

**Final Query Example:**

```
Google Places Nearby Search:
- Location: 37.7749, -122.4194 (San Francisco)
- Radius: 1667 meters
- Type: cafe, bar, coffee_shop
- Keyword: "cozy intimate wifi quiet romantic"
- OpenNow: true (if user selected "Now")
- MinPrice: 2 (corresponds to $25-75 budget)
- MaxPrice: 3
```

#### Example: User Selects "Dining Experiences" Category

**Base Query Construction:**

1. **Determine Place Types**:
   - restaurant
   - meal_delivery (if they want takeout)
   - meal_takeaway

2. **Add Cuisine Context** (if user selected specific cuisines):
   - User selected "Italian": Add "italian restaurant"
   - User selected "Japanese": Add "japanese sushi"
   - No cuisine preference: Use broad "restaurant fine dining"

3. **Add Formality Level** based on Experience Type:
   - If "Romantic": Add "fine dining," "intimate," "upscale," "romantic restaurant"
   - If "Business": Add "business lunch," "quiet," "professional," "private dining"
   - If "Friendly": Add "casual dining," "relaxed," "comfortable"
   - If "Group Fun": Add "family style," "large tables," "groups welcome"

4. **Add Price Level**:
   - Budget $75-150: MinPrice: 3, MaxPrice: 3 (corresponds to $$$ in Google's system)
   - Budget $150+: MinPrice: 4, MaxPrice: 4 (corresponds to $$$$ in Google's system)

**Final Query Example:**

```
Google Places Nearby Search:
- Location: 37.7749, -122.4194
- Radius: 5000 meters (if driving 20 min)
- Type: restaurant
- Keyword: "fine dining romantic intimate upscale italian"
- OpenNow: false (if scheduled for later)
- MinPrice: 3
- MaxPrice: 3
```

---

### Phase 3: Google Places Response Processing

**What Google Places Returns (Per Venue):**

From each result, extract:

1. **Mandatory Fields** (must have or card is invalid):
   - Place ID
   - Name
   - Formatted Address
   - Latitude/Longitude coordinates
   - Place Types array

2. **Important Fields** (should have for quality):
   - Rating (1.0-5.0)
   - User Ratings Total (number of reviews)
   - Price Level (0-4, where 0 = free, 4 = very expensive)
   - Opening Hours (current and weekly schedule)
   - Photos array (URLs to venue images)

3. **Optional Fields** (nice to have):
   - Phone Number
   - Website
   - Wheelchair Accessible
   - Serves Vegetarian Food
   - Outdoor Seating
   - Serves Wine/Beer/Cocktails
   - Takeout/Delivery available

**Initial Filtering (Before OpenAI):**

IMMEDIATELY exclude venues that fail hard requirements:

1. **Budget Filter**:
   - If user budget is $25-75 (Price Level 2)
   - Google returns Price Level 1 ($0-25): EXCLUDE (too cheap might indicate low quality)
   - Google returns Price Level 2 ($25-75): INCLUDE
   - Google returns Price Level 3 ($75-150): EXCLUDE (too expensive)

2. **Availability Filter**:
   - If user scheduled "Saturday 7:00 PM"
   - Check venue's opening_hours.periods
   - If closed on Saturday: EXCLUDE
   - If closes before 7:00 PM: EXCLUDE
   - If opening hours unavailable: FLAG for manual review but INCLUDE

3. **Distance Filter**:
   - Calculate actual distance from user location to venue (Haversine formula)
   - If beyond user's constraint: EXCLUDE
   - Note: This is a rough filter; real travel time check comes later with Distance Matrix API

**Result Set Size:**

After initial filtering:
- Minimum acceptable: 5 venues (enough to show some options)
- Ideal: 20-30 venues (good variety without overwhelming)
- Maximum before pagination: 50 venues

If fewer than 5 venues after filtering:
- **Option 1**: Relax ONE constraint (usually budget or distance) by 25%
- **Option 2**: Broaden category (e.g., "Sip & Chill" + "Casual Eats")
- **Option 3**: Show "No Results" and ask user to adjust preferences

---

### Phase 4: OpenAI Enhancement

**Purpose of OpenAI**

Google Places gives you factual data. OpenAI gives you CONTEXT and PERSONALITY that makes cards compelling and ensures they truly fit the user's intent.

**What OpenAI Adds:**

1. **Rich Descriptions**: Not just "A coffee shop," but "A sunlit corner cafe with rustic wooden tables, perfect for lingering over a cappuccino and people-watching"

2. **Experience-Type Framing**: Same venue described differently based on context:
   - For "Romantic": "An intimate wine bar with candlelit corners and a thoughtfully curated selection"
   - For "Business": "A professional cafe with reliable wifi, quiet conversation spaces, and excellent coffee"
   - For "Friendly": "A lively neighborhood spot where locals gather for craft cocktails and conversation"

3. **Ambience Scoring**: Quantified attributes like:
   - Quietness: 75/100
   - Coziness: 85/100
   - Intimacy: 80/100
   - Sophistication: 70/100
   - Casualness: 40/100

4. **Highlight Generation**: Key features to display on card:
   - "Single Origin Pour-Overs"
   - "Outdoor Garden Seating"
   - "Craft Cocktail Menu"
   - "Late Night Hours"

5. **Match Reasoning**: Explanation of why this card matches preferences:
   - "Perfect for your romantic dinner - intimate seating, upscale Italian cuisine, and within your $75-150 budget"

**OpenAI Prompt Construction (The Critical Part)**

**Prompt Structure Template:**

```
SYSTEM CONTEXT:
You are helping generate experience recommendations for a user looking for [EXPERIENCE TYPE] activities.

USER PREFERENCES:
- Experience Type: [romantic/business/friendly/etc]
- Category: [Sip & Chill/Dining/etc]
- Budget: $[MIN]-$[MAX] per person
- Time: [Morning/Afternoon/Evening/Late Night]
- Special Requirements: [any dietary, accessibility, etc]

VENUE DATA FROM GOOGLE PLACES:
- Name: [venue name]
- Address: [full address]
- Rating: [X.X stars] ([N] reviews)
- Price Level: [$ symbols]
- Types: [cafe, bar, etc]
- Current Status: [Open/Closed]

TASK:
Generate a compelling experience card for this venue that:

1. DESCRIPTION (2-3 sentences):
   - Capture the ambience and vibe
   - Highlight what makes it special
   - Frame it appropriately for [EXPERIENCE TYPE]
   - Use sensory details (sights, sounds, atmosphere)

2. AMBIENCE SCORES (rate 0-100 for each):
   - Quietness: [score] (how quiet/peaceful is it)
   - Coziness: [score] (how warm/inviting)
   - Intimacy: [score] (how private/romantic)
   - Sophistication: [score] (how upscale/refined)
   - Casualness: [score] (how relaxed/informal)

3. EXPERIENCE TYPE FIT (rate 0-100 for each):
   - Solo Adventure: [score]
   - First Date: [score]
   - Romantic: [score]
   - Friendly: [score]
   - Group Fun: [score]
   - Business: [score]

4. HIGHLIGHTS (3-5 key features):
   - Feature that best represents the venue
   - Unique selling points
   - Amenities relevant to user's preferences

5. BEST TIME TO VISIT:
   - Optimal time of day for this venue
   - Busy vs quiet periods
   - Special recommendations

6. MATCH EXPLANATION (1 sentence):
   - Why this venue matches the user's specific preferences
   - Reference their budget, category choice, and experience type

FORMAT YOUR RESPONSE AS JSON.
```

**Example Prompt (Specific Case):**

```
USER PREFERENCES:
- Experience Type: Romantic
- Category: Sip & Chill
- Budget: $25-75 per person
- Time: Evening (7:00 PM)
- Location: San Francisco, Mission District

VENUE DATA:
- Name: "Trick Dog"
- Address: "3010 20th St, San Francisco, CA 94110"
- Rating: 4.6 stars (2,847 reviews)
- Price Level: $$ (Moderate)
- Types: Bar, Cocktail Bar
- Features: Craft cocktails, Creative menu, Hip atmosphere

Generate an experience card for a romantic evening date.
```

**Expected OpenAI Response:**

```json
{
  "description": "A creative cocktail haven with an ever-changing themed menu and intimate leather booths perfect for cozy conversation. The industrial-chic space strikes a balance between sophisticated and relaxed, with dim lighting and a curated vinyl soundtrack setting the mood for a memorable evening.",
  
  "ambienceScores": {
    "quietness": 55,
    "coziness": 75,
    "intimacy": 70,
    "sophistication": 80,
    "casualness": 60
  },
  
  "experienceTypeFit": {
    "soloAdventure": 45,
    "firstDate": 85,
    "romantic": 88,
    "friendly": 75,
    "groupFun": 60,
    "business": 40
  },
  
  "highlights": [
    "Inventive Craft Cocktails",
    "Themed Menu Changes Quarterly",
    "Intimate Booth Seating",
    "Curated Music Selection",
    "Award-Winning Bartenders"
  ],
  
  "bestTimeToVisit": "Arrive between 6-7 PM before the crowd, or after 9 PM for a more lively atmosphere. Weeknight evenings offer a more intimate vibe than weekends.",
  
  "matchExplanation": "Perfect for your romantic evening - creative cocktails in an intimate setting, $12-16 drinks fit your $25-75 budget, and the sophisticated yet approachable vibe is ideal for meaningful conversation."
}
```

**Critical OpenAI Guidelines:**

1. **Be Specific, Not Generic**:
   - BAD: "A nice coffee shop with good coffee"
   - GOOD: "A minimalist Scandinavian-inspired cafe serving meticulously crafted pour-overs from rotating single-origin beans"

2. **Match the User's Intent**:
   - For "Business" preference, emphasize: wifi, quiet, outlets, professional atmosphere
   - For "Romantic" preference, emphasize: intimacy, ambience, special touches, conversation-friendly
   - For "Group Fun" preference, emphasize: space, energy, shareable options, social atmosphere

3. **Be Honest About Scores**:
   - A dive bar should have LOW sophistication score (20/100), HIGH casualness (90/100)
   - A Michelin-star restaurant should have HIGH sophistication (95/100), LOW casualness (15/100)
   - Don't inflate scores to make venues seem better than they are

4. **Validate Against Reality**:
   - If Google says "Price Level: $" (cheap), OpenAI shouldn't describe it as "upscale"
   - If Google says "Rating: 3.2", OpenAI should acknowledge this isn't a top-tier venue
   - If Google says "Bar," OpenAI shouldn't describe it as a "quiet cafe"

5. **Generate Appropriate Highlights**:
   - For "Sip & Chill" category: beverage types, seating options, atmosphere features
   - For "Dining" category: cuisine style, signature dishes, dining format
   - For "Play & Move" category: activities offered, difficulty levels, group size options
   - For "Wellness" category: services offered, relaxation focus, mindfulness elements

---

### Phase 5: Data Merging & Card Assembly

**Combine Google Places + OpenAI Data**

For each venue that passed filtering, create a complete card object:

**From Google Places (Factual Data):**
- ID, Name, Address
- Coordinates (lat/lng)
- Rating, Review Count
- Price Level
- Opening Hours
- Photos (URLs)
- Phone, Website
- Place Types

**From OpenAI (Contextual Data):**
- Rich Description
- Ambience Scores
- Experience Type Fit Scores
- Highlights array
- Best Time to Visit
- Match Explanation

**Additional Calculated Fields:**

1. **Match Score** (0-100):
   - Weighted combination of:
     - Experience Type Fit: 40%
     - Location Proximity: 25%
     - Budget Fit: 20%
     - Popularity (rating × review count): 10%
     - Time Availability: 5%

2. **Travel Data** (from Google Distance Matrix API):
   - Distance in meters
   - Duration in seconds
   - Duration text ("18 mins")
   - Mode-specific data (traffic for driving, transit schedules)

3. **Availability Context**:
   - Is it open now? (boolean)
   - Is it open at user's scheduled time? (boolean)
   - When does it close? (time string)
   - How long until closing? (duration)

**Card Quality Validation Checklist:**

Before adding card to final results, verify:

✅ **Has all required fields**: Name, location, description, category
✅ **Matches budget constraint**: Price level within user's range
✅ **Matches category**: Google place types align with selected category
✅ **Available at target time**: Open during user's scheduled time
✅ **Within travel constraint**: Travel time/distance within user's limit
✅ **Has minimum rating**: At least 3.5 stars or 10+ reviews (configurable threshold)
✅ **Has photos**: At least 1 photo available
✅ **OpenAI scores make sense**: No contradictory scores (e.g., high intimacy + high casualness for a dive bar)
✅ **Description is relevant**: Mentions features appropriate to category and experience type

If any critical validation fails (❌), EXCLUDE the card from results.

---

### Phase 6: Scoring & Ranking

**The Match Score Algorithm**

After all cards are validated, calculate a precise match score for ranking:

**Component 1: Experience Type Fit (40% weight)**

From OpenAI's experienceTypeFit scores:
- Get scores for all user-selected experience types
- Calculate average
- Normalize to 0-40 scale

Example:
- User selected: "Romantic" and "First Date"
- OpenAI scores: Romantic: 88, First Date: 85
- Average: 86.5
- Weighted: 86.5 × 0.4 = 34.6 points

**Component 2: Location Proximity (25% weight)**

Based on actual travel time from Google Distance Matrix:
- 0-10 minutes: 25 points (perfect)
- 10-20 minutes: 20 points (great)
- 20-30 minutes: 15 points (good)
- 30-40 minutes: 10 points (acceptable)
- 40+ minutes: 5 points (far)

Example:
- Travel time: 12 minutes
- Score: 20 points

**Component 3: Budget Fit (20% weight)**

How well price aligns with budget range:
- Calculate budget midpoint
- Measure distance from midpoint
- Closer to midpoint = higher score

Example:
- User budget: $25-75 (midpoint: $50)
- Venue price: $45 per person
- Distance from mid: $5 (10% of range)
- Score: 20 × (1 - 0.1) = 18 points

**Component 4: Popularity (10% weight)**

Combination of rating and review volume:
- Rating score: (rating / 5) × 6 points
- Review volume score: min(log(reviews) / log(1000), 1) × 4 points

Example:
- Rating: 4.6 stars → 4.6/5 × 6 = 5.52 points
- Reviews: 2,847 → log(2847)/log(1000) × 4 = 3.64 points
- Total: 9.16 points

**Component 5: Time Availability (5% weight)**

Bonus points for optimal timing:
- Open now and user wants "Now": +5 points
- Open at scheduled time: +5 points
- Optimal time per OpenAI's recommendation: +3 bonus
- Open late (past 10 PM) and user wants late night: +2 bonus

**Final Match Score Calculation:**

```
Match Score = Component1 + Component2 + Component3 + Component4 + Component5

Example Total:
34.6 + 20 + 18 + 9.16 + 5 = 86.76
Rounded: 87% Match
```

**Sorting Rules:**

1. Primary: Match Score (descending)
2. Secondary: Distance (ascending) - if scores are equal
3. Tertiary: Rating (descending) - if scores and distance are equal

**Final Output:**

Return top 10 cards sorted by match score. Each card includes:
- All venue data (Google + OpenAI combined)
- Match score percentage
- Travel data
- Match explanation
- Source indicator (curator/business/api-generated)
- Generation timestamp

---

## Preference Sheet to API Translation

### Translation Matrix

**User Selects → API Actions Required**

#### Experience Type Selection

| User Selects | Google Places Query Modifications | OpenAI Prompt Context |
|--------------|----------------------------------|----------------------|
| Solo Adventure | Keywords: "solo-friendly", "individual", "self-paced" | Frame: Independent exploration, personal discovery |
| First Date | Keywords: "casual", "conversation", "relaxed" | Frame: Low-pressure, engaging, memorable |
| Romantic | Keywords: "intimate", "cozy", "romantic", "date night" | Frame: Romance, connection, special atmosphere |
| Friendly | Keywords: "social", "gathering", "hangout" | Frame: Casual bonding, fun, relaxed |
| Group Fun | Keywords: "groups", "spacious", "social", "parties" | Frame: Energy, variety, accommodation for groups |
| Business | Keywords: "professional", "wifi", "quiet", "work" | Frame: Productivity, discretion, professionalism |

#### Category Selection

| User Selects | Google Place Types | Keywords | OpenAI Enhancement Focus |
|--------------|-------------------|----------|--------------------------|
| Take a Stroll | park, hiking_area, tourist_attraction | "walking", "scenic", "outdoor" | Path quality, scenery, points of interest |
| Sip & Chill | cafe, bar, coffee_shop, wine_bar | Based on time of day + experience type | Beverage quality, ambience, seating |
| Casual Eats | restaurant, meal_takeaway, food | "casual", "quick", "affordable" | Food quality, variety, atmosphere |
| Screen & Relax | movie_theater, performing_arts_theater | "movies", "shows", "entertainment" | Comfort, programming, experience quality |
| Creative & Hands-On | art_gallery, store (craft stores) | "workshop", "class", "creative" | Activity type, instruction quality, materials |
| Picnics | park, campground | "picnic", "outdoor dining", "scenic" | Setting quality, amenities, views |
| Play & Move | gym, bowling_alley, sports_club | "active", "sports", "recreation" | Activity level, facilities, beginner-friendliness |
| Dining Experiences | restaurant | "fine dining", "upscale", "chef" | Cuisine, formality, romance/business fit |
| Wellness Dates | spa, gym, health | "wellness", "relaxation", "yoga" | Relaxation level, services, atmosphere |
| Freestyle | tourist_attraction, amusement_park | "unique", "quirky", "unusual" | Uniqueness, surprise factor, creativity |

#### Budget Range Selection

| User Sets | Google Price Level Filter | OpenAI Keyword Guidance | Quality Expectations |
|-----------|--------------------------|------------------------|---------------------|
| $0-25 | minprice=0, maxprice=1 | "affordable", "budget", "value" | Casual, no-frills, authentic |
| $25-75 | minprice=2, maxprice=2 | "moderate", "mid-range", "quality" | Good quality, comfortable, reliable |
| $75-150 | minprice=3, maxprice=3 | "upscale", "premium", "elevated" | High quality, refined, special occasion |
| $150+ | minprice=4, maxprice=4 | "luxury", "fine", "exclusive" | Exceptional, memorable, exclusive |

#### Date & Time Selection

| User Selects | Google Places Filter | OpenAI Context | Availability Check |
|--------------|---------------------|----------------|-------------------|
| Now | opennow=true | "currently open", "right now" | Must be open this instant |
| Today [time] | Check hours for today at [time] | "today at [time]" | Must be open at specified time today |
| This Weekend [time] | Check hours for Saturday at [time] | "weekend evening/brunch/etc" | Must be open on next Saturday |
| Pick Date [time] | Check hours for that day at [time] | Specific day context | Must be open on selected date/time |

#### Travel Mode Selection

| User Selects | Google Distance Matrix Mode | Radius Calculation | Speed Assumption |
|--------------|----------------------------|-------------------|------------------|
| Walking | mode=walking | Tight radius (1-2 km for 20 min) | 5 km/h average |
| Biking | mode=bicycling | Medium radius (3-6 km for 20 min) | 15 km/h average |
| Public Transit | mode=transit | Medium-wide radius (5-10 km for 20 min) | 20 km/h average with waits |
| Driving | mode=driving, traffic_model=best_guess | Wide radius (8-15 km for 20 min) | 30 km/h in city, 60 km/h highway |

#### Travel Constraint Selection

| Constraint Type | Implementation | Filter Logic |
|----------------|----------------|--------------|
| Time-based (e.g., 20 minutes) | Use Google Distance Matrix API to get real travel time | Exclude if travelTime > constraint |
| Distance-based (e.g., 5 km) | Use Google Distance Matrix API to get real distance | Exclude if distance > constraint |

---

## Google Places Query Construction

### Query Builder Decision Tree

**Step 1: Determine Search Type**

```
Is user looking for a specific named venue?
├─ YES → Use Place Details API (if you have place_id)
└─ NO → Continue to Step 2

Is search category location-specific (like parks, trails)?
├─ YES → Use Nearby Search
└─ NO → Use Text Search
```

**Step 2: Build Search Parameters**

**For Nearby Search:**

Required:
- location: User's GPS coordinates or searched address converted to lat/lng
- radius: Calculated from travel constraint
- type: Primary place type from category mapping

Optional but Recommended:
- keyword: Context keywords from experience type + budget + time
- opennow: true (if user selected "Now")
- minprice/maxprice: Based on budget range

**For Text Search:**

Required:
- query: Constructed search string combining category + context + location

Optional:
- location: User's coordinates (for biasing results)
- radius: Search area
- type: Primary place type
- opennow: true (if applicable)
- minprice/maxprice: Based on budget

**Step 3: Construct Keyword String**

Combine in priority order:
1. Category-specific keywords (highest priority)
2. Experience type keywords
3. Budget indicator keywords
4. Time-of-day keywords
5. Special features (if any dietary/accessibility preferences)

Maximum keyword string length: 160 characters (Google's limit)

**Example Construction:**

User Preferences:
- Category: Sip & Chill
- Experience: Romantic
- Budget: $75-150
- Time: Evening (7 PM)

Keyword String:
```
"intimate wine bar romantic upscale craft cocktails cozy evening date night"
```

Broken down:
- "intimate" (romantic context)
- "wine bar" (category specific)
- "romantic" (experience type)
- "upscale" (budget indicator)
- "craft cocktails" (quality indicator for price range)
- "cozy" (ambience descriptor for romantic)
- "evening" (time context)
- "date night" (use case clarification)

### Query Optimization Rules

**Rule 1: Prioritize Specificity Over Breadth**

BETTER: Fewer, more targeted results that truly match
WORSE: Many results that need heavy filtering

Example:
- BAD query: "restaurant San Francisco" → 10,000+ results, most irrelevant
- GOOD query: "romantic italian fine dining marina district San Francisco" → 50 results, mostly relevant

**Rule 2: Use Location Radius Appropriately**

Too small: Might miss great venues just outside radius
Too large: Wastes API quota on venues user will never visit

Recommended radii:
- Walking: 1,000-2,000 meters (tight, 15-30 min walk)
- Biking: 3,000-5,000 meters (medium, 15-25 min ride)
- Transit: 5,000-8,000 meters (medium-wide, 20-30 min with waits)
- Driving: 8,000-15,000 meters (wide, 20-30 min with traffic)

**Rule 3: Adjust for Density**

Urban areas (high density):
- Tighter radius
- More specific keywords
- Higher quality thresholds

Suburban/Rural (low density):
- Wider radius
- Broader keywords
- Lower quality thresholds (might be only option)

Detect density: Count total places in 1km radius. If >100, urban. If <20, rural.

**Rule 4: Handle No Results Gracefully**

If query returns <5 results:

1st fallback: Remove least important keyword (usually time-of-day)
2nd fallback: Expand radius by 50%
3rd fallback: Relax budget by one level (e.g., $$ → include $ and $$$)
4th fallback: Broaden category (e.g., "Sip & Chill" → include "Casual Eats")
Final fallback: Show "No Results" with suggestion to adjust preferences

**Rule 5: Respect API Quotas**

Google Places queries cost money. Optimize:
- Cache results for 5 minutes (venues don't change that fast)
- Batch similar queries
- Use Nearby Search instead of Text Search when possible (cheaper)
- Don't query for every user interaction; only on "Apply Preferences"

---

## OpenAI Prompt Engineering

### Prompt Design Principles

**Principle 1: Give OpenAI ALL Context**

The more context OpenAI has, the better its output. Include:
- Complete user preference set
- Google Places data for the venue
- Comparison context (is this a top-rated spot or average?)
- Geographic context (neighborhood vibe, city character)
- Temporal context (time of day, day of week, season)

**Principle 2: Request Structured Output**

Always ask for JSON format with specific fields. This ensures:
- Consistent parsing
- No hallucination of venue details
- Predictable data structure
- Easy validation

**Principle 3: Provide Examples**

Show OpenAI what good output looks like:

```
Example of a good description for a romantic cafe:
"A sunlit corner cafe with floor-to-ceiling windows, velvet armchairs, and handwritten menu boards. The gentle hum of conversation and clinking espresso cups creates an intimate backdrop for meaningful connection."

Example of a good description for a business cafe:
"A modern workspace-cafe hybrid with high-speed wifi, power outlets at every table, and a professional atmosphere. Perfect for client meetings or focus work over exceptional pour-over coffee."
```

**Principle 4: Enforce Constraints**

Tell OpenAI what NOT to do:
- "Do not invent details not present in the Google Places data"
- "Do not contradict the price level or rating"
- "Do not use clichés like 'hidden gem' or 'best kept secret'"
- "Keep description to 2-3 sentences maximum"

**Principle 5: Request Validation Reasoning**

Ask OpenAI to explain its scores:

```
For each ambience score, briefly explain why you assigned that rating based on the venue's actual characteristics from Google Places data (types, price level, reviews).
```

This helps catch hallucinations. If OpenAI can't explain the score, it's probably wrong.

### Prompt Templates for Each Category

#### Template: Sip & Chill

```
CONTEXT: User is looking for a [experience_type] experience in the "Sip & Chill" category.

USER PREFERENCES:
- Experience: [romantic/business/friendly/etc]
- Budget: $[min]-$[max] per person
- Time: [morning/afternoon/evening/late night]

VENUE FROM GOOGLE PLACES:
[paste all Google data]

TASK: Create a card that highlights:
1. Beverage offerings (coffee, tea, cocktails, wine)
2. Seating options and ambience
3. Suitability for [experience_type] context
4. Best times to visit for optimal experience

Provide ambience scores with special attention to:
- Quietness (critical for business/romantic)
- Coziness (critical for romantic/friendly)
- Sophistication level (should match price level)

If this is a coffee shop, emphasize morning/afternoon. If a bar, emphasize evening/late night.
```

#### Template: Dining Experiences

```
CONTEXT: User is planning a [experience_type] dining experience.

USER PREFERENCES:
- Experience: [romantic/business/friendly/etc]
- Budget: $[min]-$[max] per person
- Time: [brunch/lunch/dinner/late night]
- Cuisine: [if specified, e.g., Italian, Japanese]

VENUE FROM GOOGLE PLACES:
[paste all Google data]

TASK: Create a card that highlights:
1. Cuisine style and signature dishes (infer from reviews/description)
2. Dining atmosphere and formality level
3. Romantic features (if romantic) OR professional setting (if business)
4. Reservation recommendations

Provide scores with attention to:
- Formality level matching price point
- Romance score (intimacy, ambience, special touches)
- Group friendliness (table sizes, sharing options)

Cross-check: Does sophistication score align with price level? ($ = 20-40, $$ = 40-60, $$$ = 70-85, $$$$ = 90-100)
```

#### Template: Play & Move

```
CONTEXT: User wants an active/recreational [experience_type] experience.

USER PREFERENCES:
- Experience: [romantic/friendly/group/solo]
- Budget: $[min]-$[max] per person
- Skill Level: [if specified]

VENUE FROM GOOGLE PLACES:
[paste all Google data]

TASK: Create a card that highlights:
1. Specific activities offered
2. Physical intensity level
3. Beginner vs advanced suitability
4. Group vs solo friendliness
5. Equipment/instruction availability

Provide scores for:
- Physical intensity (0 = passive, 100 = very intense)
- Competitiveness (0 = non-competitive, 100 = highly competitive)
- Social interaction level
- Technical skill required

Rate experience type fit based on:
- Solo: Does this work well alone?
- First Date: Is this good for breaking the ice?
- Romantic: Can couples do this together romantically?
- Group: Can 4+ people participate together?
```

#### Template: Wellness

```
CONTEXT: User is seeking a wellness/relaxation [experience_type] experience.

USER PREFERENCES:
- Experience: [romantic couples/solo self-care/friendly group]
- Budget: $[min]-$[max] per person
- Wellness Focus: [physical/mental/spiritual]

VENUE FROM GOOGLE PLACES:
[paste all Google data]

TASK: Create a card that highlights:
1. Specific wellness services (massage, yoga, meditation, etc)
2. Relaxation vs activity balance
3. Couples options (if romantic)
4. Mindfulness components
5. Post-experience amenities

Provide scores for:
- Relaxation intensity (0 = active, 100 = pure relaxation)
- Mindfulness component (meditation, breathwork, etc)
- Physical benefit vs mental benefit balance
- Luxury level (should align with price)

Special considerations:
- If "romantic" and venue offers couples services, highlight heavily
- If "solo" focus on personal transformation/self-care angle
```

### Prompt Quality Checklist

Before sending to OpenAI, verify your prompt:

✅ Includes ALL user preferences
✅ Includes ALL Google Places data (don't summarize)
✅ Specifies exact JSON output format
✅ Provides scoring rubrics (what 0 means vs 100)
✅ Includes examples of good vs bad output
✅ Sets clear constraints (length limits, forbidden phrases)
✅ Requests validation reasoning
✅ Specifies experience type context clearly
✅ Mentions time-of-day relevance
✅ Cross-references with price level/rating from Google

### Handling OpenAI Responses

**Validation Steps:**

1. **Parse JSON**: Ensure response is valid JSON
2. **Check Required Fields**: All requested fields present?
3. **Validate Score Ranges**: All scores 0-100?
4. **Cross-Check Consistency**:
   - High sophistication + low price level = suspicious
   - Dive bar (low price) shouldn't have romance score >70
   - Business venue with quietness <40 = questionable
5. **Validate Description Length**: Within 2-3 sentence limit?
6. **Check for Hallucinations**: Description mentions specific details not in Google data?
7. **Verify Highlights**: Are these actually relevant to the category?

**If Validation Fails:**

- Log the error
- Try regenerating with more explicit constraints
- If still fails, use fallback generic descriptions
- Flag for manual review

**Fallback Descriptions (if OpenAI fails):**

Sip & Chill:
```
"A [price_level_descriptor] [venue_type] in [neighborhood] with a [rating] star rating. Known for [infer from Google types]."

Example: "A moderately-priced cafe in the Mission District with a 4.5 star rating. Known for specialty coffee and cozy atmosphere."
```

---

## Card Validation & Quality Control

### Multi-Layer Validation System

**Layer 1: Data Completeness**

Every card MUST have:
- Unique ID
- Name (from Google Places)
- Category (from user selection)
- Location (lat/lng)
- Address
- Description (from OpenAI or fallback)
- Match Score
- At least one highlight

Cards missing ANY of these are REJECTED immediately.

**Layer 2: Preference Compliance**

Every card MUST match:
- Category: Google place_types must align with selected category
- Budget: Price level must be within user's range
- Availability: Must be open at target time (if time specified)
- Location: Must be within travel constraint

Cards failing ANY of these are REJECTED (these are hard filters).

**Layer 3: Quality Thresholds**

Every card SHOULD meet:
- Minimum rating: 3.5 stars OR 10+ reviews (quality signal)
- Has photos: At least 1 photo available
- Has operating hours: Opening hours data present
- Recent activity: Last review within 6 months (still operating)

Cards failing these are FLAGGED but not necessarily rejected (depends on result quantity).

**Layer 4: OpenAI Output Validation**

Every OpenAI-enhanced card MUST:
- Have scores that make logical sense
- Description doesn't contradict Google data
- Highlights are relevant to category
- Match explanation references actual user preferences

**Layer 5: Diversity Check**

Final card set SHOULD have:
- Variety of price points (within user's range)
- Variety of sub-types (coffee vs wine vs cocktails for Sip & Chill)
- Geographic diversity (not all in same block)
- Rating diversity (not all 4.8+ stars; some 4.0-4.3 hidden gems ok)

### Rejection Reasons & Logging

Track WHY cards are rejected for analytics:

```
Rejection Reasons:
- Missing required field (which field?)
- Outside budget range (actual price?)
- Wrong category (place_types didn't match)
- Closed at target time
- Beyond travel constraint (actual distance?)
- Rating too low
- No recent reviews (last review date?)
- OpenAI hallucination detected
- Duplicate venue
```

This data helps improve the system over time.

### Quality Score (Separate from Match Score)

Assign quality score 0-100:
- Rating contribution: (rating / 5) × 40 points
- Review volume: min(log(reviews)/log(1000), 1) × 20 points
- Recency: Reviews in last 30 days = +10, last 90 days = +5
- Photo quality: 5+ photos = +10, 1-4 photos = +5
- Completeness: All optional Google fields = +10
- OpenAI confidence: High confidence = +10

Minimum acceptable quality score: 50/100

**Use Quality Score to:**
- Break ties between similar match scores
- Decide whether to relax filters if low result count
- Prioritize which cards to show first

---

## Real-World Scenarios

### Scenario 1: Romantic Dinner Date

**User Inputs:**
- Experience Type: Romantic
- Category: Dining Experiences
- Budget: $75-150 per person
- Date: Saturday, February 14 (Valentine's Day)
- Time: 7:00 PM
- Travel Mode: Driving
- Travel Constraint: 30 minutes max
- Location: Starting from downtown San Francisco (37.7749, -122.4194)

**System Processing:**

**Step 1: Google Places Query**
```
Nearby Search:
- Location: 37.7749, -122.4194
- Radius: 15,000 meters (30 min driving in city)
- Type: restaurant
- Keyword: "romantic fine dining intimate upscale date night valentine"
- MinPrice: 3 (corresponds to $$$)
- MaxPrice: 3
- OpenNow: false (checking for Saturday 7 PM specifically)
```

**Step 2: Filter Results**
- Receive ~50 restaurants
- Check each: Open Saturday at 7 PM? (excludes 10 lunch-only spots)
- Check each: Within driving distance per Distance Matrix? (excludes 5 in Oakland, Marin)
- Remaining: 35 venues

**Step 3: OpenAI Enhancement**
For each of 35 venues, send prompt:
```
User is planning a romantic dinner for Valentine's Day at 7 PM. Budget $75-150 per person. 

Venue: [Flour + Water]
- Italian restaurant
- Rating: 4.6 (1,234 reviews)
- Price: $$$
- Types: [restaurant, food, point_of_interest]

Generate romantic framing emphasizing:
- Intimate seating options
- Wine/cocktail pairings
- Ambience for couples
- Special Valentine's considerations
```

**Step 4: Scoring**
Top result:
- Flour + Water
- Experience fit: 92/100 (highly romantic)
- Location: 18 min drive = 22/25 points
- Budget: $90 avg = perfect center of $75-150 = 20/20
- Popularity: 4.6 stars, 1200 reviews = 9.5/10
- TOTAL: 93% Match

**Step 5: Output**
Return top 10 cards, all:
- Italian, French, or other romantic cuisines
- Intimate settings
- Within 30 min drive
- Open Saturday 7 PM
- Sorted by match score (93% down to 82%)

**User sees:**
Ten exceptional romantic restaurants, all perfect for Valentine's dinner, all within budget and travel constraint.

---

### Scenario 2: Quick Coffee Meeting (Business)

**User Inputs:**
- Experience Type: Business
- Category: Sip & Chill
- Budget: $10-30 per person
- Date: Now (current time: Tuesday 10:30 AM)
- Travel Mode: Walking
- Travel Constraint: 15 minutes max
- Location: GPS (Ferry Building, SF: 37.7956, -122.3933)

**System Processing:**

**Step 1: Google Places Query**
```
Nearby Search:
- Location: 37.7956, -122.3933
- Radius: 1,250 meters (15 min walk at 5 km/h)
- Type: cafe, coffee_shop
- Keyword: "wifi work professional quiet business"
- MinPrice: 1
- MaxPrice: 2
- OpenNow: true (CRITICAL - must be open RIGHT NOW)
```

**Step 2: Filter Results**
- Receive ~25 cafes
- All are open now (OpenNow filter worked)
- Check each: Has wifi? (from Google amenities)
- Check each: Distance via Distance Matrix walking mode
- Remaining: 18 cafes within 15 min walk

**Step 3: OpenAI Enhancement**
Prompt emphasizes:
```
This is for a business meeting at 10:30 AM on a Tuesday.

Key requirements:
- Quiet enough for conversation
- Reliable wifi
- Professional atmosphere
- Table availability (not too crowded mid-morning)
- Quality coffee (this is SF, expectations are high)

Score particularly on:
- Quietness (critical)
- Wifi quality
- Outlet availability
- Table space (laptop-friendly)
```

**Step 4: Scoring**
Top result:
- Sightglass Coffee
- Experience fit: 88/100 (excellent for business)
- Location: 5 min walk = 25/25 points
- Budget: $15 avg = perfect center = 20/20
- Popularity: 4.5 stars, 2000 reviews = 9/10
- Time bonus: Open now + optimal morning time = +5
- TOTAL: 91% Match

**Step 5: Output**
Return top 10 cafes, all:
- Within 15 min walk
- Currently open
- Have wifi and outlets
- Quiet enough for meetings
- Professional atmosphere
- Sorted by match (91% down to 79%)

**User sees:**
Ten nearby cafes perfect for a quick business meeting, all walkable, all open right now.

---

### Scenario 3: Weekend Group Activity

**User Inputs:**
- Experience Type: Group Fun
- Category: Play & Move
- Budget: $20-50 per person
- Date: This Weekend (next Saturday)
- Time: 2:00 PM (afternoon)
- Travel Mode: Public Transit
- Travel Constraint: 45 minutes max
- Location: Search address (Mission Dolores Park, SF)
- Group Size: 6 people (if captured)

**System Processing:**

**Step 1: Google Places Query**
```
Nearby Search:
- Location: 37.7596, -122.4269 (Mission Dolores Park)
- Radius: 15,000 meters (45 min transit = wider radius)
- Type: bowling_alley, amusement_park, sports_club, gym
- Keyword: "groups activities fun social games parties six people"
- MinPrice: 1
- MaxPrice: 2
```

**Step 2: Filter Results**
- Receive ~40 activity venues
- Check: Open Saturday at 2 PM?
- Check: Can accommodate 6 people? (from Google or OpenAI inference)
- Check: Transit time via Distance Matrix transit mode
- Remaining: 22 venues

**Step 3: OpenAI Enhancement**
Prompt emphasizes:
```
This is for a group of 6 friends on a Saturday afternoon.

Key requirements:
- Group-friendly (6 people can participate together)
- Fun, social atmosphere
- Not too competitive (mixed skill levels)
- Moderate physical activity (no extreme sports)
- 2 PM is peak time - check if reservations needed

Score on:
- Group capacity (critical for 6 people)
- Fun factor
- Social interaction level
- Beginner-friendliness
```

**Step 4: Scoring**
Top result:
- Mission Bowling Club
- Experience fit: 95/100 (perfect for groups)
- Location: 8 min bus = 23/25 points
- Budget: $35 avg per person = 18/20
- Popularity: 4.4 stars, 800 reviews = 8.5/10
- Group bonus: Explicitly group-friendly = +3
- TOTAL: 92% Match

**Step 5: Output**
Return top 10 activities, all:
- Group-friendly (6+ capacity)
- Open Saturday 2 PM
- Within 45 min transit
- Fun, social atmosphere
- Mix of active/casual options
- Sorted by match (92% down to 78%)

**User sees:**
Ten fun group activities from bowling to mini golf to escape rooms, all accessible by transit, all perfect for 6 friends.

---

## Error Handling & Fallbacks

### Error Categories

**Category 1: API Failures**

**Google Places API Down/Error:**
- Fallback 1: Use cached results if <24 hours old
- Fallback 2: Use local database of popular venues
- Fallback 3: Show error message: "Unable to search venues. Please try again."
- Never: Show nothing or crash

**OpenAI API Down/Error:**
- Fallback 1: Use basic template descriptions based on Google data
- Fallback 2: Use cached OpenAI responses for same venues
- Fallback 3: Show cards without rich descriptions (just Google data)
- Never: Skip showing the card entirely (Google data alone is acceptable)

**Google Distance Matrix API Down:**
- Fallback 1: Calculate using Haversine distance + mode speed estimates
- Fallback 2: Show estimated travel time with disclaimer
- Fallback 3: Sort by straight-line distance
- Never: Exclude all cards (some distance info better than none)

**Category 2: No Results**

**Zero venues after filtering:**

Step 1: Diagnose which filter eliminated everything
- Log how many results after each filter step
- Identify the bottleneck (usually budget or location)

Step 2: Progressive relaxation
1. If travel constraint is bottleneck: Expand by 25%
2. If budget is bottleneck: Expand range by one price level
3. If category is bottleneck: Add related categories
4. If time is bottleneck: Show "Nothing open now, but here's what's nearby"

Step 3: Show helpful message
```
"No results found matching all preferences.

What's limiting your results:
- Budget $25-75: Found 3 venues, but all were outside travel range
- 15 minute walk: Your location has limited options within this distance

Suggestions:
- Increase travel time to 25 minutes
- Expand budget to $20-80
- Try "Casual Eats" category (8 nearby options)"
```

**Category 3: Poor Quality Results**

**Only low-rated venues (<3.5 stars):**
- Show them anyway BUT add disclaimer
- Sort by rating first (not match score)
- Display message: "Limited options in this area. Consider expanding search."

**Only missing key data (no hours, no photos):**
- Show anyway
- Flag with "Limited information available"
- Rank lower than complete cards

**Category 4: Data Inconsistencies**

**OpenAI contradicts Google:**
Example: Google says Price Level $, OpenAI says "upscale fine dining"

Action:
- Trust Google for factual data (price, rating, hours)
- Use OpenAI only for subjective descriptions
- If contradiction is severe, regenerate OpenAI response with stricter prompt
- If still contradictory, use fallback template description

**Travel time impossible:**
Example: Venue 2 km away but Google says 45 min walking

Action:
- Log anomaly
- Check if route is walkable (might be water/highway barrier)
- If legitimate, include with warning: "Complex route - check directions"
- If error, recalculate with different API call

---

## Performance Considerations

### API Call Optimization

**Batch Operations:**

Instead of:
- 50 individual Google Distance Matrix calls (slow, expensive)

Do:
- 2 batch calls with 25 destinations each (fast, cheaper)

**Caching Strategy:**

Cache these for 5 minutes:
- Google Places search results (venues don't change fast)
- Google Distance Matrix results (traffic changes, but 5 min ok)
- Geocoded addresses (addresses don't change)

Cache these for 24 hours:
- Venue details (name, address, types - rarely change)
- Historical ratings (updates are gradual)

Cache these for 7 days:
- OpenAI enhancements (descriptions don't need real-time updates)

Never cache:
- Opening hours verification (might be special hours/holidays)
- "Open now" status (changes throughout day)
- Actual current travel time with traffic (if using real-time traffic)

### Response Time Targets

**User Experience Goals:**

From "Apply Preferences" click to cards displayed:
- Ideal: <2 seconds
- Acceptable: <5 seconds
- Maximum: <10 seconds

**If can't meet 10 seconds:**
- Show loading states with progress
- "Searching for venues..." (0-3s)
- "Calculating travel times..." (3-6s)
- "Personalizing recommendations..." (6-8s)
- Load first 3 cards immediately, lazy-load rest

### Optimization Techniques

**Parallel Processing:**

Run simultaneously:
1. Google Places search
2. User location services (if GPS)
3. Cache lookup for similar previous queries

Then run in parallel:
1. Google Distance Matrix (batched)
2. OpenAI enhancements (batched up to 5 at a time)

**Progressive Enhancement:**

Load in stages:
1. Show basic cards with Google data only (instant)
2. Add travel times when Distance Matrix returns (2s)
3. Add rich descriptions when OpenAI returns (4s)
4. Add photos progressively (background)

**Smart Batching:**

For OpenAI:
- Send 5 prompts in parallel (OpenAI handles concurrency well)
- Don't wait for all responses; show cards as enhanced data arrives
- Maximum 3 retry attempts per venue

For Google Distance Matrix:
- Batch up to 25 destinations per call (API limit)
- Use same origin for all (user's location)
- Request all modes if user might change (cache all modes)

---

## Testing & Validation

### Test Scenarios Matrix

**Test each combination:**

Experience Types (6) × Categories (10) × Budget Ranges (4) × Times (4) = 960 test cases

**Priority test cases (must test):**

1. **Romantic Dinner, High Budget, Evening**
   - Should return upscale restaurants
   - High intimacy scores
   - Sophisticated atmosphere

2. **Business Coffee, Low Budget, Morning**
   - Should return cafes with wifi
   - High quietness scores
   - Professional vibe

3. **Group Activity, Mid Budget, Weekend Afternoon**
   - Should return group-friendly venues
   - High fun factor scores
   - Capacity for multiple people

4. **Solo Wellness, Mid Budget, Any Time**
   - Should return spa/yoga/fitness
   - High relaxation scores
   - Solo-friendly options

**Edge cases (must handle gracefully):**

1. **No results available**
   - Remote location, tight constraints
   - Should show helpful message, suggest relaxing filters

2. **Contradictory preferences**
   - Business meeting at loud sports bar
   - Should work but rank poorly or warn user

3. **Extreme budgets**
   - $0-5 range: Very limited options
   - $500+ range: Ultra-luxury, very few venues

4. **Unusual times**
   - 3:00 AM: Most places closed
   - Show "Limited options at this hour"

5. **API failures**
   - Google down: Use fallbacks
   - OpenAI down: Basic descriptions
   - Both down: Cache or error state

### Validation Checklist

**Before going live, verify:**

✅ **Data Accuracy:**
- Prices match actual venue prices (spot-check 10 random venues)
- Hours are accurate (call 5 venues to verify)
- Addresses are correct (test navigation to 5 venues)
- Ratings match Google Maps (cross-reference)

✅ **Filter Accuracy:**
- Budget filter: Cards outside range are NEVER shown
- Category filter: Cards from wrong category NEVER shown
- Distance filter: Cards beyond limit NEVER shown
- Time filter: Closed venues NEVER shown

✅ **Score Validity:**
- Match scores make sense (romantic venue for romantic preference = high)
- Ambience scores are reasonable (dive bar ≠ 90 sophistication)
- Travel times match Google Maps manually checked routes
- Budget fit scores correlate with price point position in range

✅ **Description Quality:**
- No factual errors (claims not in Google data)
- No clichés or generic fluff
- Appropriate tone for experience type
- Sensible highlights (relevant to category)

✅ **User Experience:**
- Response time <5 seconds for typical query
- No crashes or errors in normal usage
- Error messages are helpful, not technical
- Loading states show progress

✅ **Edge Cases:**
- Works in low-density areas (suburbs, rural)
- Works with extreme preferences (very cheap/expensive)
- Works at unusual times (early morning, late night)
- Handles API failures gracefully

---

## Summary: The Golden Rules

### For Developers Implementing This System

**Rule 1: Preferences Are Sacred**
Every user preference is a HARD requirement. Never violate budget, category, or time constraints hoping to "show them something better." Users chose those preferences for a reason.

**Rule 2: Google for Facts, OpenAI for Feeling**
Use Google Places for all factual data: location, hours, price, rating. Use OpenAI for contextual descriptions, ambience, and personalization. Never let OpenAI invent facts.

**Rule 3: Validate Everything**
Don't trust API responses blindly. Check that Google data makes sense, OpenAI scores are logical, and results actually match preferences. Log anomalies.

**Rule 4: Quality Over Quantity**
Show 10 perfect cards, not 50 mediocre ones. If you can't find 10 quality matches, help the user adjust preferences rather than showing poor matches.

**Rule 5: Be Transparent**
Show users WHY each card was recommended. The match explanation should reference their actual preferences. If something doesn't match, explain why it's still shown.

**Rule 6: Fail Gracefully**
APIs will fail. Internet will drop. Location services will timeout. Always have a fallback. Never show a blank screen or crash.

**Rule 7: Optimize Ruthlessly**
Every API call costs money and time. Cache aggressively. Batch operations. Load progressively. Target <5 second total response time.

**Rule 8: Test Extensively**
Test all category combinations, all budget ranges, all times of day. Test edge cases. Test API failures. Test with real users in real locations.

**Rule 9: Learn Continuously**
Log which cards users save, skip, or engage with. Use this data to improve match scoring, query construction, and OpenAI prompts over time.

**Rule 10: Respect User Privacy**
Never share user preferences with third parties. Don't log personal location data unnecessarily. Be transparent about data usage.

---

**This is your blueprint. Follow it strictly, and the card generation system will produce highly relevant, engaging recommendations that users love.** 🎯
