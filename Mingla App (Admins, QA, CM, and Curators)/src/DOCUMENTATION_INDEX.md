# Mingla Documentation Index

**Quick Navigation Guide** - Find the right documentation for your needs.

---

## 🚀 Getting Started

### For New Developers
1. **[README.md](README.md)** - Start here! Quick start, overview, and installation
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** - System architecture and user roles
3. **[MINGLA_COMPLETE_SYSTEM_GUIDE.md](MINGLA_COMPLETE_SYSTEM_GUIDE.md)** - Comprehensive platform guide

### For Designers
1. **[ARCHITECTURE.md](ARCHITECTURE.md)** - Brand colors and design system
2. `/theme/` - Design tokens (colors, typography, spacing)
3. `/styles/globals.css` - Global CSS and Tailwind configuration

---

## 👥 User Role Documentation

### Explorer (Regular Users)
- **[README.md](README.md)** - Explorer features overview
- **[COACH_MARK_QUICK_START.md](COACH_MARK_QUICK_START.md)** - Onboarding coach marks
- `/components/onboarding/README.md` - Onboarding flow
- `/components/swipeable-cards/README.md` - Card discovery
- `/components/activity/README.md` - Activity page
- `/components/connections/README.md` - Friends and messaging

### Curator (Experience Creators)
- **[CURATOR_COMPLETE_DOCUMENTATION.md](CURATOR_COMPLETE_DOCUMENTATION.md)** - Complete curator guide
- **[CURATOR_QUICK_START.md](CURATOR_QUICK_START.md)** - Quick setup
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Curator role details (Section 2)

### Business (Venue/Service Providers)
- **[BUSINESS_COMPLETE_SYSTEM_GUIDE.md](BUSINESS_COMPLETE_SYSTEM_GUIDE.md)** - Complete business guide
- **[BUSINESS_SYSTEM_QUICK_START.md](BUSINESS_SYSTEM_QUICK_START.md)** - Quick setup
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Business role details (Section 3)

### QA Manager (Content Moderators)
- **[ADMIN_DASHBOARD_QUICK_START.md](ADMIN_DASHBOARD_QUICK_START.md)** - QA features (Section 2)
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - QA Manager role details (Section 4)

### Admin (Platform Managers)
- **[ADMIN_DASHBOARD_QUICK_START.md](ADMIN_DASHBOARD_QUICK_START.md)** - Admin guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Admin role details (Section 5)

---

## 💳 Payments & Financial System

### Global Payments
- **[GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md](GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md)** - Complete payment system
- **[GLOBAL_PAYMENTS_UX_SPEC.md](GLOBAL_PAYMENTS_UX_SPEC.md)** - Payment UX specifications
- **[STRIPE_CONNECT_IMPLEMENTATION.md](STRIPE_CONNECT_IMPLEMENTATION.md)** - Stripe Connect setup
- **[STRIPE_QUICK_START.md](STRIPE_QUICK_START.md)** - Quick Stripe setup

### Multi-Currency (39 Currencies)
- See: `GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md` (Section 3)

### Commission System
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Commission structure (Section: Payment & Commission System)
- **[BUSINESS_COMPLETE_SYSTEM_GUIDE.md](BUSINESS_COMPLETE_SYSTEM_GUIDE.md)** - Business perspective
- **[CURATOR_COMPLETE_DOCUMENTATION.md](CURATOR_COMPLETE_DOCUMENTATION.md)** - Curator perspective

---

## 🎴 Experience Cards System

### Card Structure & Data
- **[CARD_STRUCTURE_AND_API_GUIDE.md](CARD_STRUCTURE_AND_API_GUIDE.md)** - Card data structure
- **[CARD_DATA_PREFERENCES_GUIDE.md](CARD_DATA_PREFERENCES_GUIDE.md)** - Preferences and generation
- **[UNIFIED_CARD_SYSTEM.md](UNIFIED_CARD_SYSTEM.md)** - Unified card architecture
- **[DATABASE_CARD_SCHEMA.md](DATABASE_CARD_SCHEMA.md)** - Database schema for cards

