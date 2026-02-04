# Mingla Platform Architecture

## 🏗️ System Overview

Mingla is a multi-user collaboration platform connecting **Explorers**, **Curators**, and **Businesses** through experience discovery and commission-based partnerships.

### Brand Identity
- **Primary**: #eb7825 (Orange)
- **Secondary**: #d6691f (Dark Orange)
- **Supporting**: White, Black
- **Logo**: 2x size (80px/96px), left-aligned across all dashboards

---

## 👥 User Roles & Permissions

### 1. Explorer (Regular User)
**Access**: Main app experience (Home, Connections, Activity, Profile)

**Capabilities**:
- ✅ Browse and swipe experience cards (10 categories)
- ✅ Save favorites and create boards
- ✅ Schedule experiences with travel constraints
- ✅ Purchase multi-package experiences
- ✅ Friend connections and messaging
- ✅ Collaboration boards with discussion
- ✅ Calendar sync and notifications
- ✅ Coach mark onboarding (5 steps)

**Restrictions**:
- ❌ Cannot create official experience cards
- ❌ Cannot access business features

**Test Account**: `jordan.explorer@mingla.com` / `Mingla2025!`

---

### 2. Curator (Experience Creator)
**Access**: Curator Dashboard + Full Explorer Features

**Capabilities**:
- ✅ **Business Management**:
  - Onboard new business profiles
  - Manage multiple business relationships
  - View business performance metrics
- ✅ **Card Creation**:
  - Create experience cards on behalf of businesses
  - Submit cards for QA review
  - Track card performance (views, likes, saves)
- ✅ **Commission System**:
  - Negotiate commission percentages with businesses
  - Track earnings from card sales
  - View commission analytics
  - Request payouts
- ✅ **Collaboration**:
  - Message businesses
  - Coordinate card details
  - Manage approval workflows

**Restrictions**:
- ❌ Cannot directly publish cards (requires QA approval)
- ❌ Cannot approve commission rates (business approval needed)

**Test Account**: `maria.curator@mingla.com` / `Mingla2025!`

**Dashboard Sections**:
1. Overview - Stats and quick actions
2. My Cards - Created experiences
3. My Businesses - Managed business profiles
4. Earnings - Commission tracking
5. Analytics - Performance metrics
6. Messages - Business communications
7. Settings - Curator preferences
8. Support - Help and tickets

---

### 3. Business (Venue/Service Provider)
**Access**: Business Dashboard

**Capabilities**:
- ✅ **Profile Management**:
  - Manage business information
  - Update venue details
  - Configure business settings
- ✅ **Card Management**:
  - View cards created by curators
  - Approve/reject card submissions
  - Monitor card performance
- ✅ **Sales & Revenue**:
  - Track bookings and sales
  - Monitor revenue by experience
  - View transaction history
- ✅ **Commission Management**:
  - Approve curator commission requests
  - Negotiate commission percentages
  - View commission breakdowns
- ✅ **Payouts**:
  - Connect Stripe account
  - Receive payouts (39 currencies)
  - View payout history
  - KYC verification
- ✅ **Analytics**:
  - Sales reports
  - Customer insights
  - Popular experiences

**Restrictions**:
- ❌ Cannot create cards directly (requires curator)
- ❌ Cannot access platform-wide data

**Test Account**: `lola.business@mingla.com` / `Mingla2025!`

**Dashboard Sections**:
1. Overview - Business stats
2. My Cards - Experience listings
3. Sales - Booking tracking
4. Earnings - Revenue overview
5. Payouts - Payment management
6. Analytics - Business insights
7. Negotiations - Curator collaborations
8. Messages - Communications
9. Settings - Business configuration
10. Support - Help center

---

### 4. QA Manager (Content Moderator)
**Access**: QA Manager Dashboard

**Capabilities**:
- ✅ **Content Moderation**:
  - Review submitted experience cards
  - Approve cards for publishing
  - Reject cards with feedback
  - Moderate user-generated content
- ✅ **Quality Control**:
  - Verify card accuracy
  - Check images and descriptions
  - Validate pricing and packages
  - Ensure brand standards
- ✅ **Marketing**:
  - Create promotional campaigns
  - Feature popular experiences
  - Manage platform communications
- ✅ **Support Management**:
  - Handle support tickets
  - Respond to user issues
  - Escalate to admin when needed
- ✅ **Admin Communication**:
  - Internal QA-Admin chat system
  - Coordinate with admin team

**Restrictions**:
- ❌ Cannot manage users or roles
- ❌ Cannot access financial admin features
- ❌ Limited analytics (content-focused only)

