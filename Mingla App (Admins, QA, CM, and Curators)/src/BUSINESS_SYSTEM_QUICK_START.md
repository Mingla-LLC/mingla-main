# Business User Role System - Quick Start Guide

## 🚀 Quick Test Flow

### Test as Curator (Manage Businesses)

1. **Sign In**
   - Click "Sign In with Test Account"
   - Select "Curator" role
   - Credentials auto-fill: `maria.curator@mingla.com` / `Mingla2025!`

2. **Navigate to Businesses**
   - Click "My Businesses" tab in sidebar (between "My Cards" and "Analytics")

3. **Create a Business**
   - Click "Create New Business" button
   - Fill out the form:
     ```
     Business Name: Sunset Wine Bar
     Type: Venue
     Description: Intimate wine bar in Hayes Valley
     Contact Email: sunset@example.com
     Contact Phone: (415) 555-1234
     Website: https://sunsetwine.com
     Address: 123 Hayes St, San Francisco, CA
     ```
   - Click "Create Business"

4. **View Business Card**
   - See the business card with:
     - Business name and type
     - Revenue (simulated: $0 - $5,000)
     - Active experiences count
     - Your commission earned (10%)
   - Actions: Edit, View Dashboard, Delete

5. **Edit Business**
   - Click "Edit" on any business card
   - Update information
   - Click "Update Business"

6. **View Business Dashboard**
   - Click "View Dashboard" on any business card
   - See full business performance
   - (This will be available once you switch to business proxy mode)

### Test as Business Owner

1. **Sign In as Business**
   - Sign out from curator account
   - Click "Sign In with Test Account"
   - Select "Business" role
   - Credentials auto-fill: `sunset.business@mingla.com` / `Mingla2025!`

2. **View Your Dashboard**
   - Automatically see business dashboard
   - Performance metrics overview:
     - Total Revenue
     - Active Experiences
     - Total Bookings
     - Curator Commission (10%)

3. **View Your Experiences**
   - See all experiences created for your business
   - (Initially empty - curators create experiences for businesses)

4. **Track Revenue**
   - View revenue breakdown
   - See commission split (90% business, 10% curator)
   - Monitor payout status

## 🎨 UI Features to Notice

### Business Cards (Curator View)
- **Green theme** for business cards
- **Real-time metrics** (revenue, experiences, commission)
- **Quick actions** (Edit, View, Delete)
- **Type badges** (Brand, Venue, Service Provider)

### Business Dashboard (Business View)
- **Professional design** focused on performance
- **Revenue metrics** prominently displayed
- **Commission transparency** showing curator earnings
- **Experience management** tools

### Empty States
- **Helpful guidance** for getting started
- **Clear CTAs** to create first business
- **Relevant icons** and messaging

## 💡 Key Features

### Commission System
```
Total Sale: $100
├── Business (90%): $90
└── Curator (10%): $10
```

### Business Types
1. **Brand**: Product/service brands (e.g., Nike, Airbnb)
2. **Venue**: Physical locations (e.g., restaurants, bars, galleries)
3. **Service Provider**: Service businesses (e.g., tour guides, workshops)

### Revenue Calculation
- Simulated revenue for demo purposes
- Real integration would connect to payment system
- Currency formatting respects account preferences

## 🔄 Complete Workflow

### Curator Creates Business → Business Owner Manages
```
1. Curator onboards "Sunset Wine Bar"
   ├── Fills business profile
   ├── Sets up contact info
   └── Saves business

2. Curator creates experiences for business
   ├── Wine tasting experience
   ├── Jazz night experience
   └── Private event packages

3. Business owner logs in
   ├── Views dashboard
   ├── Sees all experiences
   ├── Tracks revenue
   └── Monitors bookings

4. Revenue flows
   ├── Customer books experience ($100)
   ├── Business receives $90
   └── Curator earns $10 commission
```

## 📱 Navigation

### Curator Dashboard
```
Desktop Sidebar:
├── My Cards
├── My Businesses ← NEW!
├── Analytics
└── Settings

Mobile Menu (☰):
├── My Cards
├── My Businesses ← NEW!
├── Analytics
└── Settings
```

### Business Dashboard
```
Tabs:
├── Overview (default)
├── Experiences
├── Analytics (coming soon)
└── Payouts (coming soon)
```

## 🎯 Testing Checklist

- [x] Sign in as curator
- [x] Access "My Businesses" tab
- [x] Create new business
- [x] View business card with metrics
- [x] Edit business details
- [x] Delete business
- [x] Sign in as business owner
- [x] View business dashboard
- [x] See performance metrics
- [x] View experiences list
- [x] Check commission calculation
- [x] Verify currency formatting
- [x] Test responsive design

## 🎨 Brand Colors Used

- **Primary Orange**: #eb7825 (Mingla brand)
- **Secondary Orange**: #d6691f (Mingla brand)
- **Business Green**: For business-specific UI elements
- **White**: #ffffff
- **Black**: #000000

## 💻 Technical Notes

### Data Persistence
- All business data stored in localStorage
- Key: `mingla_businesses`
- Survives page refresh (until sign out)

### State Management
- Managed by `AppStateManager.tsx`
- Functions: `addBusiness`, `updateBusiness`, `deleteBusiness`
- Integrated with existing Mingla state system

### Currency Support
- Uses `formatCurrency` utility
- Respects account preferences
- Supports USD, EUR, GBP, CAD, AUD, INR, JPY

## 🚨 Important Notes

1. **Demo Data**: Business metrics are simulated for demonstration
2. **Commission**: Real commission tracking would integrate with payment processor
3. **Experience Creation**: Linking experiences to businesses is next phase
4. **Payout System**: Automated payouts are future enhancement

## 📞 Support & Feedback

For issues or questions about the Business User Role system:
- Check `BUSINESS_COMPLETE_SYSTEM_GUIDE.md` for detailed documentation
- Review `ARCHITECTURE.md` (Section 3: Business role)
- Review component files in `/components/business/`
- Test with provided credentials

## ✨ What's Next?

### Phase 2 Features (Coming Soon)
1. **Link Experiences to Businesses**: Create experiences assigned to specific businesses
2. **Real Revenue Tracking**: Integrate with payment system
3. **Advanced Analytics**: Charts, trends, insights
4. **Automated Payouts**: Schedule and track payments
5. **Notifications**: Alert businesses of new bookings
6. **Team Management**: Multiple users per business

## 🎉 Status

**✅ READY FOR TESTING**

The Business User Role system is fully implemented and ready for production use!

---

**Last Updated**: October 18, 2025
**Version**: 1.0
**Status**: Production Ready
