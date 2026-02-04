# Mingla Curator Complete Documentation

## Table of Contents

1. [Overview](#overview)
2. [Dashboard Navigation](#dashboard-navigation)
3. [Experience Card Management](#experience-card-management)
4. [Business Partnership System](#business-partnership-system)
5. [Commission System](#commission-system)
6. [Analytics & Performance](#analytics--performance)
7. [Earnings & Payouts](#earnings--payouts)
8. [Settings & Configuration](#settings--configuration)
9. [Support System](#support-system)
10. [Experience Types & Categories](#experience-types--categories)
11. [Availability & Package System](#availability--package-system)
12. [QR Code Validation](#qr-code-validation)
13. [Best Practices](#best-practices)
14. [Technical Integration](#technical-integration)

---

## Overview

The **Curator** is a key user role in the Mingla platform. Curators are content creators who:

- Create and manage experience cards for the platform
- Partner with businesses to create experiences on their behalf
- Earn commission from experience sales
- Validate purchased experiences via QR codes
- Build and maintain a portfolio of curated experiences

### Key Capabilities

✅ **Content Creation**: Create rich, detailed experience cards across 10+ categories  
✅ **Business Partnerships**: Onboard and manage business relationships  
✅ **Commission Earnings**: Set commission rates and track earnings  
✅ **Analytics Dashboard**: Monitor card performance and user engagement  
✅ **QR Validation**: Validate customer purchases in real-time  
✅ **Payout Management**: Track earnings and manage payment methods  
✅ **Support Access**: 24/7 support tickets and live chat  

---

## Dashboard Navigation

### Main Component
**File**: `/components/CuratorDashboard.tsx`

### Navigation Structure

#### 1. Main Section
- **My Cards**: Manage all experience cards
- **My Businesses**: View and manage business partnerships

#### 2. Performance Section
- **Analytics**: View performance metrics and insights
- **Earnings**: Track revenue and payouts

#### 3. Account Section
- **Settings**: Configure profile and preferences
- **Help & Support**: Access documentation and support

### Dashboard Tabs

```typescript
type DashboardTab = 
  | 'cards'        // Card management
  | 'businesses'   // Business partnerships
  | 'analytics'    // Performance metrics
  | 'earnings'     // Revenue tracking
  | 'settings'     // User settings
  | 'help'         // Support resources
```

### Visual Features

- **Gradient Navigation**: Active tabs use brand gradient (`#eb7825` to `#d6691f`)
- **Status Badges**: Real-time counts for drafts, pending items
- **Mobile Responsive**: Collapsible sidebar for mobile devices
- **Stat Cards**: Quick overview of key metrics at the top

---

## Experience Card Management

### Card Lifecycle

```
Draft → In Review → Live → [Active/Archived]
                  ↓
              Returned (with feedback)
```

### Card Statuses

| Status | Icon | Description | Curator Action |
|--------|------|-------------|----------------|
| **Draft** | Edit | Card saved but not submitted | Complete and submit |
| **In Review** | Clock | Submitted to content managers | Wait for approval |
| **Live** | CheckCircle | Approved and visible to users | Monitor performance |
| **Returned** | XCircle | Needs revisions | Address feedback and resubmit |

### Card Creation Flow

#### 1. Create New Card
**Component**: `CardCreatorModal.tsx`

**Required Fields**:
- **Title**: Experience name (e.g., "Sunset Rooftop Wine Tasting")
- **Category**: From 10 predefined categories
- **Description**: Detailed experience overview
- **Image**: Visual representation
- **Location**: Venue address with Google Places integration
- **Duration**: Time required for experience

**Optional Fields**:
- **Price Range**: Min-max pricing
- **Tags**: Searchable keywords
- **Special Requirements**: Age restrictions, prerequisites
- **Cancellation Policy**: Refund terms

#### 2. Availability System
**Component**: `AvailabilityBuilder.tsx`

**Features**:
- **Recurring Schedules**: Weekly patterns with time slots
- **Date-Specific Rules**: Special dates, blackout dates
- **Capacity Management**: Max participants per slot
- **Package Options**: Different tier offerings

**Availability Types**:
```typescript
{
  type: 'specific-dates' | 'recurring' | 'flexible' | 'appointment-only',
  dateRanges?: DateRange[],
  weeklySchedule?: WeeklySchedule,
  timeSlots?: TimeSlot[],
  capacity?: number
}
```

#### 3. Package System
**File**: `/components/PACKAGE_SYSTEM_GUIDE.md`

**Package Structure**:
```typescript
{
  name: string,              // "Basic", "Premium", "VIP"
  price: number,             // Base price
  duration: number,          // Minutes
  capacity: number,          // Max people
  inclusions: string[],      // What's included
  restrictions?: string[],   // Requirements
  available: boolean         // Active status
}
```

**Package Types**:
- **Basic**: Entry-level offering
- **Standard**: Most popular option
- **Premium**: Enhanced experience
- **VIP/Luxury**: Top-tier offering
- **Group**: Special group rates
- **Custom**: Personalized packages

### Card Editor
**Component**: `CardEditorModal.tsx`

**Edit Capabilities**:
- ✏️ Update all card details
- 🖼️ Change images
- 📍 Modify location
- 💰 Adjust pricing
- 📅 Update availability
- 📦 Manage packages

**Version Control**:
- Auto-save drafts every 30 seconds
- "Last edited" timestamp tracking
- Revert to previous version option

### Card Preview
**Component**: `CardPreviewModal.tsx`

**Preview Features**:
- **User View**: See exactly what users will see
- **Mobile Preview**: Responsive design preview
- **Swipeable**: Test card in swipe interface
- **Share Link**: Generate preview link

### Filtering & Search

**Filter Options**:
```typescript
filterStatus: 'all' | 'draft' | 'in-review' | 'live' | 'returned'
```

**Search Fields**:
- Title
- Category
- Location
- Tags
- Description

### Bulk Actions

- **Select Multiple**: Checkbox selection
- **Bulk Status Change**: Submit all drafts at once
- **Bulk Delete**: Remove multiple drafts
- **Bulk Export**: Download card data

---

## Business Partnership System

### Overview
Curators can onboard businesses and create experiences on their behalf, earning commission from sales.

### Components

#### 1. My Businesses Section
**Component**: `MyBusinessesSection.tsx`

**Features**:
- List of all partnered businesses
- Quick stats per business
- Business performance metrics
- Collaboration status

#### 2. Create Business Modal
**Component**: `CreateBusinessModal.tsx`

**Business Onboarding Fields**:
```typescript
{
  businessName: string,
  category: BusinessCategory,
  contactPerson: string,
  email: string,
  phone: string,
  address: string,
  website?: string,
  description: string,
  logo?: string,
  photos?: string[],
  hours: BusinessHours,
  amenities?: string[],
  acceptedPayments?: string[]
}
```

**Business Categories**:
- Restaurants & Cafes
- Bars & Lounges
- Entertainment Venues
- Wellness & Spa
- Adventure & Sports
- Arts & Culture
- Education & Workshops
- Events & Celebrations

#### 3. Business Management Modal
**Component**: `BusinessManagementModal.tsx`

**Management Tabs**:
- **Overview**: Business details and stats
- **Experiences**: Cards created for this business
- **Performance**: Analytics specific to this business
- **Commission**: Commission rates and earnings
- **Settings**: Business profile settings

### Business Invitation System
**Component**: `BusinessInviteModal.tsx`

**Invitation Flow**:
1. Curator creates business profile
2. System generates unique invitation link
3. Business receives email invitation
4. Business signs up and links to curator
5. Curator-business relationship established

**Invitation Data**:
```typescript
{
  inviteId: string,
  curatorId: string,
  businessEmail: string,
  businessName: string,
  status: 'pending' | 'accepted' | 'expired',
  sentAt: Date,
  expiresAt: Date,
  commissionRate: number  // Proposed rate
}
```

### Business Dashboard Access

Once invited, businesses can:
- View their experiences created by curator
- Track sales and performance
- Approve/reject commission rates
- Manage their business profile
- Request experience modifications

---

## Commission System

### Architecture
**Files**: 
- `/components/CommissionApprovalModal.tsx`
- `/components/CommissionNegotiationModal.tsx`
- `/COMMISSION_MANAGEMENT_COMPLETE.md`

### Commission Structure

```
Sale Price: $100
    ↓
Platform Fee (15%): $15
    ↓
Remaining: $85
    ↓
Curator Commission (20%): $17
Business Receives: $68
```

### Commission Types

#### 1. Platform Commission
- **Fixed by Mingla**: Configurable (default 15%)
- **Applied to**: All transactions
- **Purpose**: Platform operations and maintenance

#### 2. Curator Commission
- **Set by Curator**: Typically 10-30%
- **Requires**: Business approval
- **Negotiable**: Yes, through negotiation modal
- **Calculated on**: Remaining after platform fee

### Commission Approval Flow

```
1. Curator creates business profile
2. Curator proposes commission rate
3. Business receives approval request
4. Business can:
   - Accept proposed rate
   - Counter with different rate
   - Reject and end partnership
5. If counter-offered:
   - Curator can accept or counter again
   - Up to 3 negotiation rounds
6. Once agreed:
   - Rate locked for partnership
   - Can be renegotiated quarterly
```

### Commission Negotiation Modal

**Features**:
- **Current Rate Display**: Show existing rate
- **Rate Slider**: Visual rate adjustment
- **Earnings Calculator**: Real-time commission preview
- **Message Field**: Add negotiation context
- **History**: View negotiation history

**Example Calculation**:
```typescript
const calculateEarnings = (
  salePrice: number,
  platformFee: number,
  curatorRate: number
) => {
  const afterPlatform = salePrice * (1 - platformFee / 100);
  const curatorEarning = afterPlatform * (curatorRate / 100);
  const businessEarning = afterPlatform - curatorEarning;
  
  return { curatorEarning, businessEarning };
};
```

### Commission Settings

**Configuration Options**:
- **Default Rate**: Curator's standard rate
- **Minimum Acceptable**: Won't go below this
- **Preferred Rate**: Target rate for negotiations
- **Category-Specific**: Different rates per category

---

## Analytics & Performance

### Dashboard Overview
**Component**: `CuratorDashboard.tsx` (Analytics Tab)

### Key Metrics

#### 1. Card Performance
```typescript
{
  totalViews: number,        // All-time card views
  totalLikes: number,        // Heart reactions
  totalSaves: number,        // Bookmark saves
  totalShares: number,       // Share actions
  conversionRate: number,    // Views to purchases %
  averageRating: number,     // User ratings
  reviewCount: number        // Total reviews
}
```

#### 2. Engagement Metrics
- **View Growth**: Week-over-week percentage
- **Engagement Rate**: (Likes + Saves + Shares) / Views
- **Time on Card**: Average viewing duration
- **Bounce Rate**: Immediate swipes vs engagement

#### 3. Sales Performance
- **Total Sales**: Lifetime revenue
- **Sales This Month**: Current month
- **Sales Last Month**: Previous month comparison
- **Top Selling Cards**: Best performers
- **Package Breakdown**: Sales by package type

### Analytics Charts

**Available Visualizations**:
1. **Views Over Time**: Line chart (7d, 30d, 90d, all)
2. **Engagement Breakdown**: Pie chart (likes, saves, shares)
3. **Sales Funnel**: Conversion visualization
4. **Revenue Trend**: Bar chart by time period
5. **Category Performance**: Comparison across categories

### Timeframe Selection
```typescript
type Timeframe = '7d' | '30d' | '90d' | 'all';
```

### Export Options
- **CSV Export**: Raw data download
- **PDF Report**: Formatted analytics report
- **Scheduled Reports**: Weekly/monthly email reports

---

## Earnings & Payouts

### Earnings Dashboard
**Component**: `PayoutsSystem.tsx`

### Earnings Overview

**Summary Stats**:
```typescript
{
  totalEarned: number,       // Lifetime earnings
  pendingPayout: number,     // Ready for withdrawal
  thisMonth: number,         // Current month earnings
  lastPayout: number,        // Most recent payout amount
  lastPayoutDate: Date,      // When last paid
  commissionRate: number,    // Average commission %
  activeBusinesses: number,  // Business partners
  totalSales: number         // Total transactions
}
```

### Payout Methods

**Supported Methods**:
1. **Bank Transfer (ACH)**
   - Default method
   - 3-5 business days
   - No fees
   
2. **PayPal**
   - Instant transfer
   - 2.9% + $0.30 fee
   
3. **Stripe**
   - Direct deposit
   - 2.9% fee
   
4. **Check**
   - Mailed check
   - 7-10 business days
   - $5 processing fee

### Payout Schedule

**Automatic Payouts**:
- **Frequency**: Monthly on the 1st
- **Minimum**: $50 threshold
- **Processing**: 3-5 business days
- **Currency**: USD

**Manual Payouts**:
- **On-Demand**: Request anytime
- **Minimum**: $100 threshold
- **Fee**: $2.50 processing fee
- **Limit**: Once per week

### Transaction History

**Transaction Details**:
```typescript
{
  transactionId: string,
  date: Date,
  experienceName: string,
  businessName: string,
  saleAmount: number,
  platformFee: number,
  commissionRate: number,
  earnings: number,
  status: 'pending' | 'paid' | 'processing',
  payoutDate?: Date
}
```

**Filters**:
- Date range
- Business
- Experience
- Status
- Amount range

### Payout History

**Payout Record**:
```typescript
{
  payoutId: string,
  amount: number,
  method: PayoutMethod,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  requestedDate: Date,
  completedDate?: Date,
  transactions: Transaction[],  // Included transactions
  fees: number,
  netAmount: number
}
```

### Tax Information

**W9/Tax Forms**:
- Required for earnings > $600/year
- Submittable through dashboard
- Auto-generated 1099 forms
- Download tax summaries

---

## Settings & Configuration

### Settings Sections
**Component**: `CuratorDashboard.tsx` (Settings Tab)

### 1. Profile Settings

**Editable Fields**:
```typescript
{
  displayName: string,
  bio: string,
  profilePhoto: string,
  coverPhoto?: string,
  location: string,
  website?: string,
  socialLinks?: {
    instagram?: string,
    twitter?: string,
    facebook?: string
  },
  specialties: string[],    // Cuisine types, experience types
  certifications?: string[]  // Professional credentials
}
```

**Public Profile**:
- Visible to users who purchase experiences
- Shows curator rating and review count
- Displays portfolio of live experiences

### 2. Account Settings

**Security**:
- Change password
- Two-factor authentication
- Login history
- Connected devices
- Session management

**Email Preferences**:
- Verified email addresses
- Email notifications
- Newsletter subscription

### 3. Notification Settings

**Notification Types**:
```typescript
{
  newPurchase: boolean,        // Customer buys experience
  cardApproved: boolean,       // Card goes live
  cardReturned: boolean,       // Card needs revision
  businessInviteResponse: boolean,
  commissionNegotiation: boolean,
  weeklyReport: boolean,       // Analytics summary
  monthlyPayout: boolean,      // Payment processed
  newReview: boolean,          // Customer review
  supportResponse: boolean     // Support ticket update
}
```

**Channels**:
- Email
- In-app notifications
- Push notifications (if mobile)
- SMS (optional, for urgent items)

### 4. Payout Settings

**Configuration**:
- Default payout method
- Payout schedule preference
- Minimum payout threshold
- Tax withholding preferences
- Backup payout method

**Bank Account Info**:
```typescript
{
  accountHolderName: string,
  accountType: 'checking' | 'savings',
  routingNumber: string,
  accountNumber: string,
  bankName: string,
  verified: boolean
}
```

### 5. Privacy Settings

**Privacy Controls**:
- Profile visibility
- Show/hide earnings stats
- Show/hide business partnerships
- Public portfolio toggle
- Search engine indexing

**Data Management**:
- Download all data
- Delete account request
- Data retention preferences

---

## Support System

### Support Channels

#### 1. Support Tickets
**Component**: `SupportTicketModal.tsx`

**Ticket Types**:
- **Bug Report**: Technical issues
- **Feature Request**: Suggest improvements
- **Account Issue**: Login, payment problems
- **Content Question**: Card creation help
- **Business Partnership**: Partnership issues
- **General Inquiry**: Other questions

**Ticket Lifecycle**:
```
New → Assigned → In Progress → Resolved → Closed
```

**Ticket Details**:
```typescript
{
  ticketId: string,
  subject: string,
  description: string,
  type: TicketType,
  priority: 'low' | 'medium' | 'high' | 'urgent',
  status: TicketStatus,
  attachments?: File[],
  createdAt: Date,
  updatedAt: Date,
  assignedTo?: string,      // Support agent
  responses: Response[]
}
```

#### 2. Live Chat Support
**Component**: `LiveChatSupport.tsx`

**Features**:
- **Real-Time**: Instant messaging with support
- **Business Hours**: Mon-Fri 9am-6pm PST
- **Average Response**: Under 2 minutes
- **File Sharing**: Send screenshots, documents
- **Chat History**: Access previous conversations

**Chat Interface**:
- Typing indicators
- Read receipts
- Emoji support
- Quick replies
- Satisfaction rating

#### 3. Help Center

**Resources**:
- **Best Practices Guide**: Curator success tips
- **Video Tutorials**: Step-by-step guides
- **FAQ**: Common questions
- **Category Guidelines**: Specific category rules
- **API Documentation**: For advanced users

### Best Practices Section

**Topics Covered**:
1. **Creating Compelling Cards**
   - Title optimization
   - Description writing
   - Image selection
   - Pricing strategies

2. **Mastering Availability**
   - Schedule optimization
   - Capacity planning
   - Peak time pricing
   - Seasonal adjustments

3. **Understanding Match Scores**
   - How algorithm works
   - Improving card visibility
   - User preference alignment

4. **Card Performance Optimization**
   - A/B testing approaches
   - Engagement tactics
   - Conversion strategies

5. **Business Partnerships**
   - Finding partners
   - Negotiation tips
   - Maintaining relationships
   - Scaling partnerships

6. **Category-Specific Guidelines**
   - Food & Drink standards
   - Wellness requirements
   - Adventure safety
   - Creative workshops
   - Entertainment venues

7. **Reviews & Validation**
   - QR code best practices
   - Handling customer issues
   - Review response templates
   - Building reputation

8. **Payout Management**
   - Tax optimization
   - Payment method selection
   - Tracking earnings
   - Financial planning

---

## Experience Types & Categories

### Available Categories

#### 1. Food & Drink 🍷
**Subcategories**:
- **Dining Experiences**: Fine dining, tasting menus
- **Casual Eats**: Restaurants, cafes, food trucks
- **Sip & Chill**: Wine bars, cocktail lounges
- **Cooking Classes**: Chef-led workshops

**Guidelines File**: `/components/DINING_EXPERIENCES_READY.md`

**Example Experiences**:
- Wine tasting tours
- Chef's table dinners
- Cocktail making classes
- Food market tours

#### 2. Creative & Hands-On 🎨
**Subcategories**:
- **Art Workshops**: Painting, pottery, sculpture
- **Craft Classes**: DIY, woodworking, jewelry
- **Picnics**: Curated outdoor dining
- **Photography**: Photo walks, sessions

**Guidelines File**: `/components/CREATIVE_HANDS_ON_PRODUCTION_GUIDE.md`

**Example Experiences**:
- Pottery wheel classes
- Watercolor workshops
- Leather crafting
- Botanical picnics

#### 3. Wellness & Fitness 🧘
**Subcategories**:
- **Wellness Dates**: Spa, meditation, yoga
- **Fitness Activities**: Classes, training
- **Outdoor Wellness**: Hiking, nature therapy

**Guidelines File**: `/components/WELLNESS_DATES_READY.md`

**Example Experiences**:
- Couples massage
- Yoga in the park
- Sound healing sessions
- Aerial fitness classes

#### 4. Adventure & Sports ⚽
**Subcategories**:
- **Play & Move**: Sports, activities
- **Outdoor Adventures**: Hiking, climbing
- **Water Sports**: Kayaking, surfing

**Guidelines File**: `/components/PLAY_MOVE_READY.md`

**Example Experiences**:
- Rock climbing sessions
- Surfing lessons
- Bike tours
- Archery classes

#### 5. Entertainment 🎭
**Subcategories**:
- **Screen & Relax**: Movies, shows
- **Live Performances**: Theater, concerts
- **Comedy**: Stand-up, improv

**Guidelines File**: `/components/SCREEN_RELAX_READY.md`

**Example Experiences**:
- Private movie screenings
- Comedy club nights
- Theater performances
- Live music venues

#### 6. Freestyle (Unique Experiences) ✨
**Subcategories**:
- **Unique Experiences**: One-of-a-kind activities
- **Pop-up Events**: Limited-time experiences
- **Seasonal Specials**: Holiday events

**Guidelines File**: `/components/FREESTYLE_READY.md`

**Example Experiences**:
- Escape rooms
- Mystery dinners
- Stargazing events
- Themed parties

#### 7. Take a Stroll 🚶
**Subcategories**:
- **Walking Tours**: Guided walks
- **Nature Walks**: Parks, trails
- **Urban Exploration**: City tours

**Guidelines File**: `/components/TAKE_A_STROLL_READY.md`

**Example Experiences**:
- Historical walking tours
- Street art tours
- Botanical garden walks
- Food neighborhood tours

### Category Requirements

Each category has specific requirements:

**Minimum Requirements**:
- High-quality images (1200x800px minimum)
- Detailed description (100+ words)
- Clear pricing structure
- Accurate location
- Available time slots
- Cancellation policy

**Category-Specific**:
- **Food & Drink**: Menu samples, dietary options
- **Wellness**: Instructor certifications
- **Adventure**: Safety equipment info, skill level
- **Creative**: Materials list, skill requirements
- **Entertainment**: Seating info, age restrictions

---

## Availability & Package System

### Availability Types

#### 1. Specific Dates
**Use Case**: One-time events, seasonal experiences

```typescript
{
  type: 'specific-dates',
  dates: [
    {
      date: '2025-10-25',
      timeSlots: [
        { startTime: '18:00', endTime: '21:00', capacity: 12 },
        { startTime: '21:30', endTime: '00:30', capacity: 12 }
      ]
    }
  ]
}
```

#### 2. Recurring Schedule
**Use Case**: Regular weekly experiences

```typescript
{
  type: 'recurring',
  weeklySchedule: {
    monday: { enabled: false },
    tuesday: { enabled: true, slots: ['18:00-20:00'] },
    wednesday: { enabled: true, slots: ['18:00-20:00'] },
    thursday: { enabled: true, slots: ['18:00-20:00', '20:30-22:30'] },
    friday: { enabled: true, slots: ['19:00-22:00'] },
    saturday: { enabled: true, slots: ['14:00-17:00', '19:00-22:00'] },
    sunday: { enabled: false }
  },
  validFrom: '2025-10-20',
  validUntil: '2026-10-20'
}
```

#### 3. Flexible
**Use Case**: Experiences available anytime

```typescript
{
  type: 'flexible',
  leadTime: 24,  // Hours notice required
  maxAdvanceBooking: 90,  // Days in advance
  blackoutDates: ['2025-12-25', '2025-01-01']
}
```

#### 4. Appointment Only
**Use Case**: Custom scheduled experiences

```typescript
{
  type: 'appointment-only',
  requestLeadTime: 48,  // Hours notice
  contactMethod: 'email' | 'phone' | 'in-app'
}
```

### Package Configuration

**Package Builder**:
```typescript
interface Package {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;  // minutes
  capacity: {
    min: number;
    max: number;
  };
  inclusions: string[];
  exclusions?: string[];
  addOns?: AddOn[];
  restrictions?: string[];
  cancellationPolicy: string;
  available: boolean;
}
```

**Example Packages**:

**Wine Tasting Experience**:
- **Basic** ($45): 4 wines, cheese board, 90 min
- **Premium** ($75): 6 wines, charcuterie board, sommelier guide, 120 min
- **VIP** ($120): 8 wines, 3-course pairing, private room, 150 min

### Capacity Management

**Settings**:
- **Minimum Capacity**: Experience minimum (e.g., 2 for couples)
- **Maximum Capacity**: Safety/comfort limit
- **Optimal Capacity**: Best group size
- **Overbooking**: Allow waiting list

**Automated Rules**:
- Auto-decline if under minimum
- Auto-waitlist if at capacity
- Auto-suggest alternative times
- Group booking incentives

---

## QR Code Validation

### Validation System
**Component**: `QRCodeValidationModal.tsx`

### How It Works

#### 1. Purchase Flow
```
Customer purchases → Receives QR code → Shows to curator → Curator scans & validates
```

#### 2. QR Code Structure
```typescript
{
  purchaseId: string,        // Unique purchase ID
  experienceId: string,      // Which experience
  customerId: string,        // Who purchased
  curatorId: string,         // Who validates
  purchaseDate: Date,        // When purchased
  validUntil: Date,          // Expiration
  packageType: string,       // Which package
  participants: number,      // Group size
  status: 'pending' | 'validated' | 'expired' | 'cancelled',
  oneTimeUse: boolean,       // Single use only
  validateCode: string       // 6-digit validation code
}
```

#### 3. Validation Process

**Steps**:
1. Customer shows QR code (digital or printed)
2. Curator opens validation modal
3. Scan QR code or enter 6-digit code
4. System checks:
   - ✅ Valid purchase
   - ✅ Not already used
   - ✅ Not expired
   - ✅ Matches curator
   - ✅ Correct date/time
5. Mark as validated
6. Customer receives confirmation

**Security Features**:
- **One-Time Use**: Can't be reused
- **Time-Based**: Valid only on booked date
- **Curator-Specific**: Only designated curator can validate
- **Offline Validation**: Works without internet (syncs later)
- **Fraud Detection**: Flags suspicious patterns

### Validation Modal Features

**UI Elements**:
- QR scanner (camera access)
- Manual code entry field
- Purchase details display
- Customer information
- Package inclusions checklist
- Notes field (for special requests)
- Photo capture (optional proof)

**Post-Validation**:
- Auto-update earnings
- Send customer receipt
- Log validation time
- Enable review request (after experience)

### Bulk Validation

**For Group Events**:
- Scan multiple QR codes
- Batch validation
- Group check-in list
- Capacity tracking

---

## Best Practices

### Creating High-Converting Cards

#### 1. Title Optimization
**Best Practices**:
- Use action words: "Discover", "Experience", "Explore"
- Include location for local appeal
- Mention key feature: "Wine Tasting with Sunset Views"
- Keep under 60 characters
- Avoid generic titles

**Examples**:
- ❌ "Wine Tasting"
- ✅ "Sunset Rooftop Wine Tasting in Downtown SF"

#### 2. Description Writing

**Structure**:
1. **Hook** (1 sentence): Grab attention
2. **Experience** (2-3 sentences): What they'll do
3. **Details** (bullet points): Specifics
4. **Call-to-Action**: Encourage booking

**Example**:
```
Sip award-winning wines while watching the sun set over the San Francisco skyline from our exclusive rooftop terrace.

Join our expert sommelier for an intimate tasting of 6 California wines, each paired with artisan cheeses and house-made charcuterie. You'll learn about wine regions, tasting techniques, and food pairing fundamentals in a relaxed, social atmosphere.

What's Included:
• 6 wine tastings (3 whites, 3 reds)
• Artisan cheese & charcuterie board
• Expert sommelier guidance
• Rooftop terrace with panoramic views
• Small group setting (max 12 people)

Perfect for date nights, friend celebrations, or wine enthusiasts looking to expand their palate.
```

#### 3. Image Selection

**Requirements**:
- **Primary Image**: 1200x800px minimum
- **Gallery**: 4-8 additional images
- **Quality**: Professional or high-quality smartphone
- **Variety**: Show different aspects

**Image Types**:
1. **Hero Shot**: Main experience moment
2. **Venue**: Location atmosphere
3. **Details**: Food, equipment, materials
4. **People**: Previous participants (with consent)
5. **Results**: Finished product, certificates

**Pro Tips**:
- Use natural lighting
- Show diverse participants
- Include close-ups and wide shots
- Avoid stock photos
- Update seasonally

#### 4. Pricing Strategy

**Factors to Consider**:
- **Market Research**: Competitor pricing
- **Costs**: Materials, venue, time, expertise
- **Value Perception**: Premium vs. accessible
- **Commission**: Factor in platform + curator fees
- **Seasonality**: Peak vs. off-peak pricing

**Pricing Tiers**:
- **Budget**: Under $30 - High volume, simple experiences
- **Mid-Range**: $30-75 - Most popular sweet spot
- **Premium**: $75-150 - Enhanced experiences
- **Luxury**: $150+ - Exclusive, VIP offerings

**Dynamic Pricing**:
- **Early Bird**: 10-20% off advance bookings
- **Last Minute**: Discounts for filling slots
- **Group Rates**: Per-person discounts for larger groups
- **Seasonal**: Holiday premiums, summer specials

### Optimizing Availability

#### When to Offer Experiences

**High-Demand Times**:
- **Date Nights**: Thursday-Saturday evenings
- **Weekend Mornings**: Saturday-Sunday 10am-12pm
- **After Work**: Weekday 6pm-8pm
- **Brunch**: Saturday-Sunday 10am-2pm

**Avoid**:
- Very early mornings (before 8am)
- Very late nights (after 11pm)
- Major holidays (unless holiday-themed)
- Monday mornings

#### Maximizing Bookings

**Strategies**:
1. **Offer Multiple Time Slots**: 2-3 per day
2. **Create Urgency**: Limited availability labels
3. **Enable Waitlists**: Capture demand
4. **Flexible Cancellation**: Reduce booking friction
5. **Group Discounts**: Encourage larger bookings

### Building Business Partnerships

#### Finding Partners

**Where to Look**:
- Local business chambers
- Restaurant industry events
- Wellness expos
- Art gallery openings
- Sports facilities
- Existing network

**Ideal Partners**:
- Established reputation
- Quality focus
- Customer service oriented
- Growth minded
- Open to collaboration

#### Pitching to Businesses

**Email Template**:
```
Subject: Partnership Opportunity - Bring New Customers to [Business Name]

Hi [Contact Name],

I'm a curator on Mingla, a platform connecting locals with unique experiences. I specialize in [your specialty] and have successfully promoted [X] experiences with [Y] total participants.

I'd love to partner with [Business Name] to create curated experiences that showcase your [venue/offerings]. This would:
• Bring new customers to your business
• Increase visibility on our platform
• Provide additional revenue stream
• Require minimal effort on your part

I handle all marketing, booking, and customer service. You provide the venue and service. We split the revenue [X]% / [Y]%.

Can we schedule a 15-minute call to discuss?

Best,
[Your Name]
[Portfolio Link]
```

#### Setting Commission Rates

**Recommended Ranges**:
- **High-margin experiences**: 20-30% curator commission
- **Standard experiences**: 15-20% curator commission
- **Low-margin experiences**: 10-15% curator commission

**Negotiation Tips**:
- Start with 20% as baseline
- Emphasize value you bring
- Offer volume incentives
- Be flexible on trial period
- Consider performance bonuses

### Managing Reviews

#### Encouraging Reviews

**Best Practices**:
- Ask immediately after experience
- Make it easy (direct link)
- Incentivize (discount on next booking)
- Respond to all reviews
- Showcase positive reviews

#### Responding to Reviews

**Positive Reviews**:
```
Thank you so much for the kind words! We're thrilled you enjoyed [specific detail they mentioned]. Hope to see you again for [related experience]!
```

**Negative Reviews**:
```
We're sorry to hear about your experience. This isn't the standard we strive for. I'd love to discuss this further and make it right. Please contact me at [email/phone]. We appreciate the feedback and will use it to improve.
```

**Mixed Reviews**:
```
Thank you for the honest feedback! We're glad you enjoyed [positive aspects]. We hear you on [criticism] and are working on improving that. We'd love another chance to exceed your expectations.
```

---

## Technical Integration

### Components Used

**Core Components**:
- `CuratorDashboard.tsx` - Main dashboard
- `CardCreatorModal.tsx` - Card creation
- `CardEditorModal.tsx` - Card editing
- `AvailabilityBuilder.tsx` - Availability management
- `MyBusinessesSection.tsx` - Business management
- `PayoutsSystem.tsx` - Earnings tracking
- `QRCodeValidationModal.tsx` - Purchase validation

**Utility Components**:
- `GooglePlacesAutocomplete.tsx` - Location search
- `NotificationSystem.tsx` - In-app notifications
- `SupportTicketModal.tsx` - Support system
- `LiveChatSupport.tsx` - Live chat

### Data Utilities

**Card Generation**:
- `/components/utils/cardGenerator.ts` - Card creation logic
- `/components/utils/platformCards.ts` - Card data management

**Category Data**:
- `/components/utils/diningExperiencesData.ts`
- `/components/utils/casualEatsData.ts`
- `/components/utils/wellnessData.ts`
- `/components/utils/playMoveData.ts`
- `/components/utils/creativeHandsOnData.ts`
- `/components/utils/screenRelaxData.ts`
- `/components/utils/sipChillData.ts`
- `/components/utils/freestyleData.ts`
- `/components/utils/takeAStrollData.ts`
- `/components/utils/picnicsData.ts`

**Business Data**:
- `/components/utils/businessesSeed.ts` - Business seed data

**System Utilities**:
- `/components/utils/geolocation.ts` - Location services
- `/components/utils/travelTime.ts` - Travel calculations
- `/components/utils/dateUtils.ts` - Date formatting
- `/components/utils/formatters.ts` - Data formatting
- `/components/utils/purchaseHandler.ts` - Purchase processing
- `/components/utils/preferences.ts` - User preferences

### State Management

**Dashboard State**:
```typescript
{
  activeTab: DashboardTab,
  searchQuery: string,
  filterStatus: FilterStatus,
  showCreateModal: boolean,
  showEditModal: boolean,
  selectedCard: Card | null,
  mobileMenuOpen: boolean,
  settingsSection: SettingsSection,
  analyticsTimeframe: Timeframe
}
```

**Card State**:
```typescript
{
  curatorCards: Card[],
  filteredCards: Card[],
  stats: {
    totalCards: number,
    liveCards: number,
    inReview: number,
    drafts: number,
    totalViews: number,
    totalLikes: number
  }
}
```

### API Integration Points

**Required Endpoints**:

```typescript
// Card Management
POST   /api/curator/cards              // Create card
GET    /api/curator/cards              // List cards
GET    /api/curator/cards/:id          // Get card details
PUT    /api/curator/cards/:id          // Update card
DELETE /api/curator/cards/:id          // Delete card
POST   /api/curator/cards/:id/submit   // Submit for review

// Business Management
POST   /api/curator/businesses         // Create business
GET    /api/curator/businesses         // List businesses
PUT    /api/curator/businesses/:id     // Update business
POST   /api/curator/businesses/:id/invite  // Send invitation

// Commission
GET    /api/curator/commission/rates   // Get rates
PUT    /api/curator/commission/rates   // Update rates
POST   /api/curator/commission/negotiate  // Negotiate rate

// Analytics
GET    /api/curator/analytics          // Get analytics data
GET    /api/curator/analytics/cards/:id  // Card-specific analytics

// Earnings
GET    /api/curator/earnings           // Earnings summary
GET    /api/curator/earnings/transactions  // Transaction history
GET    /api/curator/earnings/payouts   // Payout history
POST   /api/curator/earnings/payout    // Request payout

// Validation
POST   /api/curator/validate           // Validate QR code
GET    /api/curator/validations        // Validation history

// Support
POST   /api/curator/support/tickets    // Create ticket
GET    /api/curator/support/tickets    // List tickets
POST   /api/curator/support/chat       // Send chat message
```

### Data Models

**Card Model**:
```typescript
interface ExperienceCard {
  id: string;
  curatorId: string;
  businessId?: string;
  title: string;
  category: Category;
  subcategory?: string;
  description: string;
  images: string[];
  location: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates: { lat: number; lng: number };
    placeName?: string;
  };
  pricing: {
    type: 'fixed' | 'range' | 'per-person' | 'per-group';
    min?: number;
    max?: number;
    fixed?: number;
    currency: string;
  };
  availability: Availability;
  packages: Package[];
  duration: number;
  capacity: { min: number; max: number };
  tags: string[];
  restrictions?: string[];
  cancellationPolicy: string;
  status: CardStatus;
  stats: {
    views: number;
    likes: number;
    saves: number;
    purchases: number;
    rating: number;
    reviews: number;
  };
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
  approvedAt?: Date;
  publishedAt?: Date;
}
```

**Business Model**:
```typescript
interface Business {
  id: string;
  name: string;
  category: BusinessCategory;
  owner: {
    name: string;
    email: string;
    phone: string;
  };
  location: Location;
  description: string;
  images: string[];
  hours: BusinessHours;
  amenities: string[];
  paymentMethods: string[];
  partnership: {
    curatorId: string;
    commissionRate: number;
    status: 'pending' | 'active' | 'paused' | 'terminated';
    since: Date;
  };
  stats: {
    totalExperiences: number;
    totalSales: number;
    rating: number;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Quick Reference

### Curator Dashboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Create New Card | `Cmd/Ctrl + N` |
| Search Cards | `Cmd/Ctrl + K` |
| Toggle Sidebar | `Cmd/Ctrl + B` |
| Open Settings | `Cmd/Ctrl + ,` |
| Open Help | `?` |

### Status Color Codes

| Status | Color | Badge |
|--------|-------|-------|
| Draft | Gray | Gray gradient |
| In Review | Blue | Blue gradient |
| Live | Green | Green gradient |
| Returned | Orange | Orange gradient |

### Commission Quick Math

```
For a $100 sale with 15% platform fee and 20% curator rate:
• Platform gets: $15
• Curator gets: $17
• Business gets: $68
```

### Support Response Times

| Channel | Response Time | Availability |
|---------|---------------|--------------|
| Live Chat | < 2 minutes | Mon-Fri 9am-6pm PST |
| Support Ticket | < 24 hours | 24/7 |
| Email | 24-48 hours | 24/7 |

---

## Success Metrics

### What Makes a Successful Curator?

**Key Performance Indicators**:
1. **Card Approval Rate**: > 80% first-submission approval
2. **Average Card Rating**: > 4.5 stars
3. **Conversion Rate**: > 3% (views to purchases)
4. **Review Count**: > 10 reviews per card
5. **Business Partnerships**: 3-5 active partnerships
6. **Monthly Earnings**: Consistent growth
7. **Customer Satisfaction**: > 95% positive experiences

### Growth Milestones

**Beginner** (Month 1-3):
- 5-10 live cards
- 1-2 business partnerships
- $500-1000/month earnings
- Learning platform

**Intermediate** (Month 4-12):
- 15-25 live cards
- 3-5 business partnerships
- $2000-5000/month earnings
- Established reputation

**Advanced** (Year 2+):
- 30+ live cards
- 5-10 business partnerships
- $5000-15000/month earnings
- Top-rated curator status

**Expert** (Year 3+):
- 50+ live cards
- 10+ business partnerships
- $15000+/month earnings
- Platform ambassador

---

## Troubleshooting

### Common Issues

#### Card Not Approved
**Possible Reasons**:
- Insufficient description
- Low-quality images
- Pricing not clear
- Missing availability
- Category mismatch
- Location issues

**Solution**: Check feedback in "Returned" status, address all points, resubmit

#### Business Won't Accept Commission
**Possible Reasons**:
- Rate too high for their margins
- Don't understand value proposition
- Comparing to competitors
- First-time partnership hesitation

**Solution**: Open negotiation, explain value, offer trial period, show success examples

#### Low Card Performance
**Possible Reasons**:
- Poor image quality
- Weak title/description
- Overpriced
- Limited availability
- Low match score
- Category saturation

**Solution**: Review analytics, optimize content, adjust pricing, increase availability, A/B test changes

#### Payout Delayed
**Possible Reasons**:
- Bank info incorrect
- Below minimum threshold
- Pending transactions
- Tax forms not submitted
- Account verification needed

**Solution**: Check payout settings, verify bank details, complete tax forms, contact support

---

## Additional Resources

### Documentation Files

**System Guides**:
- `/MINGLA_COMPLETE_SYSTEM_GUIDE.md` - Platform overview
- `/BUSINESS_COMPLETE_SYSTEM_GUIDE.md` - Business user guide
- `/CURATOR_CARDS_INTEGRATION_COMPLETE.md` - Card system details
- `ARCHITECTURE.md` (Section: Payment & Commission System) - Commission details
- `SUPPORT_SYSTEM_QUICK_START.md` - Support system guide

**Feature Guides**:
- `/AVAILABILITY_SYSTEM.md` - Availability builder
- `/PACKAGE_SYSTEM_GUIDE.md` - Package configuration
- `/DATE_TIME_TRAVEL_SYSTEM_COMPLETE.md` - Travel integration
- `/PREFERENCES_AND_CARD_GENERATION_SYSTEM.md` - Recommendation system

**Category Guides**:
- `/components/DINING_EXPERIENCES_READY.md`
- `/components/WELLNESS_DATES_READY.md`
- `/components/PLAY_MOVE_READY.md`
- `/components/CREATIVE_HANDS_ON_PRODUCTION_GUIDE.md`
- `/components/SCREEN_RELAX_READY.md`
- And more in `/components/` directory

### Getting Help

**In-App Support**:
1. Click "Help & Support" in sidebar
2. Browse Best Practices guides
3. Submit support ticket
4. Start live chat

**External Resources**:
- Email: curator-support@mingla.com
- Phone: 1-800-MINGLA-1
- Community Forum: forum.mingla.com/curators
- Social: @MinglaSupport on Twitter

---

## Appendix

### Glossary

- **Card**: An experience listing created by a curator
- **Package**: A pricing tier within an experience
- **Commission**: Percentage earned from sales
- **Validation**: Confirming customer purchase via QR
- **Match Score**: Algorithm rating for user compatibility
- **Payout**: Transfer of earnings to curator
- **Business Partner**: Company curator collaborates with
- **Availability**: Time slots when experience is offered
- **Capacity**: Max participants for experience
- **Status**: Current state of card (draft, live, etc.)

### Changelog

**Version 1.0** (October 2025):
- Initial curator dashboard
- Card creation system
- Business partnerships
- Commission management
- Analytics dashboard
- Payout system
- QR validation
- Support system
- 10 experience categories
- Availability builder
- Package system

---

**Last Updated**: October 19, 2025  
**Version**: 1.0  
**Maintained By**: Mingla Product Team

For questions or feedback on this documentation, contact: docs@mingla.com