**Test Account**: `sam.qa@mingla.com` / `Mingla2025!`

**Dashboard Sections**:
1. Overview - Moderation queue
2. My Cards - Platform cards
3. Moderate - Review submissions
4. Marketing - Campaign tools
5. Admin Chat - Internal communication
6. Settings - QA preferences
7. Support - Ticket management

---

### 5. Admin (Platform Manager)
**Access**: Admin Dashboard + All Platform Features

**Capabilities**:
- ✅ **Full System Control**:
  - All QA Manager capabilities
  - User management (create, edit, delete, roles)
  - Platform-wide analytics
  - System configuration
- ✅ **Business Oversight**:
  - Approve new business registrations
  - Manage business relationships
  - Monitor business performance
- ✅ **Financial Management**:
  - Platform revenue tracking
  - Commission oversight
  - Payout management
  - Financial reporting
- ✅ **User Management**:
  - Create/edit/delete users
  - Assign roles
  - Manage permissions
  - Ban/suspend users
- ✅ **Analytics**:
  - Platform-wide metrics
  - Growth tracking
  - User engagement
  - Revenue analytics
- ✅ **Content & Marketing**:
  - All content moderation powers
  - Marketing campaign creation
  - Featured content management

**Restrictions**: None (full access)

**Test Account**: `admin@mingla.com` / `Mingla2025!`

**Dashboard Sections**:
1. Overview - Platform stats
2. User Management - All users
3. My Businesses - Business oversight
4. My Cards - All platform cards
5. Finances - Revenue & payouts
6. Analytics - Platform metrics
7. Moderate - Content review
8. Marketing - Campaigns
9. QA Chat - Team coordination
10. Settings - System config
11. Support - Ticket oversight

---

## 🔄 Collaboration Workflows

### Curator → Business → Explorer Flow

```
1. Curator onboards Business
   ↓
2. Curator creates Experience Card for Business
   ↓
3. Business reviews and approves Card
   ↓
4. Curator submits Card to QA
   ↓
5. QA Manager reviews Card
   ↓
6. QA approves → Card published to live feed
   ↓
7. Explorers discover and purchase
   ↓
8. Commission split between Business and Curator
   ↓
9. Payouts processed via Stripe Connect
```

### Commission Negotiation Flow

```
1. Curator proposes commission % to Business
   ↓
2. Business reviews commission request
   ↓
3. Business approves or counter-offers
   ↓
4. Negotiation continues until agreement
   ↓
5. Agreed commission applied to Card sales
   ↓
6. Automatic commission splits on purchases
```

---

## 🏛️ Architecture Patterns

### Component Organization

```
/components/
├── admin/               # Admin-specific dashboard components
├── business/            # Business-specific dashboard components
├── curator/             # Curator-specific dashboard components
├── qa-manager/          # QA Manager-specific dashboard components
├── activity/            # Shared: Activity page modules
├── collaboration/       # Shared: Board collaboration features
├── connections/         # Shared: Friends and messaging
├── messages/            # Shared: Direct messaging system
├── onboarding/          # Shared: User onboarding flow
├── swipeable-cards/     # Shared: Card discovery interface
├── CoachMark/           # Shared: Coach mark onboarding
├── card-creator/        # Shared: Card creation wizard
├── ui/                  # Shared: ShadCN UI components
└── utils/               # Shared: Helper functions and data
```

### Shared vs Role-Specific Components

**Shared Components** (Used by all roles):
- `MessagesPage.tsx` - Direct messaging
- `ConnectionsPage.tsx` - Friends system
- `ActivityPage.tsx` - Activity tracking
- `ProfilePage.tsx` - User profiles
- `AccountSettings.tsx` - Account management
- `NotificationSystem.tsx` - Notifications
- `LiveChatSupport.tsx` - Customer support

**Shared Business Components** (Curator/Business/Admin):
- `CardCreatorModal.tsx` - Create experiences
- `CardEditorModal.tsx` - Edit experiences
- `PayoutsSystem.tsx` - Payment processing
- `CommissionNegotiationModal.tsx` - Commission deals
- `BusinessManagementModal.tsx` - Business profiles
- `AvailabilityBuilder.tsx` - Availability management

**Shared Moderation Components** (QA/Admin):
- `QAAdminChat.tsx` - Internal communication
- `SupportTicketsSection.tsx` - Ticket management

---

## 🎨 Design System