### Card Creation
- **[CARD_CREATOR_BADGE_SYSTEM.md](CARD_CREATOR_BADGE_SYSTEM.md)** - Creator badges
- `/components/card-creator/` - Card creation wizard components

### Experience Categories (10 Types)
- **[EXPERIENCE_TYPES_AND_CATEGORIES_GUIDE.md](EXPERIENCE_TYPES_AND_CATEGORIES_GUIDE.md)** - All categories
  1. Casual Eats - `/components/utils/casualEatsData.ts`
  2. Dining Experiences - `/components/utils/diningExperiencesData.ts`
  3. Freestyle - `/components/utils/freestyleData.ts`
  4. Creative Hands-On - `/components/utils/creativeHandsOnData.ts`
  5. Creative Picnics - `/components/utils/picnicsData.ts`
  6. Play & Move - `/components/utils/playMoveData.ts`
  7. Screen & Relax - `/components/utils/screenRelaxData.ts`
  8. Sip & Chill - `/components/utils/sipChillData.ts`
  9. Take a Stroll - `/components/utils/takeAStrollData.ts`
  10. Wellness Dates - `/components/utils/wellnessData.ts`

---

## 🗄️ Database & Backend

### Database Schema
- **[DATABASE_COMPLETE_SCHEMA.md](DATABASE_COMPLETE_SCHEMA.md)** - Complete database schema
- **[DATABASE_CARD_SCHEMA.md](DATABASE_CARD_SCHEMA.md)** - Card-specific schema

### API Integration
- **[BACKEND_API_COMPLETE_GUIDE.md](BACKEND_API_COMPLETE_GUIDE.md)** - Complete API guide
- `/components/AppStateManager.tsx` - State management (ready for API)
- `/components/AppHandlers.tsx` - Action handlers (ready for API)

---

## 🎓 Onboarding & User Experience

### Coach Mark System (5 Steps)
- **[COACH_MARK_QUICK_START.md](COACH_MARK_QUICK_START.md)** - Quick guide
- `/components/CoachMark/README.md` - Component documentation
- `/components/CoachMark/coachMarkSteps.ts` - Step definitions

### User Onboarding Flow
- `/components/onboarding/README.md` - Onboarding components
- `/components/onboarding/steps/` - Individual onboarding steps

### Preferences & Personalization
- **[PREFERENCES_AND_CARD_GENERATION_SYSTEM.md](PREFERENCES_AND_CARD_GENERATION_SYSTEM.md)** - User preferences
- `/components/utils/preferences.ts` - Preference utilities

---

## 🤝 Collaboration Features

### Collaboration Boards
- `/components/collaboration/README.md` - Collaboration system
- `/components/CollaborationModule.tsx` - Main collaboration component

### Messaging System
- `/components/messages/README.md` - Message system documentation
- `/components/MessagesPage.tsx` - Messages page

### Connections & Friends
- `/components/connections/README.md` - Connections documentation
- `/components/ConnectionsPage.tsx` - Connections page

---

## 🌍 Travel & Location System

### Travel Constraints
- **[TRAVEL_SYSTEM_QUICK_START.md](TRAVEL_SYSTEM_QUICK_START.md)** - Travel system guide
- `/components/utils/travelTime.ts` - Travel time calculations
- `/components/utils/googleMapsTravel.ts` - Google Maps integration

### Location Search
- `/components/GooglePlacesAutocomplete.tsx` - Places autocomplete
- `/components/utils/geolocation.ts` - Geolocation utilities

---

## 🎫 Support System

### Tickets & Help
- **[SUPPORT_SYSTEM_QUICK_START.md](SUPPORT_SYSTEM_QUICK_START.md)** - Support system guide
- `/components/SupportTicketsSection.tsx` - Ticket management
- `/components/LiveChatSupport.tsx` - Live chat widget

---

## 🧩 Component-Level Documentation

