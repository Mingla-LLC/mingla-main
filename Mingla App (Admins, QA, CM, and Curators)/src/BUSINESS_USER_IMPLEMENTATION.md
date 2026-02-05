# Mingla Business User Implementation
## Production-Ready Roadmap for Web & Mobile

---

## Table of Contents
1. [Overview](#overview)
2. [Technical Architecture](#technical-architecture)
3. [Implementation Epics](#implementation-epics)
4. [Platform-Specific Considerations](#platform-specific-considerations)
5. [Success Metrics](#success-metrics)
6. [Release Strategy](#release-strategy)

---

## Overview

This document outlines the comprehensive implementation plan for bringing Mingla's Business User experience to production-ready state across web and mobile platforms. The Business User is a core user type that creates and manages experience offerings on the Mingla platform, working in collaboration with Curators who earn commission from sales.

### Business User Value Proposition
- **For Businesses**: Direct channel to reach experience-seekers with minimal overhead
- **For Curators**: Ability to onboard and manage business partners, earning commission
- **For Explorers**: Access to high-quality, verified experiences from trusted businesses

### Brand Colors
- Primary: `#eb7825`
- Secondary: `#d6691f`
- Neutrals: White, Black

---

## Technical Architecture

### Platform Stack
- **Web**: React + TypeScript + Tailwind CSS v4.0
- **Mobile**: React Native + TypeScript (shared business logic with web)
- **Backend**: Supabase (Authentication, Database, Storage, Real-time)
- **Payments**: Multi-currency global payment system with regional payout support
- **KYC/Compliance**: Region-based verification system

### Shared Components Strategy
- Utilize maximum code sharing between web and mobile (~70-80%)
- Platform-specific UI components for native feel
- Shared business logic, state management, and API layers
- Unified design system with platform-appropriate adaptations

---

## Implementation Epics

### Epic 1: Business User Authentication & Onboarding
**Goal**: Seamless registration and onboarding for business users with proper verification

#### Story 1.1: Business Registration Flow
**As a** business owner  
**I want to** register my business on Mingla  
**So that** I can start offering experiences to users

**Acceptance Criteria**:
- [ ] Business signup form with company details (name, type, registration number, tax ID)
- [ ] Support for individual proprietors, LLCs, corporations, and other business types
- [ ] Email verification with branded confirmation emails
- [ ] Password requirements (min 8 chars, uppercase, lowercase, number, special char)
- [ ] Terms of Service and Business Partner Agreement acceptance
- [ ] Mobile-optimized form with auto-complete and validation
- [ ] Duplicate business detection based on tax ID/registration number
- [ ] Support for multi-location businesses

**Technical Notes**:
- Supabase Auth with custom business metadata
- Store business type, legal name, DBA, tax information securely
- Implement progressive disclosure for complex forms on mobile

---

#### Story 1.2: Business Profile Setup Wizard
**As a** newly registered business  
**I want to** complete my business profile  
**So that** curators and explorers can learn about my business

**Acceptance Criteria**:
- [ ] Multi-step wizard (4-6 steps) with progress indicator
- [ ] Step 1: Business Information (description, category, founding year, team size)
- [ ] Step 2: Contact & Location (address, phone, website, social media)
- [ ] Step 3: Media Assets (logo, cover image, photo gallery - min 3, max 15)
- [ ] Step 4: Business Verification (upload business license, insurance docs)
- [ ] Step 5: Operating Hours & Availability
- [ ] Step 6: Payment & Payout Setup (separate epic for details)
- [ ] Save progress and resume later functionality
- [ ] Mobile camera integration for document uploads
- [ ] Image cropping and optimization tools
- [ ] Preview mode before final submission

**Technical Notes**:
- Image upload to Supabase Storage with compression
- Max file sizes: 5MB per image, 10MB for documents
- Support multiple image formats (JPEG, PNG, WebP)
- Mobile native camera and gallery access

---

#### Story 1.3: Curator-Initiated Business Onboarding
**As a** curator  
**I want to** onboard a business partner  
**So that** I can create experiences on their behalf and earn commission

**Acceptance Criteria**:
- [ ] Curator can create business profile on behalf of business
- [ ] Curator sends invitation to business owner to claim account
- [ ] Business receives email/SMS with claim link
- [ ] Business can review curator-created profile and make edits
- [ ] Business can accept or modify commission structure
- [ ] Clear indication of "Pending Claim" vs "Verified Business" status
- [ ] Curator retains management rights until business claims account
- [ ] Option for business to grant continued curator management access
- [ ] Commission agreement signed by both parties

**Technical Notes**:
- Invitation token with expiration (7 days)
- Role-based permissions system
- Commission structure stored in junction table (curator_business_relationships)
- Email/SMS notification system

---

#### Story 1.4: Business Verification Process
**As a** platform administrator  
**I want to** verify business credentials  
**So that** we maintain platform quality and trust

**Acceptance Criteria**:
- [ ] Admin dashboard to review pending business applications
- [ ] Document verification checklist (license, insurance, tax ID)
- [ ] Manual review and approval/rejection workflow
- [ ] Automated checks where possible (tax ID validation, address verification)
- [ ] Rejection with feedback and resubmission flow
- [ ] Verification status badges (Pending, Verified, Rejected)
- [ ] Timeline expectation: 24-48 hours for verification
- [ ] Mobile notifications for verification status updates

**Technical Notes**:
- Admin portal with queue management
- Integration with third-party verification services (optional)
- Automated email notifications
- Verification status stored in business profile

---

### Epic 2: Business Profile Management
**Goal**: Complete business profile CRUD operations with rich media support

#### Story 2.1: Business Profile Display
**As an** explorer or curator  
**I want to** view detailed business profiles  
**So that** I can learn about businesses and their offerings

**Acceptance Criteria**:
- [ ] Public-facing business profile page with branded header (80px/96px logo)
- [ ] Business information section (description, category, location)
- [ ] Photo/video gallery with swipe navigation (mobile) and grid view (web)
- [ ] Operating hours display with current status (Open/Closed)
- [ ] Contact information (phone, email, website, social links)
- [ ] Experiences offered by this business (card grid)
- [ ] Reviews and ratings aggregation
- [ ] Business stats (experiences offered, total bookings, rating)
- [ ] Map integration showing business location
- [ ] Share functionality (social media, copy link)
- [ ] Responsive design: full-width on mobile, max-width container on desktop
- [ ] Skeleton loading states

**Technical Notes**:
- SEO-optimized with meta tags for social sharing
- Lazy loading for images
- Google Maps or Mapbox integration
- Cache business data for performance

---

#### Story 2.2: Business Profile Editing
**As a** business owner  
**I want to** update my business profile  
**So that** my information stays current

**Acceptance Criteria**:
- [ ] Edit mode toggle from view mode
- [ ] All profile fields editable except legal business name (requires admin)
- [ ] Real-time validation with inline error messages
- [ ] Autosave drafts every 30 seconds
- [ ] Discard changes confirmation
- [ ] Image upload, replace, delete, and reorder
- [ ] Operating hours builder with special hours for holidays
- [ ] Temporary closure announcements
- [ ] Change history log (audit trail)
- [ ] Mobile: bottom sheet for quick edits, full screen for major changes

**Technical Notes**:
- Optimistic UI updates
- Debounced autosave
- Version control for profile changes
- Image optimization on upload

---

#### Story 2.3: Multi-Location Business Management
**As a** business with multiple locations  
**I want to** manage all my locations from one account  
**So that** I can efficiently handle multi-location operations

**Acceptance Criteria**:
- [ ] Primary location + unlimited additional locations
- [ ] Each location has own address, hours, contact, and photos
- [ ] Location-specific experiences
- [ ] Location switcher in business dashboard
- [ ] Bulk operations across locations
- [ ] Location-specific analytics
- [ ] Assign staff/admins to specific locations
- [ ] Mobile: location selector with search and favorites

**Technical Notes**:
- Parent-child relationship in database (main_business_id)
- Location-based permissions
- Shared brand assets across locations
- Location indexing for search

---

### Epic 3: Experience Creation & Management
**Goal**: Comprehensive experience builder with flexible pricing and scheduling

#### Story 3.1: Experience Creation Wizard (Curator or Business)
**As a** business owner or curator  
**I want to** create an experience offering  
**So that** explorers can discover and book it

**Acceptance Criteria**:
- [ ] 4-step creation wizard matching existing card creator modal:
  - Step 1: Basic Info (name, categories, experience types, description)
  - Step 2: Route & Timeline (multi-stop or fixed location, duration, route steps)
  - Step 3: Packages & Availability (pricing model, purchase options, capacity, availability)
  - Step 4: Policies (cancellation, age restrictions, requirements, accessibility)
- [ ] Rich text editor for description with formatting
- [ ] Category multi-select from 10 categories (stroll, sipChill, casualEats, etc.)
- [ ] Experience type multi-select from 6 types (soloAdventure, romantic, friendly, etc.)
- [ ] Image gallery (min 3, max 15 photos) with drag-to-reorder
- [ ] Video upload support (optional, max 2 minutes)
- [ ] Route builder for multi-stop experiences with map integration
- [ ] Timeline builder for scheduling activities within experience
- [ ] Highlights/key features (bullet points, max 8)
- [ ] Save as draft functionality
- [ ] Preview mode before publishing
- [ ] Mobile: condensed wizard with collapsible sections

**Technical Notes**:
- Reuse existing CardCreatorModal logic from web
- Multi-stop detection based on selected categories
- Map integration for route planning
- Image compression and CDN delivery
- Draft autosave every 30 seconds

---

#### Story 3.2: Flexible Pricing Models
**As a** business owner  
**I want to** offer different pricing models  
**So that** I can accommodate various customer needs

**Acceptance Criteria**:
- [ ] Support 6 pricing models:
  - Per Person (e.g., $45/person, min 1, max 20)
  - Per Group (e.g., $200/group, max 8 people)
  - Tiered Packages (Standard/Premium/VIP with different inclusions)
  - Free with RSVP (capacity limited)
  - Deposit Only (pay deposit now, balance later)
  - Dynamic Pricing (varies by date/time/demand)
- [ ] Multiple purchase options per experience (e.g., Standard $75, Premium $125)
- [ ] Package builder with inclusions checklist
- [ ] Deposit amount configuration (fixed or percentage)
- [ ] Dynamic pricing rules builder (peak/off-peak, weekday/weekend)
- [ ] Currency selector (from global currency list)
- [ ] Group discount configuration
- [ ] Early bird pricing with date ranges
- [ ] Mobile: simplified pricing selector with expandable details

**Technical Notes**:
- Pricing stored in JSON structure for flexibility
- Currency conversion API for display purposes
- Pricing calculation engine for complex rules
- Tax configuration per location/region

---

#### Story 3.3: Availability & Capacity Management
**As a** business owner  
**I want to** control when experiences are available  
**So that** I don't get overbooked

**Acceptance Criteria**:
- [ ] Recurring availability schedule (daily, weekly, custom)
- [ ] Time slot builder (e.g., 9:00 AM, 2:00 PM, 6:00 PM)
- [ ] Capacity per time slot
- [ ] Blackout dates (holidays, maintenance, private events)
- [ ] Override availability for specific dates
- [ ] Real-time capacity tracking
- [ ] Waitlist when fully booked
- [ ] Buffer time between bookings
- [ ] Lead time requirements (book at least X hours/days in advance)
- [ ] Calendar view of availability (month view)
- [ ] Mobile: calendar picker with available/unavailable indicators

**Technical Notes**:
- Calendar integration (iCal export)
- Real-time booking count updates
- Optimistic locking to prevent double-booking
- Timezone handling for multi-region businesses

---

#### Story 3.4: Experience Publishing & Status Management
**As a** business owner  
**I want to** control the visibility of my experiences  
**So that** I can manage when they appear to customers

**Acceptance Criteria**:
- [ ] Experience status states: Draft, Pending Review, Published, Paused, Archived
- [ ] Publish/unpublish toggle
- [ ] Pause bookings temporarily (keeps page visible but prevents new bookings)
- [ ] Archive old experiences (hidden from main listings but accessible via direct link)
- [ ] Scheduled publishing (go live on specific date/time)
- [ ] Bulk status changes for multiple experiences
- [ ] Admin review required for first 3 experiences (quality control)
- [ ] Notification when experience is approved/rejected
- [ ] Mobile: quick status toggle in experience list

**Technical Notes**:
- Status workflow state machine
- Scheduled task runner for timed publishing
- Admin review queue
- Search index updates on status change

---

#### Story 3.5: Experience Duplication & Templates
**As a** business owner  
**I want to** duplicate existing experiences  
**So that** I can quickly create similar offerings

**Acceptance Criteria**:
- [ ] "Duplicate" action on any experience
- [ ] Creates copy with "(Copy)" appended to name
- [ ] All content copied except booking-specific data
- [ ] Duplicate opens in edit mode
- [ ] Template library for common experience types
- [ ] Save own experiences as private templates
- [ ] Template sharing between business locations
- [ ] Mobile: duplicate option in experience menu

**Technical Notes**:
- Deep copy of experience data
- Reset status to Draft on duplication
- Template storage separate from live experiences
- Performance optimization for large templates

---

### Epic 4: Financial Management & Payments
**Goal**: Complete payment processing, commission tracking, and payout system

#### Story 4.1: Payment Method Setup
**As a** business owner  
**I want to** configure my payment acceptance  
**So that** I can receive payments from customers

**Acceptance Criteria**:
- [ ] Multiple payment method support:
  - Credit/Debit Cards (Visa, Mastercard, Amex, Discover)
  - Digital Wallets (Apple Pay, Google Pay, PayPal)
  - Bank Transfers (ACH, SEPA, local methods by region)
  - Buy Now Pay Later (Klarna, Affirm, Afterpay)
- [ ] Payment gateway integration (Stripe recommended)
- [ ] PCI compliance (hosted payment fields, no direct card handling)
- [ ] Supported currency configuration per business location
- [ ] Payment method fees transparency
- [ ] Test mode for payment setup
- [ ] Mobile: native payment sheet integration (Apple Pay, Google Pay)

**Technical Notes**:
- Stripe Connect for marketplace model
- PCI-DSS Level 1 compliance
- 3D Secure (SCA) for EU customers
- Webhook handling for payment events

---

#### Story 4.2: Payout Configuration & KYC
**As a** business owner  
**I want to** set up my payout account  
**So that** I can receive earnings from bookings

**Acceptance Criteria**:
- [ ] Region-based payout onboarding flow:
  - US: Bank account (routing + account number) or debit card
  - EU: SEPA bank account (IBAN + BIC)
  - UK: UK bank account (sort code + account number)
  - Other regions: Local bank transfer details
- [ ] KYC verification (ID upload, proof of address, business documents)
- [ ] Beneficial ownership disclosure (for corporations)
- [ ] Tax form collection (W-9 for US, W-8BEN for international)
- [ ] Payout schedule selection (daily, weekly, bi-weekly, monthly)
- [ ] Minimum payout threshold configuration
- [ ] Multiple payout destinations (split payments)
- [ ] KYC status indicators (Pending, Under Review, Verified, Action Required)
- [ ] Mobile: document scanning with OCR

**Technical Notes**:
- Stripe Connect Express for simplified KYC
- Secure document storage with encryption
- Compliance with local regulations (GDPR, CCPA)
- Manual review queue for flagged accounts

---

#### Story 4.3: Commission Structure Management
**As a** business owner or curator  
**I want to** define commission agreements  
**So that** curator partnerships are clear and fair

**Acceptance Criteria**:
- [ ] Flexible commission models:
  - Percentage of sale (e.g., 15% to curator)
  - Fixed fee per booking (e.g., $10 per booking)
  - Tiered percentage (volume-based, e.g., 15% first 10, 12% next 10)
  - Hybrid (base fee + percentage)
- [ ] Commission rate negotiation workflow:
  - Curator proposes rate
  - Business accepts/counters/rejects
  - Both parties sign agreement
- [ ] Commission rate varies by experience type or category
- [ ] Commission cap (max per booking or per month)
- [ ] Retroactive commission adjustments (with approval)
- [ ] Commission holds for refunds/chargebacks
- [ ] Commission reporting and transparency
- [ ] Mobile: commission calculator for negotiation

**Technical Notes**:
- Commission calculation engine
- Digital signature for agreements (DocuSign or similar)
- Commission tracking table with audit trail
- Escrow period before payout (14-30 days)

---

#### Story 4.4: Transaction History & Reconciliation
**As a** business owner  
**I want to** view all my financial transactions  
**So that** I can track revenue and reconcile accounts

**Acceptance Criteria**:
- [ ] Comprehensive transaction list with filters:
  - Date range selector
  - Transaction type (booking, refund, commission, payout, fee)
  - Status (pending, completed, failed, refunded)
  - Currency
  - Customer name/ID
  - Experience
- [ ] Transaction details modal:
  - Full breakdown (booking amount, platform fee, commission, net amount)
  - Customer information
  - Payment method
  - Timestamps
  - Related documents (receipt, invoice)
- [ ] Export to CSV/Excel/PDF
- [ ] Search by transaction ID, customer name, or booking ID
- [ ] Real-time balance display (available, pending, reserved)
- [ ] Transaction timeline visualization
- [ ] Mobile: swipe for quick filters, tap for details

**Technical Notes**:
- Pagination for large transaction lists (100 per page)
- Transaction caching for performance
- Export job queue for large datasets
- Real-time updates via WebSocket

---

#### Story 4.5: Fee Transparency & Breakdown
**As a** business owner  
**I want to** understand all fees charged  
**So that** I can price my experiences appropriately

**Acceptance Criteria**:
- [ ] Clear fee structure display:
  - Mingla platform fee (percentage + fixed, varies by region)
  - Payment processing fee (Stripe/PayPal fees)
  - Curator commission (if applicable)
  - Currency conversion fee (if applicable)
  - Chargeback fee (if applicable)
- [ ] Fee calculator tool:
  - Input experience price
  - See breakdown of all fees
  - Calculate net payout amount
- [ ] Fee schedule page (public and business-facing)
- [ ] Fee change notifications (30 days advance notice)
- [ ] Volume-based fee discounts (high-volume businesses)
- [ ] Mobile: simple fee calculator widget

**Technical Notes**:
- Fee structure stored in database (configurable)
- Fee calculation logic centralized
- Historical fee tracking for legacy transactions
- A/B testing different fee structures

---

#### Story 4.6: Refund & Cancellation Processing
**As a** business owner  
**I want to** process refunds and cancellations  
**So that** I can handle customer service issues

**Acceptance Criteria**:
- [ ] Full refund, partial refund, or no refund options
- [ ] Refund reason selection (customer request, business cancellation, weather, etc.)
- [ ] Automatic refund based on cancellation policy
- [ ] Manual refund override (with reason)
- [ ] Refund approval workflow for high amounts (>$500)
- [ ] Refund processing time display (5-10 business days)
- [ ] Commission reversal on refund (curator notified)
- [ ] Refund history and reporting
- [ ] Customer notification on refund initiation and completion
- [ ] Dispute resolution workflow
- [ ] Mobile: quick refund with preset amounts

**Technical Notes**:
- Stripe refund API integration
- Partial refund calculation (prorated)
- Chargeback handling and representation
- Refund reconciliation in payout reports

---

### Epic 5: Business Dashboard & Analytics
**Goal**: Comprehensive dashboard for business management and insights

#### Story 5.1: Business Dashboard Homepage
**As a** business owner  
**I want to** see an overview of my business performance  
**So that** I can make informed decisions

**Acceptance Criteria**:
- [ ] Left-aligned Mingla logo (80px desktop, 96px mobile) with brand colors
- [ ] Modern white container layout with consistent spacing
- [ ] Key metrics at a glance:
  - Today's bookings (count + revenue)
  - This week's bookings (count + revenue)
  - This month's bookings (count + revenue)
  - Total revenue (all time)
  - Active experiences count
  - Average rating
  - Total reviews
- [ ] Revenue trend chart (line chart, last 30/90/365 days)
- [ ] Upcoming bookings list (next 7 days)
- [ ] Recent customer reviews
- [ ] Quick actions (Create Experience, View Bookings, Manage Profile)
- [ ] Notification center (new bookings, reviews, messages)
- [ ] Performance compared to previous period (% change indicators)
- [ ] Mobile: scrollable cards with swipe navigation

**Technical Notes**:
- Real-time data updates
- Chart library: Recharts (web), Victory Native (mobile)
- Skeleton loaders for async data
- Dashboard data caching (5-minute TTL)

---

#### Story 5.2: Booking Management Dashboard
**As a** business owner  
**I want to** manage all my bookings in one place  
**So that** I can efficiently handle customer reservations

**Acceptance Criteria**:
- [ ] Booking list with multiple views:
  - List view (table format on web, cards on mobile)
  - Calendar view (day/week/month)
  - Timeline view (hourly slots)
- [ ] Booking filters:
  - Date range
  - Status (upcoming, completed, cancelled, no-show)
  - Experience
  - Location (for multi-location)
  - Payment status (paid, pending, refunded)
- [ ] Booking search by customer name, booking ID, or email
- [ ] Booking details panel:
  - Customer information (name, contact, party size)
  - Experience details
  - Date, time, duration
  - Payment breakdown
  - Special requests/notes
  - Check-in status
- [ ] Booking actions:
  - Confirm booking
  - Cancel booking (with refund options)
  - Reschedule booking
  - Mark as no-show
  - Check-in customer
  - Message customer
  - Export booking details
- [ ] Bulk actions (confirm multiple, export selected)
- [ ] Booking reminders (email/SMS to customer 24 hours before)
- [ ] Mobile: swipe gestures for quick actions, expandable booking cards

**Technical Notes**:
- Real-time booking updates
- Calendar integration (Google Calendar sync)
- SMS/email notification system
- Export to PDF for printing daily manifest

---

#### Story 5.3: Analytics & Reporting
**As a** business owner  
**I want to** access detailed analytics  
**So that** I can optimize my offerings

**Acceptance Criteria**:
- [ ] Revenue analytics:
  - Revenue over time (daily, weekly, monthly, yearly)
  - Revenue by experience
  - Revenue by customer segment
  - Revenue by channel (direct, curator, organic)
  - Average booking value
  - Revenue forecasting (based on current booking rate)
- [ ] Booking analytics:
  - Booking volume over time
  - Booking conversion rate (views to bookings)
  - Booking lead time (how far in advance)
  - Peak booking times/days
  - Cancellation rate
  - No-show rate
- [ ] Experience performance:
  - Most popular experiences
  - Highest-rated experiences
  - Lowest-performing experiences (low bookings or ratings)
  - Capacity utilization rate
  - Price elasticity analysis
- [ ] Customer insights:
  - New vs returning customers
  - Customer demographics (if collected)
  - Customer lifetime value
  - Customer acquisition cost
  - Top customers by spend
- [ ] Curator performance (if working with curators):
  - Bookings by curator
  - Revenue by curator
  - Commission paid by curator
  - Top-performing curators
- [ ] Exportable reports (PDF, CSV, Excel)
- [ ] Scheduled reports (email daily/weekly/monthly digest)
- [ ] Custom date range selection
- [ ] Comparison mode (compare two time periods)
- [ ] Mobile: simplified analytics with key metrics, charts optimized for small screens

**Technical Notes**:
- Data warehouse for analytics (BigQuery or Snowflake)
- Pre-aggregated metrics for performance
- Chart library with responsive design
- Report generation job queue
- Analytics data retention policy (2-3 years)

---

#### Story 5.4: Review & Rating Management
**As a** business owner  
**I want to** monitor and respond to customer reviews  
**So that** I can maintain my reputation

**Acceptance Criteria**:
- [ ] Review list with filters (rating, date, experience, responded/unresponded)
- [ ] Review details display:
  - Customer name (or anonymous)
  - Rating (1-5 stars)
  - Written review
  - Experience reviewed
  - Booking date
  - Review date
  - Photos uploaded by customer (if any)
- [ ] Respond to reviews (public response visible to all)
- [ ] Flag inappropriate reviews (for admin moderation)
- [ ] Review reminders (request review from customers post-experience)
- [ ] Aggregate rating display (overall + per experience)
- [ ] Review response templates for common scenarios
- [ ] Review statistics:
  - Average rating over time
  - Rating distribution (5-star, 4-star, etc.)
  - Review volume over time
  - Response rate
- [ ] Mobile: swipe to respond, tap to expand review

**Technical Notes**:
- Review moderation queue
- Profanity filter for reviews
- Review authenticity checks (verified purchase)
- SEO-friendly review markup (schema.org)

---

#### Story 5.5: Customer Management (CRM Lite)
**As a** business owner  
**I want to** manage customer relationships  
**So that** I can provide better service and drive repeat business

**Acceptance Criteria**:
- [ ] Customer list with search and filters
- [ ] Customer profile:
  - Contact information
  - Booking history
  - Total spend
  - Favorite experiences
  - Notes/tags
  - Communication history
  - Special requests/preferences
- [ ] Customer segmentation:
  - VIP customers (high spend)
  - Frequent customers (multiple bookings)
  - At-risk customers (haven't booked in 6+ months)
  - New customers (first booking in last 30 days)
- [ ] Bulk messaging to customer segments (email/SMS)
- [ ] Customer tags and notes
- [ ] Customer export (CSV with consent compliance)
- [ ] Mobile: quick customer lookup, tap-to-call/email

**Technical Notes**:
- GDPR/CCPA compliance (data export, deletion requests)
- Email marketing integration (Mailchimp, SendGrid)
- SMS platform integration (Twilio)
- Customer data encryption

---

### Epic 6: Curator-Business Collaboration
**Goal**: Seamless workflow between curators and businesses

#### Story 6.1: Curator Partnership Dashboard
**As a** business owner  
**I want to** manage my curator partnerships  
**So that** I can track performance and optimize collaborations

**Acceptance Criteria**:
- [ ] List of all curator partners
- [ ] Curator performance metrics:
  - Total bookings generated
  - Total revenue generated
  - Commission paid
  - Conversion rate (curator shares to bookings)
  - Active experiences created
- [ ] Curator permissions management:
  - Can create experiences on behalf of business
  - Can edit business profile
  - Can manage bookings
  - Can view financials
  - Can message customers
- [ ] Invite new curators (send invitation link)
- [ ] Remove curator partnership (with notice period)
- [ ] Commission structure per curator (can vary)
- [ ] Curator communication thread
- [ ] Mobile: curator cards with quick actions

**Technical Notes**:
- Role-based access control (RBAC)
- Curator invitation token system
- Commission calculation per curator
- Partnership agreement document storage

---

#### Story 6.2: Experience Co-Management
**As a** curator or business owner  
**I want to** collaboratively manage experiences  
**So that** we can leverage each other's strengths

**Acceptance Criteria**:
- [ ] Clear ownership indicator on each experience (Created by: Curator/Business)
- [ ] Edit permissions based on partnership agreement
- [ ] Activity log showing who made what changes
- [ ] Comment thread on experience drafts for collaboration
- [ ] Approval workflow:
  - Curator creates draft
  - Business reviews and approves/requests changes
  - Experience goes live after approval
- [ ] Version history (see previous versions, revert changes)
- [ ] Conflict resolution (if both edit simultaneously)
- [ ] Curator can request business to add certain details
- [ ] Mobile: collaborative editing with real-time sync

**Technical Notes**:
- Operational transformation for real-time collaboration
- Change tracking and diffing
- WebSocket for real-time updates
- Notification system for approval requests

---

#### Story 6.3: Commission Reporting & Transparency
**As a** business owner or curator  
**I want to** view detailed commission breakdowns  
**So that** there's full transparency in our partnership

**Acceptance Criteria**:
- [ ] Commission dashboard with filters (date range, curator, experience)
- [ ] Commission details per booking:
  - Booking amount
  - Commission rate applied
  - Commission amount
  - Payment status (pending, paid, held)
- [ ] Commission summary:
  - Total commission earned (curator view)
  - Total commission paid (business view)
  - Pending commission
  - Next payout date
- [ ] Commission payout history
- [ ] Dispute commission charge (with justification)
- [ ] Commission adjustment requests (for errors)
- [ ] Export commission reports (for taxes)
- [ ] Mobile: simplified commission view with totals

**Technical Notes**:
- Commission calculation verification
- Dispute resolution workflow
- Tax document generation (1099 for US curators)
- Commission escrow period (14-30 days)

---

### Epic 7: Communication & Notifications
**Goal**: Keep businesses informed and enable customer communication

#### Story 7.1: In-App Messaging System
**As a** business owner  
**I want to** message customers directly  
**So that** I can provide excellent customer service

**Acceptance Criteria**:
- [ ] Messaging inbox (similar to email client)
- [ ] Message threads per booking/customer
- [ ] Send messages to individual customers
- [ ] Automated messages:
  - Booking confirmation
  - Booking reminder (24 hours before)
  - Post-experience thank you + review request
  - Cancellation confirmation
  - Refund notification
- [ ] Message templates for common scenarios
- [ ] Attach files/images to messages
- [ ] Read receipts (if customer has read)
- [ ] Typing indicators (real-time)
- [ ] Message search and filters
- [ ] Unread message count badge
- [ ] Mobile: native push notifications, chat-style UI

**Technical Notes**:
- Real-time messaging via WebSocket
- Message storage in database
- Push notification service (FCM, APNs)
- File upload to cloud storage
- Profanity filter and spam detection

---

#### Story 7.2: Notification Preferences
**As a** business owner  
**I want to** control what notifications I receive  
**So that** I'm not overwhelmed but stay informed

**Acceptance Criteria**:
- [ ] Notification settings page with categories:
  - Bookings (new, confirmed, cancelled)
  - Payments (received, refunded, payout sent)
  - Reviews (new review, review response)
  - Messages (new customer message)
  - Business (profile updates, verification status)
  - Curator activity (new experience created, edit request)
  - Marketing (Mingla updates, tips, promotions)
- [ ] Notification channels per category:
  - In-app notifications
  - Email
  - SMS (for critical notifications)
  - Push notifications (mobile)
- [ ] Quiet hours (no non-critical notifications during set hours)
- [ ] Notification frequency (instant, hourly digest, daily digest)
- [ ] Mobile: granular notification settings per app section

**Technical Notes**:
- Notification preference storage
- Notification delivery service with scheduling
- SMS rate limiting to avoid spam
- Email unsubscribe links (CAN-SPAM compliance)

---

#### Story 7.3: Multi-User Account Management
**As a** business owner  
**I want to** add team members to my account  
**So that** we can manage the business together

**Acceptance Criteria**:
- [ ] Add team members by email invitation
- [ ] Role assignment:
  - Owner (full access, cannot be removed)
  - Admin (full access except billing)
  - Manager (manage experiences, bookings, customers)
  - Staff (view-only, can check in customers)
- [ ] Custom role creation with granular permissions
- [ ] Team member list with status (Active, Pending, Deactivated)
- [ ] Remove team members
- [ ] Activity log per team member (who did what)
- [ ] Email notifications to team members based on role
- [ ] Mobile: team management with role selector

**Technical Notes**:
- Multi-tenancy support
- Permission matrix stored in database
- Team invitation token system
- Audit log for all team actions

---

### Epic 8: Settings & Compliance
**Goal**: Complete settings management and legal compliance

#### Story 8.1: Business Settings
**As a** business owner  
**I want to** configure my business settings  
**So that** the platform works how I need it to

**Acceptance Criteria**:
- [ ] General settings:
  - Business name and legal name
  - Business category and subcategories
  - Time zone
  - Language preference
  - Currency preference (for display)
- [ ] Operational settings:
  - Default cancellation policy
  - Default booking lead time
  - Default capacity limits
  - Booking confirmation mode (auto vs manual)
  - Customer data collection (what info to request)
- [ ] Notification settings (see Story 7.2)
- [ ] Integration settings:
  - Google Calendar sync
  - Social media connections
  - Zapier/API webhooks
- [ ] Branding settings:
  - Custom colors (if premium)
  - Custom domain (if premium)
  - Custom email templates
- [ ] Mobile: settings organized in sections

**Technical Notes**:
- Settings stored in JSONB for flexibility
- Settings validation
- Settings migration for schema changes
- Webhook delivery with retry logic

---

#### Story 8.2: Privacy & Data Management
**As a** business owner  
**I want to** manage customer data responsibly  
**So that** I comply with privacy regulations

**Acceptance Criteria**:
- [ ] Privacy policy display and acceptance
- [ ] Data retention policy configuration
- [ ] Customer data export (GDPR Article 15)
- [ ] Customer data deletion (GDPR Article 17 - Right to be Forgotten)
- [ ] Data processing agreement (DPA) with Mingla
- [ ] Cookie consent management
- [ ] Third-party data sharing controls
- [ ] Data breach notification workflow
- [ ] Customer consent management:
  - Marketing communications consent
  - Data sharing consent
  - Review posting consent
- [ ] Mobile: privacy settings in account section

**Technical Notes**:
- GDPR compliance framework
- CCPA compliance (California residents)
- Data anonymization for deleted accounts
- Consent logging with timestamps
- Regular compliance audits

---

#### Story 8.3: Tax & Compliance Reporting
**As a** business owner  
**I want to** access tax-related documents  
**So that** I can file taxes accurately

**Acceptance Criteria**:
- [ ] Tax document center:
  - 1099-K (US merchants with $600+ revenue)
  - Sales tax reports (by jurisdiction)
  - Revenue summary by tax year
  - Expense reports (platform fees, commissions)
- [ ] Tax ID management (EIN, VAT number, GST registration)
- [ ] Sales tax collection configuration:
  - Auto-calculate tax based on customer location
  - Manual tax rate entry
  - Tax-exempt experiences
- [ ] Tax remittance tracking (if Mingla collects and remits)
- [ ] Export tax documents (PDF, CSV)
- [ ] Tax form submission (W-9, W-8BEN)
- [ ] Mobile: view and download tax documents

**Technical Notes**:
- Integration with tax calculation APIs (Avalara, TaxJar)
- Tax document generation job (runs annually)
- Secure document storage
- IRS/tax authority filing automation (if applicable)

---

#### Story 8.4: Accessibility Compliance
**As a** business owner  
**I want to** ensure my profile is accessible  
**So that** all customers can book experiences

**Acceptance Criteria**:
- [ ] Accessibility information per experience:
  - Wheelchair accessible
  - Accessible restrooms
  - Hearing assistance available
  - Visual assistance available
  - Service animals allowed
  - Mobility limitations
  - Age restrictions
  - Physical fitness requirements
- [ ] Accessibility filters for explorers
- [ ] Accessibility statement on business profile
- [ ] WCAG 2.1 AA compliance for business dashboard (web)
- [ ] Screen reader testing and optimization
- [ ] Keyboard navigation support (no mouse required)
- [ ] Mobile: accessibility settings in iOS/Android system preferences

**Technical Notes**:
- ARIA labels on all interactive elements
- Color contrast compliance (4.5:1 minimum)
- Focus management for modals and forms
- Alt text for all images
- Semantic HTML structure

---

### Epic 9: Mobile-Specific Features
**Goal**: Native mobile features that enhance the business user experience

#### Story 9.1: Mobile Dashboard & Quick Actions
**As a** business owner on mobile  
**I want to** quickly access key features  
**So that** I can manage my business on the go

**Acceptance Criteria**:
- [ ] Home screen widget (iOS 14+, Android 12+):
  - Today's bookings count
  - Today's revenue
  - Quick action buttons (View Bookings, Create Experience)
- [ ] 3D Touch / Long Press shortcuts (iOS / Android):
  - New Booking
  - View Today's Schedule
  - Check Messages
  - Quick Settings
- [ ] Swipe gestures for common actions:
  - Swipe left to cancel booking
  - Swipe right to confirm booking
  - Pull to refresh
- [ ] Biometric authentication (Face ID, Touch ID, Fingerprint)
- [ ] Offline mode with sync:
  - View cached bookings
  - Queue actions when offline
  - Sync when back online
- [ ] Dark mode support

**Technical Notes**:
- React Native home screen widget library
- iOS App Clip / Android Instant App for quick access
- AsyncStorage for offline caching
- Background sync service
- System dark mode detection

---

#### Story 9.2: Mobile Camera & Media Integration
**As a** business owner on mobile  
**I want to** easily capture and upload media  
**So that** I can showcase my business

**Acceptance Criteria**:
- [ ] Camera integration:
  - Take photo directly in app
  - Multiple photos in one session
  - Front/back camera toggle
  - Flash control
  - Grid lines for composition
- [ ] Photo editing tools:
  - Crop and rotate
  - Brightness and contrast
  - Filters (optional)
  - Text overlay
- [ ] Video recording (max 2 minutes)
- [ ] Gallery picker with multi-select
- [ ] Image compression before upload (reduce file size)
- [ ] Upload progress indicator
- [ ] Batch upload (select multiple, upload together)
- [ ] Photo metadata (geolocation, timestamp) optional inclusion

**Technical Notes**:
- React Native Camera library
- Image picker with permissions handling
- Image compression library (reduce to max 2MB)
- Upload to Supabase Storage with resumable uploads
- Thumbnail generation for faster loading

---

#### Story 9.3: Mobile Geolocation & Check-in
**As a** business owner on mobile  
**I want to** use location features  
**So that** I can manage on-site operations

**Acceptance Criteria**:
- [ ] GPS-based check-in for customers:
  - Verify customer is at location (geofence)
  - One-tap check-in button
  - Automatic check-in when customer arrives (optional)
  - QR code alternative for check-in
- [ ] Staff location tracking (opt-in):
  - See which staff are at which location
  - Location-based task assignment
- [ ] Nearby customer notifications:
  - Alert when customer is approaching
  - Send directions to customer
- [ ] Map view of business locations
- [ ] Location-based services discovery (for multi-location businesses)

**Technical Notes**:
- React Native Geolocation API
- Geofencing with background location updates
- Privacy controls for location tracking
- QR code generation per booking
- Apple Maps / Google Maps integration

---

#### Story 9.4: Mobile Push Notifications & Rich Media
**As a** business owner on mobile  
**I want to** receive rich push notifications  
**So that** I can stay informed with context

**Acceptance Criteria**:
- [ ] Rich push notifications:
  - Notification with image (customer photo, experience image)
  - Action buttons (Confirm, Decline, Reply)
  - Notification grouping (stack related notifications)
  - Expanded view with full details
- [ ] Notification categories:
  - Booking notifications (with customer name, time)
  - Payment notifications (with amount)
  - Review notifications (with star rating preview)
  - Message notifications (with message preview)
- [ ] Notification sounds (custom per category, optional)
- [ ] Notification LED color (Android)
- [ ] Badge count on app icon
- [ ] Notification history (view dismissed notifications)
- [ ] Do Not Disturb mode integration

**Technical Notes**:
- Firebase Cloud Messaging (FCM) for both iOS and Android
- APNs for iOS-specific features
- Notification service worker for background handling
- Deep linking from notifications
- A/B testing notification copy for engagement

---

### Epic 10: Advanced Features & Optimization
**Goal**: Production-ready polish and advanced capabilities

#### Story 10.1: Performance Optimization
**As a** business owner  
**I want to** have a fast, responsive platform  
**So that** I can work efficiently

**Acceptance Criteria**:
- [ ] Web performance targets:
  - First Contentful Paint (FCP) < 1.5s
  - Largest Contentful Paint (LCP) < 2.5s
  - Cumulative Layout Shift (CLS) < 0.1
  - Time to Interactive (TTI) < 3.5s
- [ ] Mobile performance targets:
  - App launch time < 2s
  - Screen transition time < 300ms
  - API response rendering < 500ms
- [ ] Image optimization:
  - Lazy loading for images below fold
  - WebP format with JPEG/PNG fallback
  - Responsive images (different sizes for different screens)
  - CDN delivery (CloudFlare, Fastly)
- [ ] Code splitting and lazy loading (React.lazy)
- [ ] Database query optimization:
  - Indexed queries
  - Connection pooling
  - Query result caching
- [ ] Mobile-specific optimizations:
  - Reduced bundle size (tree shaking)
  - Native module for heavy computations
  - List virtualization for long lists

**Technical Notes**:
- Lighthouse CI in build pipeline
- Bundle analyzer to identify bloat
- Database query profiling (pg_stat_statements)
- React Profiler for component optimization
- Mobile performance monitoring (Firebase Performance)

---

#### Story 10.2: Search Engine Optimization (SEO)
**As a** business owner  
**I want to** my experiences to be discoverable via search  
**So that** I can attract more customers organically

**Acceptance Criteria**:
- [ ] SEO-optimized experience pages:
  - Unique meta titles (50-60 chars)
  - Compelling meta descriptions (150-160 chars)
  - Open Graph tags for social sharing
  - Schema.org markup (LocalBusiness, Event)
  - Canonical URLs
  - XML sitemap generation
- [ ] SEO-friendly URLs (slugs):
  - `/business/san-francisco-chocolate-workshop`
  - `/experience/sunset-kayaking-tour-sf`
- [ ] Image alt text (auto-suggested, editable)
- [ ] Page speed optimization (see Story 10.1)
- [ ] Mobile-first indexing compliance
- [ ] Structured data for rich snippets:
  - Star ratings
  - Price range
  - Availability
  - Reviews
- [ ] robots.txt and sitemap.xml
- [ ] Internal linking strategy

**Technical Notes**:
- Next.js for server-side rendering (SSR) or static site generation (SSG)
- Google Search Console integration
- Bing Webmaster Tools
- Regular SEO audits with Screaming Frog or Ahrefs
- Core Web Vitals monitoring

---

#### Story 10.3: A/B Testing & Experimentation
**As a** platform administrator  
**I want to** run A/B tests  
**So that** we can optimize the business user experience

**Acceptance Criteria**:
- [ ] A/B testing framework:
  - Test different pricing displays
  - Test different CTA button copy
  - Test different onboarding flows
  - Test different dashboard layouts
- [ ] Experiment tracking:
  - Variant assignment (50/50, 70/30, etc.)
  - Conversion tracking per variant
  - Statistical significance calculation
  - Automatic winner selection
- [ ] Gradual rollout (feature flags):
  - Enable feature for 10% of users
  - Monitor metrics
  - Increase to 50%, then 100%
- [ ] Rollback mechanism for failed experiments
- [ ] User consent for experiments (if collecting data)

**Technical Notes**:
- LaunchDarkly, Optimizely, or custom feature flag system
- Analytics integration (track experiment events)
- Statistical significance library (Chi-square test)
- Experiment results dashboard

---

#### Story 10.4: Multi-Language Support (i18n)
**As a** business owner in a non-English market  
**I want to** use the platform in my language  
**So that** I can work comfortably

**Acceptance Criteria**:
- [ ] Initial language support:
  - English (en-US)
  - Spanish (es-ES, es-MX)
  - French (fr-FR)
  - German (de-DE)
  - Portuguese (pt-BR)
  - Mandarin (zh-CN)
  - Japanese (ja-JP)
- [ ] Language selector in settings
- [ ] All UI text translated (buttons, labels, messages, errors)
- [ ] Date, time, and number formatting per locale
- [ ] Currency display per locale
- [ ] Right-to-left (RTL) support for Arabic, Hebrew (future)
- [ ] Business content translation:
  - Auto-translate with Google Translate API (optional)
  - Manual translation input
  - Multi-language experience descriptions
- [ ] Language detection from browser/device settings
- [ ] Mobile: system language detection

**Technical Notes**:
- i18next library for React (web and mobile)
- Translation files in JSON format
- Namespace organization for large translation sets
- Translation management platform (Lokalise, Crowdin)
- Pseudo-localization for testing
- String externalization (no hardcoded strings)

---

#### Story 10.5: Error Handling & Recovery
**As a** business owner  
**I want to** gracefully handle errors  
**So that** I'm not stuck when something goes wrong

**Acceptance Criteria**:
- [ ] Error boundary components (catch React errors)
- [ ] Friendly error messages (no technical jargon)
- [ ] Error recovery suggestions:
  - Retry action
  - Contact support
  - Return to previous screen
  - Clear cache
- [ ] Offline detection:
  - Show offline banner
  - Queue actions for when back online
  - Disable online-only features
- [ ] Form validation with inline errors
- [ ] Network timeout handling (retry with exponential backoff)
- [ ] Payment error handling (decline codes with user-friendly messages)
- [ ] Error logging and monitoring:
  - Sentry or Bugsnag integration
  - Error grouping and prioritization
  - User context (what they were doing)
- [ ] Mobile: crash reporting (Firebase Crashlytics)

**Technical Notes**:
- React Error Boundary component
- Axios interceptors for network errors
- Retry logic with exponential backoff
- Error tracking service (Sentry)
- Source maps for debugging production errors

---

#### Story 10.6: Onboarding Tutorials & Help
**As a** new business owner  
**I want to** learn how to use the platform  
**So that** I can get started quickly

**Acceptance Criteria**:
- [ ] Interactive onboarding tour (first-time users):
  - Welcome screen with video overview (1-2 minutes)
  - Step-by-step walkthrough of key features
  - "Create Your First Experience" guided flow
  - Tips and best practices
  - Skip tour option
- [ ] Contextual help tooltips:
  - Hover/tap on (?) icon for explanation
  - Tooltips on complex form fields
  - "Learn more" links to help docs
- [ ] Help center:
  - Searchable knowledge base
  - Video tutorials
  - FAQ section
  - Contact support
- [ ] In-app chat support (live chat or chatbot):
  - Business hours support
  - AI chatbot for common questions
  - Escalation to human agent
- [ ] Mobile: tutorial videos, in-app help search

**Technical Notes**:
- Onboarding library (Intro.js, react-joyride)
- Help content in CMS (Contentful, Strapi)
- Video hosting (YouTube, Vimeo)
- Live chat integration (Intercom, Drift, Crisp)
- Chatbot with NLP (Dialogflow, Rasa)

---

## Platform-Specific Considerations

### Web Platform
- **Responsive Design**: Mobile-first approach, works on phones, tablets, desktops
- **Browser Support**: Chrome, Firefox, Safari, Edge (last 2 versions)
- **Progressive Web App (PWA)**: Installable on desktop/mobile, offline support, push notifications
- **Accessibility**: WCAG 2.1 AA compliance, keyboard navigation, screen reader optimization
- **SEO**: Server-side rendering (SSR) or static generation for public pages
- **Performance**: Code splitting, lazy loading, image optimization, CDN delivery

### Mobile Platform (React Native)
- **iOS Support**: iOS 13+ (95% of active devices as of 2024)
- **Android Support**: Android 8+ (API level 26+, 90% of active devices)
- **Native Modules**: Camera, geolocation, biometrics, push notifications
- **Offline First**: Local data persistence, background sync, queue management
- **App Store Compliance**: Privacy policies, permissions, in-app purchases (if applicable)
- **Performance**: Native list optimization, image caching, minimal re-renders
- **Testing**: Detox for E2E testing, Jest for unit testing

### Shared Considerations
- **State Management**: Redux or Zustand for complex state, React Context for simpler cases
- **API Communication**: REST or GraphQL, consistent error handling
- **Authentication**: Supabase Auth with JWT tokens, refresh token rotation
- **Real-time Updates**: WebSocket (Supabase Realtime) for booking updates, messages
- **File Uploads**: Direct upload to Supabase Storage, progress tracking
- **Monitoring**: Error tracking (Sentry), analytics (Mixpanel, Amplitude), performance (Lighthouse, Firebase)

---

## Success Metrics

### Business User Success Metrics
- **Onboarding Completion Rate**: % of registered businesses that complete profile setup (Target: >80%)
- **Time to First Experience**: Days from signup to first experience published (Target: <3 days)
- **Active Business Rate**: % of businesses with at least 1 booking in last 30 days (Target: >60%)
- **Experience Creation Rate**: Avg experiences created per business (Target: >5)
- **Booking Acceptance Rate**: % of bookings confirmed by business (Target: >95%)
- **Response Time**: Avg time to respond to customer messages (Target: <2 hours)
- **Customer Satisfaction**: Avg rating from customers (Target: >4.5/5)
- **Retention Rate**: % of businesses still active after 6 months (Target: >70%)

### Platform Health Metrics
- **Uptime**: Platform availability (Target: >99.9%)
- **API Response Time**: p95 response time (Target: <500ms)
- **Error Rate**: % of requests that result in errors (Target: <0.1%)
- **Payment Success Rate**: % of payment attempts that succeed (Target: >98%)
- **Page Load Time**: p75 load time for key pages (Target: <2s)
- **Mobile Crash Rate**: % of app sessions that crash (Target: <0.5%)

### Revenue Metrics
- **GMV (Gross Merchandise Value)**: Total booking value processed (Growth target: +20% MoM)
- **Take Rate**: Platform fee as % of GMV (Target: 10-15%)
- **ARPU (Average Revenue Per User)**: Revenue per active business (Target: $500+/month)
- **Churn Rate**: % of businesses that stop using platform (Target: <5%/month)
- **Customer Acquisition Cost (CAC)**: Cost to acquire one business (Target: <$200)
- **Lifetime Value (LTV)**: Revenue per business over lifetime (Target: >$5,000)

---

## Release Strategy

### Phase 1: MVP (Months 1-3)
**Goal**: Core business user functionality for early adopters

**Epics Included**:
- Epic 1: Business User Authentication & Onboarding (Stories 1.1, 1.2, 1.4)
- Epic 2: Business Profile Management (Stories 2.1, 2.2)
- Epic 3: Experience Creation & Management (Stories 3.1, 3.2, 3.3, 3.4)
- Epic 5: Business Dashboard & Analytics (Stories 5.1, 5.2 basic)
- Epic 7: Communication & Notifications (Story 7.1 basic)

**Target Users**: 10-20 pilot businesses  
**Success Criteria**: 
- 80% onboarding completion
- 50+ experiences created
- 100+ bookings processed
- <5 critical bugs

---

### Phase 2: Curator Integration (Months 4-5)
**Goal**: Enable curator-business collaboration

**Epics Included**:
- Epic 1: Business User Authentication & Onboarding (Story 1.3)
- Epic 4: Financial Management & Payments (Stories 4.1, 4.2, 4.3, 4.4)
- Epic 6: Curator-Business Collaboration (All stories)
- Epic 5: Business Dashboard & Analytics (Story 5.3 basic)

**Target Users**: 50 businesses + 20 curators  
**Success Criteria**: 
- 30+ curator-business partnerships
- $10,000+ GMV processed
- Commission system working correctly
- <10 support tickets per week

---

### Phase 3: Financial & Analytics (Months 6-7)
**Goal**: Complete financial system and analytics

**Epics Included**:
- Epic 4: Financial Management & Payments (Stories 4.5, 4.6)
- Epic 5: Business Dashboard & Analytics (Stories 5.3, 5.4, 5.5 complete)
- Epic 8: Settings & Compliance (Stories 8.1, 8.2, 8.3)

**Target Users**: 100 businesses  
**Success Criteria**: 
- $50,000+ GMV processed
- <1% payment failure rate
- 90% payout success rate
- All tax documents generated correctly

---

### Phase 4: Mobile Launch (Months 8-9)
**Goal**: Native mobile apps for iOS and Android

**Epics Included**:
- Epic 9: Mobile-Specific Features (All stories)
- Mobile versions of all Phase 1-3 features
- App store submission and approval

**Target Users**: 200 businesses (50% on mobile)  
**Success Criteria**: 
- App Store approval (iOS and Android)
- 4.5+ star rating in app stores
- 60% of businesses use mobile app
- <1% crash rate

---

### Phase 5: Advanced Features (Months 10-12)
**Goal**: Production polish and advanced capabilities

**Epics Included**:
- Epic 2: Business Profile Management (Story 2.3 - Multi-location)
- Epic 3: Experience Creation & Management (Story 3.5 - Templates)
- Epic 7: Communication & Notifications (Stories 7.2, 7.3)
- Epic 8: Settings & Compliance (Story 8.4 - Accessibility)
- Epic 10: Advanced Features & Optimization (All stories)

**Target Users**: 500+ businesses  
**Success Criteria**: 
- 99.9% uptime
- <2s page load time (p75)
- WCAG 2.1 AA compliance
- Multi-language support (5+ languages)

---

### Phase 6: Scale & Optimize (Ongoing)
**Goal**: Continuous improvement and scale

**Focus Areas**:
- Performance optimization based on real usage
- A/B testing for conversion optimization
- New payment methods and regions
- Advanced analytics and AI features
- Partner integrations (accounting, CRM, etc.)
- Expansion to new markets and languages

**Success Criteria**: 
- 1,000+ active businesses
- $1M+ GMV per month
- 99.95% uptime
- <0.5% churn rate

---

## Technical Dependencies & Integrations

### Core Infrastructure
- **Supabase**: Database (PostgreSQL), Authentication, Storage, Real-time subscriptions
- **Stripe Connect**: Payment processing, KYC/verification, payouts, tax forms
- **Sendgrid/AWS SES**: Transactional emails (booking confirmations, notifications)
- **Twilio**: SMS notifications (booking reminders, verification codes)
- **Cloudflare/Fastly**: CDN for media assets, DDoS protection

### Third-Party Services
- **Google Maps API**: Geocoding, map display, route planning
- **Google Places API**: Business address autocomplete
- **Cloudinary**: Image optimization and transformations
- **Sentry**: Error tracking and monitoring
- **Mixpanel/Amplitude**: Product analytics
- **Intercom/Crisp**: Customer support chat
- **DocuSign**: Digital signature for contracts
- **Avalara/TaxJar**: Sales tax calculation

### Development Tools
- **GitHub/GitLab**: Version control, CI/CD pipelines
- **Vercel/Netlify**: Web app hosting and deployment
- **Expo/EAS**: React Native build and deployment
- **Jest**: Unit testing
- **Cypress/Detox**: End-to-end testing
- **Storybook**: Component library and documentation
- **ESLint/Prettier**: Code linting and formatting

---

## Security & Compliance Checklist

### Data Security
- [ ] All data encrypted at rest (AES-256)
- [ ] All data encrypted in transit (TLS 1.3)
- [ ] Password hashing with bcrypt (cost factor 12+)
- [ ] JWT tokens with short expiration (15 min access, 7 day refresh)
- [ ] Secure session management with httpOnly cookies
- [ ] Rate limiting on all API endpoints
- [ ] CSRF protection on state-changing operations
- [ ] XSS prevention (input sanitization, CSP headers)
- [ ] SQL injection prevention (parameterized queries only)
- [ ] Regular security audits and penetration testing

### Privacy & Compliance
- [ ] GDPR compliance (EU users)
- [ ] CCPA compliance (California users)
- [ ] Privacy policy clearly displayed
- [ ] Terms of service acceptance required
- [ ] Cookie consent management
- [ ] Data retention policy enforced
- [ ] Right to access (data export)
- [ ] Right to deletion (account deletion)
- [ ] Right to portability (standard export format)
- [ ] Data breach notification procedure (within 72 hours)

### Financial Compliance
- [ ] PCI-DSS Level 1 compliance (via Stripe)
- [ ] KYC/AML verification for high-risk accounts
- [ ] Tax form collection and distribution (1099-K, W-9, W-8BEN)
- [ ] Sales tax collection and remittance (where required)
- [ ] Financial record retention (7 years)
- [ ] Fraud detection and prevention
- [ ] Chargeback dispute process
- [ ] Payout failure handling

### Accessibility Compliance
- [ ] WCAG 2.1 AA compliance
- [ ] Screen reader testing (NVDA, JAWS, VoiceOver)
- [ ] Keyboard navigation (no mouse required)
- [ ] Color contrast ratios (4.5:1 minimum)
- [ ] Focus indicators on all interactive elements
- [ ] Skip navigation links
- [ ] ARIA labels and landmarks
- [ ] Form labels and error messages
- [ ] Video captions and transcripts

---

## Support & Documentation

### Business User Documentation
- **Getting Started Guide**: Step-by-step onboarding
- **Experience Creation Guide**: Best practices for experiences
- **Pricing Strategy Guide**: How to price competitively
- **Photography Guide**: Tips for great experience photos
- **Customer Service Guide**: Handling bookings and messages
- **Analytics Guide**: Understanding your metrics
- **Troubleshooting Guide**: Common issues and solutions

### Technical Documentation
- **API Documentation**: Complete API reference
- **Webhook Documentation**: Event types and payloads
- **Integration Guide**: Connecting third-party tools
- **Database Schema**: Entity-relationship diagrams
- **Security Best Practices**: For business owners and developers
- **Mobile App Guide**: Features and usage

### Support Channels
- **Help Center**: Searchable knowledge base (help.mingla.com)
- **Video Tutorials**: YouTube channel with how-to videos
- **Live Chat**: Business hours support (M-F 9am-6pm)
- **Email Support**: support@mingla.com (24-hour response time)
- **Community Forum**: Peer-to-peer support and feature requests
- **Developer Discord**: For technical integrations

---

## Glossary

- **Explorer**: End user who discovers and books experiences
- **Curator**: User who onboards businesses and creates experiences on their behalf, earning commission
- **Business User**: Business owner or staff managing experiences and bookings
- **Experience**: A bookable activity or service offered by a business
- **GMV (Gross Merchandise Value)**: Total value of all bookings processed
- **Take Rate**: Platform fee as a percentage of GMV
- **Commission**: Percentage paid to curator for bookings they generate
- **KYC (Know Your Customer)**: Identity verification process
- **Payout**: Transfer of funds from Mingla to business bank account
- **Chargeback**: Disputed transaction reversed by customer's bank
- **Multi-Stop Experience**: Experience with multiple locations in a sequence

---

## Change Log

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-12-17 | Initial comprehensive documentation | Mingla Team |

---

## Approval & Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Product Owner | ___________ | ___________ | ______ |
| Technical Lead | ___________ | ___________ | ______ |
| Design Lead | ___________ | ___________ | ______ |
| Business Stakeholder | ___________ | ___________ | ______ |

---

**Document Status**: Draft  
**Last Updated**: December 17, 2025  
**Next Review**: January 15, 2026

---

*This document is confidential and proprietary to Mingla. Unauthorized distribution is prohibited.*