### Modern Compact Design (Standardized)
All dashboards follow consistent design principles:
- **White containers** with rounded corners
- **Consistent spacing** (16px/24px/32px)
- **Brand orange** (#eb7825) for CTAs and highlights
- **Left-aligned logo** at 80px/96px (2x original size)
- **Mobile-first responsive** design
- **Card-based layouts** for information density

### Typography Hierarchy
- Set in `/styles/globals.css`
- No Tailwind font classes needed
- Consistent across all roles

### Color Usage
- **Primary Orange** (#eb7825): CTAs, active states, highlights
- **Dark Orange** (#d6691f): Hover states, secondary actions
- **White**: Containers, backgrounds
- **Black**: Text, borders
- **Gray scale**: Supporting elements

---

## 💳 Payment & Commission System

### Multi-Currency Support
- **39 currencies** supported
- Real-time exchange rates
- Currency conversion transparency
- Region-based payout methods

### Commission Structure

```
Purchase Price: $100
├── Platform Fee: 10% = $10
├── Curator Commission: 15% (of remaining $90) = $13.50
└── Business Revenue: $76.50

Breakdown displayed to:
- Explorer: Total price + fee transparency
- Curator: Commission earned per sale
- Business: Revenue after commissions
- Admin: Full platform revenue analytics
```

### Stripe Connect Integration
- **For Businesses**:
  - Onboard Stripe Connect account
  - KYC verification by region
  - Automatic payout scheduling
  - Multi-currency payouts
- **For Curators**:
  - Commission tracking
  - Payout requests
  - Earnings dashboard

---

## 🎓 Coach Mark System

### 5-Step Explorer Onboarding

Mobile-first, non-obtrusive tooltips:

1. **Welcome** - Platform introduction
2. **Swipe Cards** - How to discover experiences
3. **Action Buttons** - Like, save, share functions
4. **Create Board** - Collaboration features
5. **Profile Access** - Account management

**Features**:
- One-time completion tracking
- Responsive tooltips with arrows
- Brand-colored dashed lines (#eb7825)
- Skip anytime
- Mobile-optimized positioning

---

## 📦 State Management

### Current Approach
- React hooks (`useState`, `useEffect`, `useContext`)
- LocalStorage for persistence
- Component-level state

### Files:
- `/components/AppStateManager.tsx` - Central state
- `/components/AppHandlers.tsx` - Action handlers

### Ready for:
- Redux/Zustand integration
- API connection (Supabase, custom backend)
- Real-time WebSocket updates

---

## 🗄️ Database Schema

See `DATABASE_COMPLETE_SCHEMA.md` for full schema.

### Key Tables:
- **users** - All user roles
- **businesses** - Business profiles
- **experience_cards** - All experiences
- **curator_businesses** - Curator-business relationships
- **commissions** - Commission agreements
- **purchases** - Transaction records
- **payouts** - Payout history
- **support_tickets** - Support system

---

## 🚀 Deployment Architecture

### Recommended Stack:

**Frontend**:
- Vercel / Netlify (static hosting)
- CDN for assets
- Environment variables for API keys

**Backend** (when ready):
- Supabase (PostgreSQL + Auth + Storage)
- Stripe Connect for payouts
- Google Places API for location search

**Analytics**:
- Google Analytics for user tracking
- Mixpanel for event tracking
- Stripe Dashboard for payment analytics

---

## 📱 Responsive Design

### Breakpoints:
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

### Mobile-First Features:
- Coach marks optimized for mobile
- Touch-friendly swipe cards
- Bottom navigation on mobile
- Collapsible sections
- Responsive dashboards

---

## 🔒 Security Considerations

### Current (Mock Data):
- Client-side role simulation
- LocalStorage for state
- No real authentication

### Production Requirements:
- JWT authentication
- Server-side role verification
- API rate limiting
- CORS configuration
- Environment variable protection
- Input sanitization
- XSS prevention
- CSRF tokens

---

## 🧪 Testing Strategy

### Manual Testing:
- Test all 5 user roles
- Verify role-specific features
- Check commission calculations
- Test multi-currency
- Validate QR codes
- Mobile responsiveness

### Automated Testing (Ready for):
```bash
npm install --save-dev vitest @testing-library/react
```

---

## 📚 Related Documentation

- `README.md` - Quick start
- `MINGLA_COMPLETE_SYSTEM_GUIDE.md` - Comprehensive guide
- `BUSINESS_COMPLETE_SYSTEM_GUIDE.md` - Business features
- `CURATOR_COMPLETE_DOCUMENTATION.md` - Curator features
- `GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md` - Payment system
- `DATABASE_COMPLETE_SCHEMA.md` - Database structure
- `BACKEND_API_COMPLETE_GUIDE.md` - API specifications

---

**Last Updated**: October 2025
**Version**: 2.0 (Post-refactoring)
