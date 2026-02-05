# Unified Card System - Complete Platform Integration

## Overview

The Mingla platform now uses a **centralized card system** where all user roles (Explorers, Curators, Businesses, Content Managers, QA Managers, and Admins) work with the same set of cards. Changes made by any user role persist across the entire platform.

---

## Core Principles

### 1. Single Source of Truth
- All cards are stored in `platformCards` state in AppStateManager
- Live cards shown to explorers = Cards managed by curators/businesses/managers
- No duplication or separate card stores

### 2. Card Ownership & Attribution
Cards can be created by:
- **Curators for the platform** - Independent curator-created experiences
- **Businesses for the platform** - Businesses creating their own experiences
- **Curators for businesses** - Curators creating experiences on behalf of businesses (earn 10% commission)

### 3. Persistent Edits
- All edits update the centralized `platformCards` array
- Changes are immediately visible to all user roles
- localStorage ensures persistence across sessions

---

## Card Lifecycle & Status Flow

### Status Types
```
draft → in-review → live (or returned)
```

- **draft**: Initial creation, work in progress
- **in-review**: Submitted for content review
- **live**: Published and visible to explorers
- **returned**: Sent back for revisions

### Who Can Do What

| Action | Explorer | Curator | Business | Content Mgr | QA Mgr | Admin |
|--------|----------|---------|----------|-------------|--------|-------|
| View Live Cards | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create Cards | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Edit Own Cards | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Edit Any Card | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Approve/Reject | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Delete Cards | ❌ | ✅ Own | ✅ Own | ❌ | ✅ | ✅ |

---

## Card Data Structure

### Core Fields
```typescript
interface PlatformCard {
  id: string;
  title: string;
  category: string; // Must match preference categories
  description: string;
  image: string;
  location: string;
  venue: string;
  price: string;
  duration: string;
  rating: number;
  reviews: number;
  
  // Status & Workflow
  status: 'draft' | 'in-review' | 'live' | 'returned';
  
  // Ownership & Attribution
  createdBy: string;           // User ID of creator
  createdByRole: 'curator' | 'business';
  createdByName: string;
  businessId?: string;         // If created for a business
  businessName?: string;
  curatorId?: string;          // If curator created for business
  
  // Timestamps
  createdAt: string;
  lastEdited: string;
  publishedAt?: string;
  
  // Stats (for live cards)
  views?: number;
  likes?: number;
  saves?: number;
  totalSales?: number;
  
  // Feedback
  feedback?: string;
  reviewedBy?: string;
}
```

---

## Test Data Distribution

### Live Cards (7 total - shown to explorers)

#### 1. Curator-Created for Platform (2 cards)
- **Sunset Rooftop Wine Tasting** - `card-curator-1`
  - Creator: Sarah Martinez (curator-001)
  - Category: Sip & Chill
  - No business affiliation
  
- **Morning Yoga at Golden Gate Park** - `card-curator-2`
  - Creator: Sarah Martinez (curator-001)
  - Category: Wellness Dates
  - No business affiliation

#### 2. Business-Created for Platform (2 cards)
- **Chef's Table Tasting Menu** - `card-business-1`
  - Creator: Le Jardin Restaurant (business-le-jardin)
  - Category: Dining Experiences
  - Self-created by business
  
- **Artisan Pottery Workshop** - `card-business-2`
  - Creator: Clay & Co Studio (business-clay-co)
  - Category: Creative & Hands-On
  - Self-created by business

#### 3. Curator-Created for Businesses (3 cards)
- **Jazz Night at The Blue Note** - `card-curator-for-business-1`
  - Creator: Michael Chen (curator-002)
  - For Business: The Blue Note SF
  - Category: Screen & Relax
  - Curator earns 10% commission
  
- **Sunset Kayaking Adventure** - `card-curator-for-business-2`
  - Creator: Michael Chen (curator-002)
  - For Business: Bay Adventures
  - Category: Play & Move
  - Curator earns 10% commission
  
- **Farm-to-Table Brunch Experience** - `card-curator-for-business-3`
  - Creator: Sarah Martinez (curator-001)
  - For Business: The Farmhouse Kitchen
  - Category: Casual Eats
  - Curator earns 10% commission

