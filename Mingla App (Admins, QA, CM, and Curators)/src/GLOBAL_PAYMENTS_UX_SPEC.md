# Mingla Global Payments System - UX Specification

## Document Overview

**Version**: 1.0  
**Date**: October 19, 2025  
**Status**: Production Ready  
**Authors**: Mingla Product Team  

This document specifies the complete user experience for Mingla's global payments system, including multi-currency support, transparent fee breakdowns, KYC onboarding, and regional compliance.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Core User Flows](#core-user-flows)
3. [Component Specifications](#component-specifications)
4. [Financial Transparency](#financial-transparency)
5. [Regional Rules & Compliance](#regional-rules--compliance)
6. [Currency Management](#currency-management)
7. [Edge Cases & Error States](#edge-cases--error-states)
8. [Microcopy & Education](#microcopy--education)
9. [Technical Requirements](#technical-requirements)
10. [Testing Checklist](#testing-checklist)

---

## System Overview

### Purpose

Enable Mingla curators to receive payments globally with:
- Multi-currency support (8+ currencies)
- Multiple payment processors
- Transparent fee breakdowns
- Regulatory compliance (KYC/tax)
- Escrow protection
- Regional optimization

### Supported Regions

| Region | Currency | Payment Methods | Processing Time | Special Notes |
|--------|----------|----------------|-----------------|---------------|
| United States | USD | ACH, Stripe, PayPal | 3-5 days | W-9 required |
| European Union | EUR | SEPA, SOFORT | 1-3 days | VAT may apply |
| United Kingdom | GBP | Faster Payments | Same day | Post-Brexit rules |
| Canada | CAD | EFT, Stripe | 3-5 days | Similar to US |
| Australia | AUD | BPAY, Stripe | 3-5 days | GST compliance |
| Brazil | BRL | PIX | Instant | CPF/CNPJ required |
| Japan | JPY | Bank Transfer | 2-3 days | My Number required |
| India | INR | NEFT/RTGS, UPI | 1-2 days | PAN required |

### Key Principles

1. **Transparency First**: Every fee explained with tooltips
2. **Education**: Inline help for complex topics
3. **Regional Awareness**: Show relevant info per country
4. **Progressive Disclosure**: Don't overwhelm, reveal as needed
5. **Trust Building**: Security badges, encryption notices

---

## Core User Flows

### 1. New Curator Payout Setup

**Trigger**: First login OR accessing earnings before setup complete

```
Step 1: Welcome Screen
├─ Brand message about global reach
├─ What they'll need (ID, tax form, bank details)
├─ Time estimate (5 minutes)
└─ [Start Setup] button

Step 2: Country & Currency Selection
├─ Country dropdown with flags
├─ Currency auto-populated (locked warning)
├─ Regional info panel (processing times, minimums)
└─ [Continue] button

Step 3: Payment Method Selection
├─ Available methods per country (cards)
│  ├─ Bank Transfer (free, slower)
│  ├─ Stripe (paid, faster)
│  ├─ PayPal (paid, instant)
│  └─ Local processor (varies)
├─ Instant payout toggle (premium, +3% fee)
└─ [Continue] button

Step 4: KYC & Tax Information
├─ Identity verification section
│  ├─ Full legal name input
│  ├─ Government ID upload
│  └─ Address verification
├─ Tax information section
│  ├─ Tax ID input (format per country)
│  ├─ Tax form upload (W-9/W-8BEN/etc)
│  └─ Tax residency confirmation
└─ [Continue] button

Step 5: Review & Confirm
├─ Summary of all selections
├─ Verification status indicators
├─ Next steps explanation
├─ Security reassurance
└─ [Complete Setup] button
  └─ Success state
     ├─ Verification timeline
     ├─ What happens next
     └─ [Go to Dashboard] button
```

**Success Criteria**:
- All required fields completed
- Documents uploaded successfully
- User understands verification timeline
- Clear next steps provided

**Error Handling**:
- Missing fields highlighted in red
- Inline validation messages
- Option to save as draft
- Support link prominently placed

---

### 2. Viewing Earnings Dashboard

**Entry Point**: Curator Dashboard → Earnings tab

```
Dashboard Layout
├─ Earnings Summary Cards (4 across)
│  ├─ Lifetime Earnings
│  │  ├─ Large number display
│  │  ├─ Toggle: Original/Converted currency
│  │  └─ Growth indicator
│  ├─ Pending Payout
│  │  ├─ Amount ready
│  │  ├─ Next payout date
│  │  └─ Status: "Processing on..."
│  ├─ In Escrow
│  │  ├─ Amount held
│  │  ├─ Reason tooltip
│  │  └─ Release timeline
│  └─ This Month
│     ├─ Current period earnings
│     ├─ % change vs last month
│     └─ Trend indicator
├─ Currency Display Control
│  ├─ Current payout currency badge
│  ├─ Currency dropdown selector
│  ├─ Real-time conversion indicator
│  └─ Currency lock warning
├─ Transactions List
│  ├─ Header with filters
│  │  ├─ Date range selector
│  │  ├─ Status filter
│  │  └─ Export button
│  └─ Transaction cards (expandable)
│     ├─ Collapsed state
│     │  ├─ Experience name
│     │  ├─ Business name
│     │  ├─ Date
│     │  ├─ Net payout amount
│     │  ├─ Status icon
│     │  └─ Expand chevron
│     └─ Expanded state
│        ├─ Fee Breakdown section
│        │  ├─ Gross sale
│        │  ├─ Platform fee (% badge)
│        │  ├─ Subtotal
│        │  ├─ Curator commission (% badge)
│        │  ├─ Payment processor fee
│        │  ├─ Conversion fee (if applicable)
│        │  ├─ FX rate info
│        │  └─ Net payout (highlighted)
│        ├─ Payment Timeline
│        │  ├─ 4-step progress indicator
│        │  ├─ Current status highlighted
│        │  └─ Estimated completion
│        └─ Regional Info banner (if international)
└─ Regional Compliance Panel
   ├─ Escrow period explanation
   ├─ Processing time info
   ├─ Minimum payout threshold
   └─ Tax reporting requirements
```

**Interaction States**:
- **Hover**: Border color change, subtle shadow
- **Click to Expand**: Smooth height animation
- **Loading**: Skeleton screens for async data
- **Empty State**: Helpful illustration + CTA

---

### 3. Transaction Fee Breakdown

**Purpose**: Complete transparency on where money goes

```
Fee Breakdown Display (per transaction)

Visual Flow:
Gross Sale Amount
      ↓ (minus)
Platform Fee (15%)
      ↓ (equals)
Subtotal for Business & Curator
      ↓ (split)
├─ Business Receives (65%)
└─ Curator Commission (20%)
      ↓ (minus)
Payment Processor Fee (2.9%)
      ↓ (minus, if applicable)
Currency Conversion Fee (1-2%)
      ↓ (equals)
NET PAYOUT TO CURATOR

Each line item includes:
- Amount in clear typography
- Percentage badge (if applicable)
- Tooltip icon (hover for details)
- Color coding:
  - Red: Deductions
  - Green: Additions
  - Gray: Neutral info
  - Orange: Final payout
```

**Tooltip Content Examples**:

**Platform Fee**:
```
Platform Fee (15%)
━━━━━━━━━━━━━━━
This fee covers:
• Payment processing
• Customer support
• Platform maintenance
• Fraud protection
• Marketing & discovery

Standard across all transactions.
```

**Curator Commission**:
```
Your Commission (20%)
━━━━━━━━━━━━━━━━━
Set during business partnership.

• Negotiated with business
• Can be adjusted quarterly
• Typical range: 10-30%
• View agreement details →
```

**Conversion Fee**:
```
Currency Conversion (1.2%)
━━━━━━━━━━━━━━━━━━━━━
Applied when currencies differ.

From: USD (business currency)
To: EUR (your payout currency)
Rate: 1 USD = 0.92 EUR
Fee: Charged by payment provider

Updated: Oct 18, 2025 3:45 PM
```

---

### 4. Payment Timeline Visualization

**Design**: Horizontal stepper with 4 stages

```
Visual Design:
━━━━━━●━━━━━━●━━━━━━●━━━━━━●
  Sale    Validation  Escrow   Payout
   ✓          ✓         ⏱        ○

States:
✓ Completed (green circle with checkmark)
⏱ In Progress (blue circle with clock)
○ Pending (gray circle)

Below each step:
- Step name
- Date/time if completed
- Estimated time if pending
```

**Stage Definitions**:

1. **Sale** (Completed immediately)
   - Customer purchases experience
   - Payment processed
   - Receipt sent

2. **Validation** (Completed after experience)
   - Curator scans QR code
   - Experience confirmed delivered
   - No disputes filed

3. **Escrow** (3 days post-experience)
   - Funds held for dispute period
   - Customer can request refund
   - Release date shown
   - **Microcopy**: "Held for quality assurance"

4. **Payout** (Monthly or on-demand)
   - Funds released to curator
   - Sent via chosen method
   - Receipt emailed
   - **Microcopy**: "Sent to your account"

**Educational Banner** (shown on first view):
```
┌─────────────────────────────────────────┐
│ ℹ️  Why the wait?                        │
│                                          │
│ We hold funds briefly to ensure:        │
│ • Quality experiences                   │
│ • Dispute resolution                    │
│ • Fraud protection                      │
│                                          │
│ Standard practice for marketplaces      │
│ [Learn More] [Got It]                   │
└─────────────────────────────────────────┘
```

---

### 5. Currency Selection & Locking

**Critical UX**: Currency lock after first payout

```
Currency Selection Interface

Before First Payout:
┌─────────────────────────────────────┐
│ 🌍 Payout Currency                  │
│                                     │
│ [USD ($) ▼]                         │
│                                     │
│ ⚠️  IMPORTANT                        │
│ Your currency will be LOCKED after  │
│ your first payout. Choose carefully.│
│                                     │
│ Why? Prevents tax complications and │
│ regulatory issues.                  │
│                                     │
│ [Learn More About Currency Lock]    │
└─────────────────────────────────────┘

After First Payout:
┌─────────────────────────────────────┐
│ 🌍 Payout Currency                  │
│                                     │
│ EUR (€) 🔒 LOCKED                   │
│                                     │
│ ℹ️  Your currency is locked          │
│                                     │
│ To change currency, contact support.│
│ Note: May require new verification  │
│ and affect tax reporting.           │
│                                     │
│ [Contact Support]                   │
└─────────────────────────────────────┘
```

**Warning Dialog** (when attempting to change after first selection):
```
┌────────────────────────────────────────┐
│     ⚠️  Confirm Currency Change         │
│                                        │
│ You're changing from USD to EUR        │
│                                        │
│ This will affect:                      │
│ • How you see all earnings            │
│ • Conversion fees on future payouts   │
│ • Tax reporting requirements          │
│                                        │
│ After your first payout, this         │
│ CANNOT BE CHANGED without contacting  │
│ support.                               │
│                                        │
│ Are you sure?                         │
│                                        │
│ [Cancel] [Yes, Change Currency]       │
└────────────────────────────────────────┘
```

---

## Component Specifications

### PayoutOnboardingFlow.tsx

**File**: `/components/PayoutOnboardingFlow.tsx`

**Purpose**: Multi-step modal for setting up global payouts

**Props**:
```typescript
interface PayoutOnboardingFlowProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (data: PayoutSetupData) => void;
  existingData?: Partial<PayoutSetupData>;
}

interface PayoutSetupData {
  country: string;          // ISO country code
  currency: string;         // ISO currency code
  payoutMethod: 'bank' | 'stripe' | 'paypal' | 'local';
  instantPayouts: boolean;  // Premium feature
  kycStatus: 'pending' | 'verified' | 'rejected';
  taxFormType: string;      // W9, W8BEN, etc.
  taxFormUploaded: boolean;
  bankDetails?: BankDetails;
  verificationDocuments?: File[];
}
```

**Visual Specifications**:
- **Size**: Max-width 640px, responsive
- **Animation**: Slide in from bottom on mobile, fade in on desktop
- **Progress**: Step indicator at top (5 dots)
- **Colors**: Mingla brand gradient for active steps
- **Typography**: System font stack, clear hierarchy
- **Spacing**: 24px padding, 16px between elements

**Validation Rules**:
- Country required before proceeding
- Currency auto-populates based on country
- Payment method must be available in selected country
- Tax form type auto-selected based on residency
- All documents must be under 10MB
- Supported formats: PDF, JPG, PNG

**Accessibility**:
- Keyboard navigation (Tab, Enter, Escape)
- ARIA labels on all interactive elements
- Focus management between steps
- Screen reader announcements for step changes
- High contrast mode support

---

### PayoutsSystemEnhanced.tsx

**File**: `/components/PayoutsSystemEnhanced.tsx`

**Purpose**: Main earnings dashboard with multi-currency support

**Key Sections**:

1. **Summary Cards** (4 across, responsive)
   - Background: Subtle gradients
   - Numbers: Large, bold
   - Icons: Contextual (TrendingUp, Clock, Lock, Calendar)
   - Hover: Subtle lift effect

2. **Currency Display Control**
   - Dropdown: Current currency selected
   - Toggle: Show original vs converted
   - Lock icon: If currency locked
   - Tooltip: Explanation of lock

3. **Transaction List**
   - Accordion pattern: Click to expand
   - Status icons: Color-coded
   - Animations: Smooth height transitions
   - Skeleton loading: While fetching data

4. **Regional Info Panel**
   - Background: Light blue (informational)
   - Icon: Info circle
   - Bullet points: Key regional rules
   - Link: "Learn more about your region"

**State Management**:
```typescript
const [selectedCurrency, setSelectedCurrency] = useState('USD');
const [showInOriginalCurrency, setShowInOriginalCurrency] = useState(false);
const [expandedTransaction, setExpandedTransaction] = useState<string | null>(null);
const [activeTimeframe, setActiveTimeframe] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
```

**Data Flow**:
```
1. Component mounts
2. Check if payout setup complete
   ├─ If NO: Show PayoutOnboardingFlow
   └─ If YES: Fetch earnings data
3. Display summary cards
4. Load transactions list
5. Handle user interactions
   ├─ Currency change: Recalculate all amounts
   ├─ Timeframe change: Refetch data
   └─ Transaction expand: Show breakdown
```

---

### BusinessManagementModal.tsx (Enhancements)

**New Additions**:

1. **Currency Alignment Alert**
```tsx
{business.currency !== curator.currency && (
  <Alert variant="warning">
    <AlertCircle className="w-4 h-4" />
    <AlertTitle>Currency Mismatch</AlertTitle>
    <AlertDescription>
      This business operates in {business.currency}, but your payout 
      currency is {curator.currency}. Conversion fees will apply to 
      all transactions.
      
      Estimated fee: 1-2% per transaction
      [View Fee Calculator]
    </AlertDescription>
  </Alert>
)}
```

2. **Regional Compliance Checklist**
```tsx
<div className="compliance-checklist">
  <h4>Regional Requirements</h4>
  <ul>
    <li className={kycStatus === 'verified' ? 'complete' : 'pending'}>
      <CheckCircle /> Identity Verification (KYC)
    </li>
    <li className={taxFormStatus === 'approved' ? 'complete' : 'pending'}>
      <FileText /> Tax Documentation
    </li>
    <li className={bankVerified ? 'complete' : 'pending'}>
      <Building /> Bank Account Verification
    </li>
  </ul>
</div>
```

3. **Commission Transparency Table**
```
Sale: $100.00
  ↓
Platform Fee (15%): -$15.00
  ↓
Available: $85.00
  ↓ (split 80/20)
├─ Business: $68.00 (80%)
└─ Curator: $17.00 (20%)
  ↓ (fees)
Payment Fee: -$0.49 (2.9%)
Conversion Fee: -$0.26 (1.5%)
  ↓
NET PAYOUT: $16.25

[Pass Platform Fee to Customer] ☐
If enabled, customer pays $115 instead.
```

---

## Financial Transparency

### Fee Structure

**Platform Fee**: 15% of gross sale
- Applied to ALL transactions
- Covers platform operations
- Non-negotiable
- Can be passed to customer

**Curator Commission**: 10-30% of net (after platform fee)
- Negotiated per business partnership
- Set during onboarding
- Can be renegotiated quarterly
- Subject to business approval

**Payment Processor Fee**: Varies by method
- Bank Transfer: Free
- Stripe: 2.9% + $0.30
- PayPal: 2.9% + $0.30
- Local processors: 1-3%

**Currency Conversion Fee**: 1-2%
- Applied when currencies differ
- Charged by payment provider
- Real-time exchange rate
- Rate locked at transaction time

**Example Calculation** (with tooltips):

```
Scenario: $100 experience sale
Curator currency: EUR
Business currency: USD
Commission rate: 20%
FX Rate: 1 USD = 0.92 EUR

Breakdown:
Gross Sale: $100.00 USD
  ↓ [Tooltip: Total paid by customer]
  
Platform Fee: -$15.00 (15%)
  ↓ [Tooltip: Platform operations fee]
  
Subtotal: $85.00
  ↓ [Tooltip: Split between business & curator]
  
Curator Commission: +$17.00 (20% of $85)
  ↓ [Tooltip: Your share from this sale]
  
Payment Processor: -$0.49 (2.9% of $17)
  ↓ [Tooltip: Stripe transaction fee]
  
Convert USD→EUR: $16.51 → €15.19
  ↓ [Tooltip: Exchange rate applied]
  
Conversion Fee: -€0.23 (1.5%)
  ↓ [Tooltip: FX fee by payment provider]
  
NET PAYOUT: €14.96 EUR
  ↓ [Tooltip: Final amount to your account]
```

### Visual Representation

**Color Coding**:
- 🟢 Green: Additions (commission, bonuses)
- 🔴 Red: Deductions (fees, taxes)
- ⚫ Gray: Neutral (subtotals, conversions)
- 🟠 Orange: Final payout (highlighted)

**Typography**:
- Large numbers: 24px, bold
- Labels: 14px, regular
- Percentages: 12px, badge format
- Tooltips: 13px, regular

---

## Regional Rules & Compliance

### Payout Delays by Region

| Region | Domestic | International | Reason |
|--------|----------|---------------|--------|
| US | 3-5 days | 7-10 days | ACH vs SWIFT |
| EU | 1-3 days | 5-7 days | SEPA vs International |
| UK | Same day | 3-5 days | Faster Payments |
| BR | Instant | 5-7 days | PIX domestic only |
| IN | 1-2 days | 7-10 days | NEFT/RTGS limits |
| JP | 2-3 days | 5-10 days | Bank processing |
| AU | 3-5 days | 7-10 days | BPAY delays |
| CA | 3-5 days | 7-10 days | EFT processing |

**User-Facing Copy**:
```
ℹ️ Your Region: United States
Processing Time: 3-5 business days
International transfers: +2-5 days

Payouts sent on the 1st of each month.
Next payout: November 1, 2025
```

### Tax Handling by Country

**United States**:
- Form W-9 required (citizens/residents)
- Form W-8BEN for non-residents
- 1099-K issued if earnings > $600/year
- Backup withholding if no TIN provided

**European Union**:
- VAT registration may be required
- Varies by country (reverse charge)
- Annual reporting to tax authorities
- MOSS scheme for multi-country

**United Kingdom**:
- Self-assessment tax return
- National Insurance considerations
- Post-Brexit rules apply
- UTR number required

**Brazil**:
- CPF (individual) or CNPJ (business)
- Monthly tax reporting (DARF)
- IOF tax on international transactions

**India**:
- PAN card mandatory
- TDS may apply (10-30%)
- GST registration if revenue > threshold
- Form 15CA/15CB for international

**Japan**:
- My Number required
- Income tax withholding
- Consumption tax considerations

**Australia**:
- TFN or ABN required
- GST applies if > $75k revenue
- PAYG withholding rules

**Canada**:
- SIN or BN required
- Similar to US (T4A forms)
- Provincial tax considerations

**User-Facing Display**:
```
┌─────────────────────────────────────┐
│ 📋 Tax Information for United States│
│                                     │
│ Required: Form W-9                  │
│ Status: ✅ Submitted                 │
│                                     │
│ Annual Reporting:                   │
│ • 1099-K issued if you earn $600+   │
│ • Sent by January 31st              │
│ • Report on Schedule C              │
│                                     │
│ [View Tax Guide] [Update Info]      │
└─────────────────────────────────────┘
```

### Escrow Rules

**Standard Escrow Period**: 3 days post-experience

**Purpose**:
1. Quality assurance
2. Dispute resolution window
3. Fraud prevention
4. Chargeback protection

**Regional Variations**:
- US: 3 days
- EU: 14 days (consumer protection laws)
- UK: 14 days (Distance Selling Regulations)
- BR: 7 days (consumer protection code)
- Other: 3-7 days

**Display Logic**:
```typescript
const getEscrowPeriod = (country: string, experienceType: string) => {
  const basePeriod = {
    'US': 3,
    'EU': 14,
    'UK': 14,
    'BR': 7,
    'default': 3
  }[country] || 3;
  
  // High-value experiences get longer escrow
  if (saleAmount > 500) return basePeriod + 2;
  
  return basePeriod;
};
```

**User Communication**:
```
⏱️ Escrow Period: 3 days

Your $68.00 from "Wine Tasting" is held 
until Oct 21 for quality assurance.

Why? This protects both you and customers:
• Ensures experience was delivered
• Allows time for any issues
• Prevents chargebacks

Funds auto-release after escrow period.
[Learn More]
```

---

## Currency Management

### Supported Currencies

```typescript
const SUPPORTED_CURRENCIES = {
  'USD': { symbol: '$', name: 'US Dollar', regions: ['US', 'Global'] },
  'EUR': { symbol: '€', name: 'Euro', regions: ['EU', 'Global'] },
  'GBP': { symbol: '£', name: 'British Pound', regions: ['UK', 'Global'] },
  'AUD': { symbol: 'A$', name: 'Australian Dollar', regions: ['AU', 'NZ'] },
  'CAD': { symbol: 'C$', name: 'Canadian Dollar', regions: ['CA'] },
  'BRL': { symbol: 'R$', name: 'Brazilian Real', regions: ['BR'] },
  'JPY': { symbol: '¥', name: 'Japanese Yen', regions: ['JP'] },
  'INR': { symbol: '₹', name: 'Indian Rupee', regions: ['IN'] },
};
```

### Currency Conversion

**Real-Time Rates**:
- Fetched from payment provider API
- Updated every 15 minutes
- Rate locked at transaction time
- Historical rates stored

**Display Format**:
```typescript
const formatCurrency = (
  amount: number, 
  currency: string, 
  locale: string = 'en-US'
) => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
};

// Examples:
// USD: $1,234.56
// EUR: €1.234,56
// JPY: ¥1,235 (no decimals)
```

**Conversion Display**:
```tsx
<div className="currency-conversion">
  <div className="original">
    ${100.00} USD
  </div>
  <div className="conversion-arrow">
    ↓ (1 USD = 0.92 EUR)
  </div>
  <div className="converted">
    €92.00 EUR
  </div>
  <div className="rate-info">
    Rate as of Oct 19, 2025 3:45 PM
    <button>🔄 Refresh</button>
  </div>
</div>
```

### Multi-Currency Dashboard Toggle

**Feature**: View all earnings in different currency

**Implementation**:
```tsx
const [displayCurrency, setDisplayCurrency] = useState(userPayoutCurrency);

const convertAmount = (amount: number, from: string, to: string) => {
  if (from === to) return amount;
  const rate = getExchangeRate(from, to);
  return amount * rate;
};

return (
  <div className="currency-toggle">
    <label>Display in:</label>
    <select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>
      {SUPPORTED_CURRENCIES.map(curr => (
        <option value={curr.code}>{curr.name} ({curr.symbol})</option>
      ))}
    </select>
    
    {displayCurrency !== userPayoutCurrency && (
      <Alert>
        ℹ️ Showing converted values. 
        Your actual payouts are in {userPayoutCurrency}.
      </Alert>
    )}
  </div>
);
```

---

## Edge Cases & Error States

### 1. Verification Pending

**Scenario**: User hasn't completed KYC yet

```tsx
<Alert variant="warning" className="mb-4">
  <AlertCircle className="w-5 h-5" />
  <AlertTitle>Verification Required</AlertTitle>
  <AlertDescription>
    Complete identity verification to receive payouts.
    
    • Upload government ID
    • Submit tax form ({taxFormType})
    • Verify bank account
    
    Estimated time: 1-3 business days
    
    <Button variant="outline" size="sm">
      Complete Verification
    </Button>
  </AlertDescription>
</Alert>
```

### 2. Payout Below Minimum

**Scenario**: Earnings below minimum threshold

```tsx
<Alert variant="info">
  <Info className="w-5 h-5" />
  <AlertTitle>Below Minimum Payout</AlertTitle>
  <AlertDescription>
    Your current balance: $35.00
    Minimum required: $50.00
    
    You need $15.00 more to request a payout.
    
    Earnings below minimum roll over to next period automatically.
  </AlertDescription>
</Alert>
```

### 3. Currency Conversion Failed

**Scenario**: FX rate unavailable

```tsx
<Alert variant="error">
  <AlertTriangle className="w-5 h-5" />
  <AlertTitle>Conversion Unavailable</AlertTitle>
  <AlertDescription>
    We couldn't get current exchange rates. Your transaction 
    is safe, but converted amounts may not display correctly.
    
    Showing amounts in original currency (USD).
    
    <Button variant="link" size="sm">
      Try Again
    </Button>
  </AlertDescription>
</Alert>
```

### 4. Payout Method Unavailable

**Scenario**: Selected method not available in region

```tsx
<Alert variant="warning">
  <AlertCircle className="w-5 h-5" />
  <AlertTitle>Payment Method Unavailable</AlertTitle>
  <AlertDescription>
    PayPal is not available in your region ({country}).
    
    Available methods:
    • Bank Transfer (SEPA)
    • Wise
    
    <Button variant="outline" size="sm">
      Choose Different Method
    </Button>
  </AlertDescription>
</Alert>
```

### 5. Tax Form Rejected

**Scenario**: Submitted tax form has issues

```tsx
<Alert variant="error">
  <AlertTriangle className="w-5 h-5" />
  <AlertTitle>Tax Form Needs Attention</AlertTitle>
  <AlertDescription>
    Your W-9 form was rejected:
    
    • Name mismatch with ID
    • Signature missing
    • Date format incorrect
    
    Please resubmit with corrections.
    Payouts are on hold until resolved.
    
    <div className="flex gap-2 mt-3">
      <Button variant="default" size="sm">
        Upload New Form
      </Button>
      <Button variant="outline" size="sm">
        Contact Support
      </Button>
    </div>
  </AlertDescription>
</Alert>
```

### 6. Escrow Dispute

**Scenario**: Customer filed a dispute

```tsx
<Alert variant="warning">
  <AlertCircle className="w-5 h-5" />
  <AlertTitle>Payment Under Review</AlertTitle>
  <AlertDescription>
    A customer has filed a dispute for:
    "Sunset Wine Tasting" - $68.00
    
    Reason: Experience not as described
    
    The payment is on hold pending investigation.
    You'll receive an email within 24 hours.
    
    <Button variant="outline" size="sm">
      View Dispute Details
    </Button>
  </AlertDescription>
</Alert>
```

### 7. Failed Payout

**Scenario**: Bank transfer failed

```tsx
<Alert variant="error">
  <AlertTriangle className="w-5 h-5" />
  <AlertTitle>Payout Failed</AlertTitle>
  <AlertDescription>
    We couldn't send your payout of $425.00
    
    Reason: Invalid bank account number
    
    Your funds are safe. Update your bank details 
    and we'll retry automatically.
    
    <div className="flex gap-2 mt-3">
      <Button variant="default" size="sm">
        Update Bank Account
      </Button>
      <Button variant="link" size="sm">
        Contact Support
      </Button>
    </div>
  </AlertDescription>
</Alert>
```

### 8. Currency Locked

**Scenario**: User trying to change currency after first payout

```tsx
<Dialog>
  <DialogTitle>Currency Cannot Be Changed</DialogTitle>
  <DialogDescription>
    Your payout currency (EUR) is locked after receiving 
    your first payout.
    
    Why? This prevents:
    • Tax reporting complications
    • Regulatory violations
    • Historical data inconsistencies
    
    To change currency:
    1. Contact support
    2. May require new verification
    3. Historical data stays in original currency
    4. Processing time: 3-5 business days
    
    <div className="flex gap-2 mt-4">
      <Button variant="outline">Cancel</Button>
      <Button variant="default">Contact Support</Button>
    </div>
  </DialogDescription>
</Dialog>
```

---

## Microcopy & Education

### Inline Help Tooltips

**Platform Fee**:
> "Mingla's standard fee covering payment processing, customer support, platform maintenance, and fraud protection. This fee is consistent across all transactions."

**Curator Commission**:
> "Your percentage of the sale, negotiated with each business partner. Typical range is 10-30%. You can renegotiate quarterly."

**Payment Processor Fee**:
> "Charged by your payment provider (Stripe, PayPal, etc.) for handling the transaction. Varies by method: Bank Transfer (free), Stripe/PayPal (2.9%)."

**Currency Conversion Fee**:
> "Applied when your currency differs from the sale currency. Includes FX spread and provider fees. Rate is locked at transaction time."

**Escrow Period**:
> "Funds are held briefly after the experience for quality assurance and dispute resolution. This protects both curators and customers."

**Currency Lock**:
> "Your payout currency is permanently locked after your first payout to prevent tax complications and meet regulatory requirements."

**Instant Payouts**:
> "Receive earnings immediately after each transaction instead of monthly. Premium feature with 3% fee. Available for Stripe and PayPal only."

**Minimum Payout**:
> "You must have at least $50 in earnings to request a payout. Amounts below this automatically roll over to the next period."

### Educational Banners

**First Time Viewing Earnings**:
```
┌────────────────────────────────────────────┐
│ 💡 New to Payouts?                         │
│                                            │
│ Here's how it works:                       │
│ 1. Earn commission from experiences        │
│ 2. Funds held 3 days for quality check    │
│ 3. Auto-payout monthly (or request early)  │
│ 4. Receive in your chosen currency        │
│                                            │
│ [Watch 2-min Video] [Read Guide] [Got It] │
└────────────────────────────────────────────┘
```

**Currency Selection**:
```
┌────────────────────────────────────────────┐
│ 🌍 Choosing Your Currency                  │
│                                            │
│ Important: This decision is permanent      │
│ after your first payout.                   │
│                                            │
│ Consider:                                  │
│ • Your bank account currency              │
│ • Tax reporting requirements              │
│ • Most common sale currency               │
│                                            │
│ Need help deciding? [Contact Support]      │
└────────────────────────────────────────────┘
```

**Escrow Explanation**:
```
┌────────────────────────────────────────────┐
│ ⏱️  Understanding Escrow                    │
│                                            │
│ Your funds are safe and reserved for you.  │
│ We hold them briefly (3 days) to:         │
│                                            │
│ ✓ Ensure quality experiences              │
│ ✓ Give time for issue resolution          │
│ ✓ Protect against fraud/chargebacks       │
│                                            │
│ Funds auto-release after escrow period.    │
│ This is standard for marketplaces.         │
│                                            │
│ [Learn More] [Dismiss]                     │
└────────────────────────────────────────────┘
```

---

## Technical Requirements

### Backend API Endpoints

```typescript
// Payout Setup
POST   /api/curator/payout-setup
GET    /api/curator/payout-setup
PUT    /api/curator/payout-setup

// Earnings & Transactions
GET    /api/curator/earnings/summary
GET    /api/curator/earnings/transactions
GET    /api/curator/earnings/transactions/:id

// Currency
GET    /api/currency/rates
GET    /api/currency/supported
POST   /api/currency/convert

// Verification
POST   /api/curator/kyc/upload
GET    /api/curator/kyc/status
POST   /api/curator/tax-forms/upload
GET    /api/curator/tax-forms/status

// Payouts
POST   /api/curator/payouts/request
GET    /api/curator/payouts/history
GET    /api/curator/payouts/:id

// Regional
GET    /api/regional/rules/:country
GET    /api/regional/payment-methods/:country
```

### Data Models

**PayoutSetup**:
```typescript
interface PayoutSetup {
  curatorId: string;
  country: string;          // ISO 3166-1 alpha-2
  currency: string;         // ISO 4217
  currencyLocked: boolean;
  lockedAt?: Date;
  payoutMethod: PayoutMethod;
  instantPayouts: boolean;
  kycStatus: 'pending' | 'verified' | 'rejected';
  kycDocuments: Document[];
  taxFormType: string;
  taxFormStatus: 'pending' | 'approved' | 'rejected';
  taxFormDocuments: Document[];
  bankDetails?: BankDetails;
  minimumPayout: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Transaction**:
```typescript
interface Transaction {
  id: string;
  curatorId: string;
  experienceId: string;
  businessId: string;
  purchaseId: string;
  date: Date;
  
  // Amounts
  grossAmount: number;
  platformFee: number;
  platformFeePercent: number;
  curatorCommission: number;
  curatorCommissionPercent: number;
  paymentProcessorFee: number;
  conversionFee?: number;
  netPayout: number;
  
  // Currency
  currency: string;
  originalCurrency?: string;
  fxRate?: number;
  fxRateDate?: Date;
  
  // Status
  status: 'pending' | 'escrow' | 'released' | 'paid';
  escrowUntil?: Date;
  payoutId?: string;
  paidAt?: Date;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}
```

**Payout**:
```typescript
interface Payout {
  id: string;
  curatorId: string;
  period: string;
  transactions: string[];    // Transaction IDs
  
  // Amounts
  totalGross: number;
  totalFees: number;
  totalNet: number;
  currency: string;
  
  // Method
  payoutMethod: PayoutMethod;
  accountEnding: string;
  
  // Status
  status: 'pending' | 'processing' | 'completed' | 'failed';
  requestedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
  failureReason?: string;
  
  // Receipt
  receiptUrl?: string;
  transactionRef?: string;
  
  createdAt: Date;
  updatedAt: Date;
}
```

### Currency Conversion Service

```typescript
class CurrencyService {
  async getRates(): Promise<ExchangeRates> {
    // Fetch from payment provider API
    // Cache for 15 minutes
    // Return rates object
  }
  
  async convert(
    amount: number, 
    from: string, 
    to: string, 
    date?: Date
  ): Promise<ConversionResult> {
    // Get rate (current or historical)
    // Calculate converted amount
    // Calculate conversion fee
    // Return result with breakdown
  }
  
  lockCurrency(curatorId: string, currency: string): Promise<void> {
    // Permanently lock payout currency
    // Update curator record
    // Send confirmation email
  }
}
```

### Regional Rules Engine

```typescript
class RegionalRulesEngine {
  getEscrowPeriod(country: string, amount: number): number {
    const base = ESCROW_RULES[country] || 3;
    if (amount > 500) return base + 2;
    return base;
  }
  
  getPaymentMethods(country: string): PayoutMethod[] {
    return PAYMENT_METHODS[country] || PAYMENT_METHODS.default;
  }
  
  getTaxRequirements(country: string): TaxRequirement[] {
    return TAX_REQUIREMENTS[country] || [];
  }
  
  getProcessingTime(
    fromCountry: string, 
    toCountry: string, 
    method: PayoutMethod
  ): string {
    const domestic = fromCountry === toCountry;
    const times = PROCESSING_TIMES[method];
    return domestic ? times.domestic : times.international;
  }
}
```

---

## Testing Checklist

### Functional Testing

- [ ] **Onboarding Flow**
  - [ ] Can complete all 5 steps
  - [ ] Validation works on each step
  - [ ] Can go back and edit previous steps
  - [ ] Can save as draft and resume
  - [ ] Documents upload successfully
  - [ ] Country selection filters payment methods
  - [ ] Currency auto-populates correctly
  - [ ] Tax form type auto-selects based on country

- [ ] **Currency Management**
  - [ ] Currency dropdown shows all supported currencies
  - [ ] Conversion calculations are accurate
  - [ ] FX rates update every 15 minutes
  - [ ] Currency lock warning appears before first payout
  - [ ] Currency cannot be changed after lock
  - [ ] Original vs converted toggle works
  - [ ] Multi-currency transactions display correctly

- [ ] **Transaction Breakdown**
  - [ ] All fees calculate correctly
  - [ ] Percentages match fee structure
  - [ ] Conversion fees apply when currencies differ
  - [ ] Timeline shows correct statuses
  - [ ] Escrow dates calculate properly
  - [ ] Expand/collapse animation smooth
  - [ ] Tooltips explain each line item

- [ ] **Regional Rules**
  - [ ] Correct escrow period per country
  - [ ] Payment methods filter by country
  - [ ] Processing times show domestic vs international
  - [ ] Tax requirements display per country
  - [ ] Minimum payout respects currency

- [ ] **Error States**
  - [ ] Verification pending shows warning
  - [ ] Below minimum displays alert
  - [ ] Failed payouts show error and action
  - [ ] Conversion errors handle gracefully
  - [ ] Disputes show review status
  - [ ] Network errors retry automatically

### Visual/UX Testing

- [ ] **Responsive Design**
  - [ ] Works on mobile (320px+)
  - [ ] Works on tablet (768px+)
  - [ ] Works on desktop (1024px+)
  - [ ] Cards stack properly on small screens
  - [ ] Modals are scrollable on mobile

- [ ] **Animations**
  - [ ] Step transitions smooth
  - [ ] Accordion expand/collapse smooth
  - [ ] Loading states use skeleton screens
  - [ ] Hover effects subtle
  - [ ] No layout shift during load

- [ ] **Colors & Branding**
  - [ ] Mingla gradient used for primary actions
  - [ ] Status colors consistent (green=success, red=error, etc.)
  - [ ] Sufficient contrast for accessibility
  - [ ] Dark mode support (if applicable)

- [ ] **Typography**
  - [ ] Hierarchy clear (headings, body, labels)
  - [ ] Numbers easy to read
  - [ ] Currency symbols correct
  - [ ] Line height comfortable

### Accessibility Testing

- [ ] Keyboard navigation works
- [ ] Screen reader announces correctly
- [ ] Focus indicators visible
- [ ] ARIA labels on interactive elements
- [ ] Color not sole indicator of meaning
- [ ] Form validation announcements
- [ ] Error messages clear and actionable

### Performance Testing

- [ ] Page loads in < 2 seconds
- [ ] Currency conversion doesn't block UI
- [ ] Large transaction lists paginate
- [ ] Images/icons optimized
- [ ] No memory leaks on long sessions

### Security Testing

- [ ] Documents encrypted in transit
- [ ] Sensitive data masked (account numbers)
- [ ] Currency amounts not editable
- [ ] API calls authenticated
- [ ] CSRF protection on forms
- [ ] Input sanitized to prevent XSS

---

## Appendix

### Currency Symbol Reference

```
USD: $
EUR: €
GBP: £
AUD: A$
CAD: C$
BRL: R$
JPY: ¥
INR: ₹
```

### Common Fee Percentages

```
Platform: 15%
Curator: 10-30% (typical 20%)
Stripe: 2.9%
PayPal: 2.9%
Conversion: 1-2%
```

### Processing Times Matrix

```
         | Domestic | International
---------|----------|---------------
Bank     | 3-5 days | 7-10 days
Stripe   | Instant  | 2-3 days
PayPal   | Instant  | 1-2 days
Wise     | 1-2 days | 1-3 days
PIX      | Instant  | N/A
SEPA     | 1-3 days | N/A
```

---

**Document Status**: ✅ Complete  
**Last Updated**: October 19, 2025  
**Next Review**: November 19, 2025  

For questions or clarifications, contact: product@mingla.com