### Modular Component Docs
Each major refactored module has its own README:

- `/components/activity/README.md` - Activity page (Boards, Saved, Calendar)
- `/components/collaboration/README.md` - Collaboration features
- `/components/connections/README.md` - Friends and messaging
- `/components/messages/README.md` - Message system
- `/components/onboarding/README.md` - User onboarding
- `/components/swipeable-cards/README.md` - Card discovery
- `/components/CoachMark/README.md` - Coach mark system

### Utility Documentation
- `/components/utils/reviewSystem.md` - Review system

---

## 🎨 Design & Styling

### Design System
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Design system (Section: Design System)
- `/theme/colors.ts` - Color palette
- `/theme/typography.ts` - Typography scale
- `/theme/spacing.ts` - Spacing system
- `/theme/shadows.ts` - Elevation/shadows
- `/theme/borderRadius.ts` - Border radii
- `/styles/globals.css` - Global styles + Tailwind V4

### Brand Guidelines
- **Primary**: #eb7825 (Orange)
- **Secondary**: #d6691f (Dark Orange)
- **Logo**: 2x size (80px/96px), left-aligned
- **Design**: Modern compact white containers

---

## 📋 Multi-User System

### Role-Based Architecture
- **[MULTI_USER_SYSTEM.md](MULTI_USER_SYSTEM.md)** - Detailed multi-user guide
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Complete architecture overview

### Test Accounts
All passwords: `Mingla2025!`
- **Explorer**: jordan.explorer@mingla.com
- **Curator**: maria.curator@mingla.com
- **Business**: lola.business@mingla.com
- **QA Manager**: sam.qa@mingla.com
- **Admin**: admin@mingla.com

---

## 🛠️ Development Guidelines

### Code Standards
- `/guidelines/Guidelines.md` - Development guidelines

### Configuration Files
- `package.json` - Dependencies
- `tsconfig.json` - TypeScript config
- `vite.config.ts` - Vite build config

---

## 📦 Other Documentation

### Attributions
- **[Attributions.md](Attributions.md)** - Third-party credits

---

## 🔍 Quick Find by Topic

### I want to...

**...add a new user role**
→ `MULTI_USER_SYSTEM.md` + `ARCHITECTURE.md`

**...integrate a backend API**
→ `BACKEND_API_COMPLETE_GUIDE.md` + `DATABASE_COMPLETE_SCHEMA.md`

**...set up Stripe payments**
→ `STRIPE_QUICK_START.md` → `STRIPE_CONNECT_IMPLEMENTATION.md`

**...add a new experience category**
→ `EXPERIENCE_TYPES_AND_CATEGORIES_GUIDE.md`

**...customize onboarding**
→ `components/onboarding/README.md` + `COACH_MARK_QUICK_START.md`

**...understand the commission system**
→ `ARCHITECTURE.md` (Section: Payment & Commission System)

**...add multi-currency support**
→ `GLOBAL_PAYMENTS_INTEGRATION_GUIDE.md`

**...customize the design**
→ `/theme/` directory + `styles/globals.css`

**...create a new experience card**
→ `CARD_STRUCTURE_AND_API_GUIDE.md` + `components/card-creator/`

**...add travel constraints**
→ `TRAVEL_SYSTEM_QUICK_START.md`

**...set up the support system**
→ `SUPPORT_SYSTEM_QUICK_START.md`

---

## 📊 Documentation Status

**Total Documentation Files**: ~20 core guides
**Component READMEs**: 7 modular docs
**Last Major Cleanup**: October 2025
**Documentation Coverage**: ✅ Comprehensive

---

## 💡 Best Practices

1. **Start with README.md** for overview
2. **Read ARCHITECTURE.md** to understand the system
3. **Reference role-specific docs** for detailed features
4. **Check component READMEs** for implementation details
5. **Use this index** to find specific documentation quickly

---

**Need something not listed here?**
Check inline code comments (JSDoc) or search the `/components` directory for specific features.

**Last Updated**: October 2025