### Draft/Review/Returned Cards (3 total - not shown to explorers)

#### Draft (1 card)
- **Chocolate Making Masterclass** - `card-draft-1`
  - Creator: Sarah Martinez (curator-001)
  - Status: draft
  - Still being worked on

#### In Review (1 card)
- **Urban Hiking & Coffee Tour** - `card-in-review-1`
  - Creator: Urban Explorers (business-urban-explorers)
  - Status: in-review
  - Awaiting content manager review
  - Has feedback from content manager

#### Returned (1 card)
- **Rooftop Cinema Experience** - `card-returned-1`
  - Creator: Michael Chen (curator-002)
  - For Business: SkyView Cinema
  - Status: returned
  - Has feedback from QA manager
  - Needs updates before resubmission

---

## How It Works in Practice

### Scenario 1: Explorer Views Cards
```
Explorer opens app
→ HomePage filters platformCards where status === 'live'
→ Shows 7 live cards
→ Cards include mix of curator-created, business-created, and curator-for-business
```

### Scenario 2: Curator Creates Card
```
Curator creates new card
→ Card added to platformCards with status: 'draft'
→ Curator can edit, submit for review
→ When submitted: status changes to 'in-review'
→ Card appears in Content Manager dashboard
```

### Scenario 3: Content Manager Reviews
```
Content Manager views all 'in-review' cards
→ Can edit content, add feedback
→ Sends to QA Manager for approval
→ Card stays in 'in-review' status
```

### Scenario 4: QA Manager Approves
```
QA Manager reviews card
→ Option 1: Approve → status changes to 'live'
  → Card immediately visible to explorers
→ Option 2: Return → status changes to 'returned'
  → Feedback added
  → Creator can revise and resubmit
```

### Scenario 5: Business Edits Their Card
```
Business user logs in
→ Sees their own cards (created by them OR created for them by curator)
→ Edits live card (e.g., update pricing)
→ Changes immediately reflected in platformCards
→ Explorers see updated card
```

### Scenario 6: Curator Manages Business Cards
```
Curator logs in
→ Views "My Businesses" tab
→ Sees businesses they manage
→ Creates card for business
→ Card has curatorId set
→ When sales occur, curator earns 10% commission
```

---

## Technical Implementation

### AppStateManager.tsx
```typescript
// Centralized card storage
const [platformCards, setPlatformCards] = useState(() => {
  const stored = safeLocalStorageGet('mingla_platform_cards', null);
  if (stored && stored.length > 0) {
    return stored;
  }
  // Initialize with seed data
  const { PLATFORM_CARDS_SEED } = require('./utils/platformCards');
  return PLATFORM_CARDS_SEED;
});

// CRUD operations
const addPlatformCard = (cardData) => { ... };
const updatePlatformCard = (cardId, updates) => { ... };
const deletePlatformCard = (cardId) => { ... };
```

### Card Filtering Examples

**For Explorers (HomePage):**
```typescript
const liveCards = platformCards.filter(card => card.status === 'live');
```

**For Curators (CuratorDashboard):**
```typescript
const curatorCards = platformCards.filter(card => 
  card.createdBy === curatorId || card.curatorId === curatorId
);
```

**For Businesses (BusinessDashboard):**
```typescript
const businessCards = platformCards.filter(card =>
  card.businessId === businessId || card.createdBy === businessId
);
```

**For Content Managers:**
```typescript
const reviewCards = platformCards.filter(card => 
  card.status === 'in-review'
);
```

**For QA Managers:**
```typescript
const allNonDraftCards = platformCards.filter(card =>
  card.status !== 'draft'
);
```

---

## Commission System

### How It Works
1. **Curator creates card for business**
   - Card includes `curatorId` and `businessId`
   - Business receives 90% of revenue
   - Curator receives 10% commission

2. **Business creates own card**
   - No curator involved
   - Business receives 100% of revenue (minus platform fees)

