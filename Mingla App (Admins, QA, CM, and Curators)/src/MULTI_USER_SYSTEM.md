# Mingla Multi-User System

## Overview
Mingla now supports 5 distinct user roles, each with their own dashboards, permissions, and workflows.

## User Roles

### 1. Explorer (General User)
- **Email**: jordan.explorer@mingla.com
- **Password**: Mingla2025!
- **Access**: Full app experience (Home, Connections, Activity, Profile)
- **Capabilities**: 
  - Swipe and discover experience cards
  - Save favorites
  - Create collaboration boards
  - RSVP and schedule experiences
  - Cannot create official cards

### 2. Curator
- **Email**: maria.curator@mingla.com
- **Password**: Mingla2025!
- **Access**: Curator Dashboard
- **Capabilities**:
  - Create experience cards via mobile or web dashboard
  - Submit cards for review
  - Track card status (Draft, In Review, Live, Returned)
  - View performance metrics (views, likes, saves)
- **Restrictions**:
  - Cannot directly publish cards
  - Cards must go through review process
  - Once editing starts, status changes to Draft

### 3. Content Manager
- **Email**: alex.content@mingla.com
- **Password**: Mingla2025!
- **Access**: Content Manager Dashboard
- **Capabilities**:
  - Review all submitted cards
  - Edit card details (title, description, tags, categories)
  - Add feedback and improvement notes
  - Mark issues that need addressing
- **Restrictions**:
  - Cannot publish cards to live feed
  - All changes must be approved by QA Managers

### 4. QA Manager
- **Email**: sam.qa@mingla.com
- **Password**: Mingla2025!
- **Access**: QA Manager Dashboard
- **Capabilities**:
  - All Content Manager capabilities
  - Approve cards to publish to live feed
  - Reject/return cards with feedback
  - Change card status: In Review → Live or Returned
  - Final authority on card quality
- **Restrictions**:
  - Cannot manage users
  - Cannot access platform-wide analytics

### 5. Admin
- **Email**: admin@mingla.com
- **Password**: Mingla2025!
- **Access**: Admin Dashboard
- **Capabilities**:
  - All privileges of QA Managers and Content Managers
  - User management (add, edit, delete, change roles)
  - Platform-wide analytics and metrics
  - System configuration
  - Growth monitoring
- **Restrictions**: None (full access)

## Card Workflow

```
Curator Creates Card
        ↓
    [DRAFT STATUS]
        ↓
Curator Submits for Review
        ↓
  [IN REVIEW STATUS]
        ↓
Content Manager Edits & Improves
        ↓
Submit to QA Manager
        ↓
QA Manager Reviews
        ↓
    ┌───────────┴───────────┐
    ↓                       ↓
[APPROVED]            [RETURNED]
Publish to Live       Back to Curator
    ↓                  with Feedback
[LIVE STATUS]
Available to
All Users
```

## Status Definitions

- **Draft**: Card created but not submitted for review
- **In Review**: Card submitted and being reviewed by Content Managers
- **Live**: Card approved and published to user feed
- **Returned**: Card rejected with feedback for improvements

## Testing Instructions

### Sign In Flow
1. On the welcome screen, click "Sign In with Test Account"
2. Select your desired role (Explorer, Curator, Content Manager, QA Manager, or Admin)
3. Credentials are auto-populated - click "Sign In"
4. You'll be routed to the appropriate dashboard

### Role-Based Experiences

**Explorer**: Full mobile app experience with swipeable cards, social features, and collaboration

**Curator**: Desktop dashboard showing your created cards with metrics and status tracking

**Content Manager**: Review interface showing pending cards with editing tools and issue tracking

**QA Manager**: Approval interface with comparison views and publish/return actions

**Admin**: Platform overview with user management and analytics

## Key Features

### Curator Dashboard
- Card creation and management
- Status tracking (Draft, In Review, Live, Returned)
- Performance metrics (views, likes, saves)
- Feedback from Content Managers and QA
- Organization management

### Content Manager Dashboard
- Queue of cards pending review
- Side-by-side comparison (original vs edited)
- Issue tracking and resolution
- Feedback notes for QA Managers
- Priority management

### QA Manager Dashboard
- Final approval workflow
- Full editing capabilities
- Publish to live feed
- Return with detailed feedback
- Change tracking and history

### Admin Dashboard
- User management (CRUD operations)
- Role assignment
- Platform metrics and analytics
- Growth tracking
- System configuration

## Technical Implementation

### Files Created/Modified
1. `/components/SignInPage.tsx` - Updated with role selection and test credentials
2. `/components/CuratorDashboard.tsx` - New dashboard for curators
3. `/components/ContentManagerDashboard.tsx` - New dashboard for content managers
4. `/components/QAManagerDashboard.tsx` - New dashboard for QA managers
5. `/components/AdminDashboard.tsx` - New dashboard for admins
6. `/components/AppStateManager.tsx` - Updated to handle all user roles
7. `/App.tsx` - Updated with role-based routing

### State Management
- User role stored in localStorage: `mingla_user_role`
- Automatic role detection from email for test accounts
- Role-specific onboarding flows
- Internal roles (content-manager, qa-manager, admin) skip onboarding

### Permissions System
Each role has clearly defined capabilities enforced at the UI level:
- Explorers: Consumer experience
- Curators: Creator tools without publishing rights
- Content Managers: Editorial tools without publishing rights
- QA Managers: Full review and publishing authority
- Admins: Complete platform control

## Future Enhancements
- Card creation forms with rich media upload
- Real-time collaboration on card edits
- Advanced analytics dashboards
- Automated content moderation
- API integration for card submissions
- Webhook notifications for status changes
- Bulk operations for admins
- Detailed audit logs