### Tracking
- `totalSales` field tracks gross revenue
- Commission calculations:
  ```typescript
  const curatorEarnings = totalSales * 0.10;
  const businessEarnings = totalSales * 0.90;
  ```

---

## Dashboard Views

### Curator Dashboard
**My Cards Tab:**
- Shows all cards where `createdBy === curatorId` OR `curatorId === curatorId`
- Includes both independent cards and cards created for businesses
- Color-coded by status

**My Businesses Tab:**
- Shows businesses where `curatorId === currentUserId`
- Displays commission earned per business
- Can create new cards for managed businesses

### Business Dashboard
**My Cards Tab:**
- Shows cards where `businessId === currentBusinessId`
- Includes both self-created and curator-created cards
- Can edit own cards

**Analytics Tab:**
- Revenue breakdown
- 90% business earnings
- 10% curator commission (if applicable)

### Content Manager Dashboard
- Views all cards with status: `in-review`
- Can edit content
- Can add feedback
- Cannot publish (QA Manager does this)

### QA Manager Dashboard
- Views all cards except `draft`
- Final approval authority
- Can publish (`live`) or return (`returned`)

### Admin Dashboard
- Full access to all cards
- Can perform any action
- Override capabilities

---

## Persistence & Sync

### localStorage Keys
- `mingla_platform_cards` - All cards
- `mingla_businesses` - All businesses
- Changes persist across:
  - Page refreshes
  - Sign out/sign in
  - Role switches (in test mode)

### Real-time Updates
While not implemented with WebSockets (this is a prototype), the architecture supports:
1. All edits update centralized state
2. State changes trigger re-renders
3. All components see latest data

---

## Testing Workflow

### Test Scenario 1: Full Card Lifecycle
1. Sign in as **Curator**
2. Create new card (status: draft)
3. Submit for review (status: in-review)
4. Sign out, sign in as **Content Manager**
5. Edit card, add feedback
6. Sign out, sign in as **QA Manager**
7. Approve card (status: live)
8. Sign out, sign in as **Explorer**
9. See card in feed

### Test Scenario 2: Business Card Management
1. Sign in as **Curator**
2. Add new business via "My Businesses"
3. Create card for that business
4. Sign out, sign in as **Business** (using business email)
5. See card in Business Dashboard
6. Edit card (update pricing)
7. Sign out, sign in as **Explorer**
8. See updated pricing

### Test Scenario 3: Commission Tracking
1. Sign in as **Curator**
2. View "My Businesses" tab
3. See businesses managed
4. See commission earnings per business
5. Create additional card for business
6. Verify commission calculations

---

## API Integration (Future)

When connecting to a real backend:

```typescript
// GET all cards
GET /api/cards
Response: PlatformCard[]

// GET cards by status
GET /api/cards?status=live
Response: PlatformCard[]

// POST new card
POST /api/cards
Body: CardCreateDto
Response: PlatformCard

// PATCH update card
PATCH /api/cards/:id
Body: CardUpdateDto
Response: PlatformCard

// PATCH change status
PATCH /api/cards/:id/status
Body: { status: 'live', reviewedBy: 'user-id' }
Response: PlatformCard

// DELETE card
DELETE /api/cards/:id
Response: { success: true }
```

---

## Key Benefits

### ✅ Single Source of Truth
- No data duplication
- No sync issues
- Consistent across all roles

### ✅ Real Collaboration
- Content Managers improve content
- QA Managers ensure quality
- Changes are persistent

### ✅ Clear Attribution
- Know who created each card
- Track curator-business relationships
- Calculate commissions accurately

### ✅ Flexible Workflow
- Draft → Review → Live
- Feedback loop with returns
- Role-appropriate permissions

### ✅ Testable System
- Seed data covers all scenarios
- Easy to verify full workflow
- Representative of production use

---

## Summary

The unified card system creates a cohesive platform where:
- **Explorers** see quality-controlled experiences
- **Curators** create and manage cards, earn commissions
- **Businesses** publish experiences, track revenue
- **Content Managers** improve quality
- **QA Managers** maintain standards
- **Admins** oversee everything

All working with the same data, ensuring consistency and collaboration across the entire Mingla platform.
