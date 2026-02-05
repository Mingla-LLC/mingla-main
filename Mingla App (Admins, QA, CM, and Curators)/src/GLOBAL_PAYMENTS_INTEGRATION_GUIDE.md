# Global Payments System - Developer Integration Guide

## Quick Start

This guide shows how to integrate the new global payments features into the existing Mingla curator dashboard.

---

## New Components Created

### 1. PayoutOnboardingFlow.tsx
**Location**: `/components/PayoutOnboardingFlow.tsx`  
**Purpose**: 5-step modal for curator payout setup  
**Usage**:

```tsx
import PayoutOnboardingFlow from './components/PayoutOnboardingFlow';

function CuratorDashboard() {
  const [showOnboarding, setShowOnboarding] = useState(!payoutSetupComplete);
  
  return (
    <>
      {/* Your existing dashboard */}
      
      <PayoutOnboardingFlow
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onComplete={(data) => {
          // Send to backend
          await fetch('/api/curator/payout-setup', {
            method: 'POST',
            body: JSON.stringify(data)
          });
          setShowOnboarding(false);
        }}
      />
    </>
  );
}
```

### 2. PayoutsSystemEnhanced.tsx
**Location**: `/components/PayoutsSystemEnhanced.tsx`  
**Purpose**: Main earnings dashboard with multi-currency  
**Usage**:

```tsx
import PayoutsSystemEnhanced from './components/PayoutsSystemEnhanced';

function EarningsTab() {
  return (
    <PayoutsSystemEnhanced
      curatorData={{
        name: currentUser.name,
        email: currentUser.email,
        country: currentUser.country,
        currency: currentUser.payoutCurrency,
        payoutSetupComplete: currentUser.payoutSetupComplete
      }}
    />
  );
}
```

---

## Integrating into CuratorDashboard.tsx

### Step 1: Add Import

```tsx
import PayoutsSystemEnhanced from './PayoutsSystemEnhanced';
import PayoutOnboardingFlow from './PayoutOnboardingFlow';
```

### Step 2: Replace Existing Earnings Tab

Find this section in `CuratorDashboard.tsx`:

```tsx
{activeTab === 'earnings' && (
  <div>
    {/* Old earnings content */}
  </div>
)}
```

Replace with:

```tsx
{activeTab === 'earnings' && (
  <PayoutsSystemEnhanced
    curatorData={{
      name: user.name,
      email: user.email,
      country: user.country || 'US',
      currency: user.payoutCurrency || 'USD',
      payoutSetupComplete: user.payoutSetupComplete || false
    }}
  />
)}
```

### Step 3: Add Onboarding Trigger

```tsx
// In CuratorDashboard component
const [showPayoutOnboarding, setShowPayoutOnboarding] = useState(false);

// Check if setup needed on mount
useEffect(() => {
  if (!user.payoutSetupComplete && activeTab === 'earnings') {
    setShowPayoutOnboarding(true);
  }
}, [user.payoutSetupComplete, activeTab]);

// Add to render
return (
  <div>
    {/* Existing dashboard content */}
    
    <PayoutOnboardingFlow
      isOpen={showPayoutOnboarding}
      onClose={() => setShowPayoutOnboarding(false)}
      onComplete={handlePayoutSetup}
    />
  </div>
);
```

---

## BusinessManagementModal.tsx Enhancements

### Add Currency Alignment Alert

```tsx
// In BusinessManagementModal.tsx
import { AlertCircle } from 'lucide-react';

// Add after business details
{business.currency !== curator.currency && (
  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mb-4">
    <div className="flex items-start gap-3">
      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-amber-900">
        <p className="font-medium mb-1">Currency Mismatch</p>
        <p className="text-amber-800">
          This business operates in <strong>{business.currency}</strong>, but your 
          payout currency is <strong>{curator.currency}</strong>. Conversion fees 
          (1-2%) will apply to all transactions.
        </p>
        <button className="text-amber-900 underline mt-2 text-xs">
          View Fee Calculator
        </button>
      </div>
    </div>
  </div>
)}
```

### Add Regional Compliance Checklist

```tsx
<div className="p-4 border border-gray-200 rounded-xl mb-4">
  <h4 className="font-medium mb-3">Regional Compliance</h4>
  <div className="space-y-2">
    <div className={`flex items-center gap-2 text-sm ${
      kycStatus === 'verified' ? 'text-green-600' : 'text-gray-600'
    }`}>
      {kycStatus === 'verified' ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <Clock className="w-4 h-4" />
      )}
      <span>Identity Verification (KYC)</span>
    </div>
    
    <div className={`flex items-center gap-2 text-sm ${
      taxFormStatus === 'approved' ? 'text-green-600' : 'text-gray-600'
    }`}>
      {taxFormStatus === 'approved' ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <Clock className="w-4 h-4" />
      )}
      <span>Tax Documentation</span>
    </div>
    
    <div className={`flex items-center gap-2 text-sm ${
      bankVerified ? 'text-green-600' : 'text-gray-600'
    }`}>
      {bankVerified ? (
        <CheckCircle className="w-4 h-4" />
      ) : (
        <Clock className="w-4 h-4" />
      )}
      <span>Bank Account Verification</span>
    </div>
  </div>
</div>
```

### Enhanced Commission Display

```tsx
<div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
  <h4 className="font-medium mb-3">Commission Breakdown</h4>
  <div className="space-y-2 text-sm">
    <div className="flex justify-between">
      <span className="text-gray-600">Example Sale:</span>
      <span className="font-medium">$100.00</span>
    </div>
    
    <div className="flex justify-between text-red-600">
      <span>Platform Fee (15%)</span>
      <span>-$15.00</span>
    </div>
    
    <div className="h-px bg-gray-300 my-2" />
    
    <div className="flex justify-between">
      <span className="text-gray-600">Available:</span>
      <span>$85.00</span>
    </div>
    
    <div className="flex justify-between text-green-600">
      <span>Your Commission ({commissionRate}%)</span>
      <span>+${(85 * commissionRate / 100).toFixed(2)}</span>
    </div>
    
    <div className="flex justify-between text-red-600">
      <span>Payment Fee (2.9%)</span>
      <span>-${(85 * commissionRate / 100 * 0.029).toFixed(2)}</span>
    </div>
    
    {business.currency !== curator.currency && (
      <div className="flex justify-between text-red-600">
        <span>Conversion Fee (1.5%)</span>
        <span>-${(85 * commissionRate / 100 * 0.015).toFixed(2)}</span>
      </div>
    )}
    
    <div className="h-px bg-gray-300 my-2" />
    
    <div className="flex justify-between text-lg">
      <span className="font-medium">Net Payout:</span>
      <span className="font-medium text-[#eb7825]">
        ${calculateNetPayout().toFixed(2)}
      </span>
    </div>
  </div>
  
  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
    <label className="flex items-center gap-2 text-sm cursor-pointer">
      <input type="checkbox" />
      <span>Pass platform fee to customer (+$15)</span>
    </label>
  </div>
</div>
```

---

## CardPreviewModal.tsx Enhancements

### Add Currency Localization

```tsx
import { Globe, Info } from 'lucide-react';

// In CardPreviewModal
const [displayCurrency, setDisplayCurrency] = useState(userCurrency);

// Add currency toggle
<div className="flex items-center justify-between p-3 bg-gray-50 border-y border-gray-200">
  <div className="flex items-center gap-2 text-sm text-gray-600">
    <Globe className="w-4 h-4" />
    <span>Display in:</span>
  </div>
  <select
    value={displayCurrency}
    onChange={(e) => setDisplayCurrency(e.target.value)}
    className="text-sm border border-gray-200 rounded-lg px-2 py-1"
  >
    <option value="USD">USD ($)</option>
    <option value="EUR">EUR (€)</option>
    <option value="GBP">GBP (£)</option>
    {/* More currencies */}
  </select>
</div>

// Update price display
<div className="text-2xl font-bold mb-1">
  {formatCurrency(card.price, displayCurrency)}
</div>

{displayCurrency !== card.originalCurrency && (
  <div className="flex items-center gap-1 text-xs text-gray-500">
    <Info className="w-3 h-3" />
    <span>
      Originally {formatCurrency(card.price, card.originalCurrency)}
    </span>
  </div>
)}
```

---

## Analytics Dashboard Enhancements

### Add Earnings by Region Chart

```tsx
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const EarningsByRegion = ({ data }) => {
  const COLORS = ['#eb7825', '#d6691f', '#4f46e5', '#0891b2', '#059669'];
  
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h3 className="font-medium mb-4">Earnings by Region</h3>
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="region"
            cx="50%"
            cy="50%"
            outerRadius={100}
            label
          >
            {data.map((entry, index) => (
              <Cell key={index} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
      
      <div className="mt-4 space-y-2">
        {data.map((region, index) => (
          <div key={index} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded-full" 
                style={{ backgroundColor: COLORS[index % COLORS.length] }}
              />
              <span>{region.region}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-600">{region.transactions} sales</span>
              <span className="font-medium">${region.amount.toFixed(2)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

### Add Currency Filter

```tsx
<div className="flex items-center gap-4 mb-6">
  <select
    value={currencyFilter}
    onChange={(e) => setCurrencyFilter(e.target.value)}
    className="px-3 py-2 border border-gray-200 rounded-lg"
  >
    <option value="all">All Currencies</option>
    <option value="USD">USD</option>
    <option value="EUR">EUR</option>
    <option value="GBP">GBP</option>
  </select>
  
  <select
    value={regionFilter}
    onChange={(e) => setRegionFilter(e.target.value)}
    className="px-3 py-2 border border-gray-200 rounded-lg"
  >
    <option value="all">All Regions</option>
    <option value="US">United States</option>
    <option value="EU">European Union</option>
    <option value="UK">United Kingdom</option>
  </select>
</div>
```

---

## Support System Enhancements

### Add Payout/Currency Category

```tsx
// In SupportTicketModal.tsx
const TICKET_CATEGORIES = [
  { id: 'bug', name: 'Bug Report', icon: AlertCircle },
  { id: 'feature', name: 'Feature Request', icon: Lightbulb },
  { id: 'account', name: 'Account Issue', icon: User },
  { id: 'payout', name: 'Payout or Currency Issue', icon: DollarSign }, // NEW
  { id: 'partnership', name: 'Business Partnership', icon: Building2 },
  { id: 'general', name: 'General Inquiry', icon: HelpCircle },
];

// Add specific fields for payout issues
{ticketType === 'payout' && (
  <div className="space-y-3">
    <select className="w-full px-3 py-2 border rounded-lg">
      <option>Select issue type...</option>
      <option>Payout delayed</option>
      <option>Incorrect amount</option>
      <option>Currency conversion error</option>
      <option>Verification problem</option>
      <option>Tax form issue</option>
      <option>Bank account problem</option>
    </select>
    
    <Input placeholder="Transaction ID (if applicable)" />
    <Input placeholder="Expected amount" />
    <Input placeholder="Actual amount" />
  </div>
)}
```

### Context-Sensitive Chat

```tsx
// In LiveChatSupport.tsx
const getPayoutContext = () => {
  return {
    setupComplete: user.payoutSetupComplete,
    currency: user.payoutCurrency,
    verificationStatus: user.kycStatus,
    pendingAmount: earnings.pending,
    lastPayout: payouts.last?.date
  };
};

// Send context with chat
const startChat = () => {
  socket.emit('chat:start', {
    userId: user.id,
    context: getPayoutContext(),
    category: 'payout'
  });
};
```

---

## Backend Integration

### Required API Endpoints

```typescript
// Payout Setup
POST   /api/curator/payout-setup
{
  country: 'US',
  currency: 'USD',
  payoutMethod: 'bank',
  instantPayouts: false,
  bankDetails: { ... },
  kycDocuments: [ ... ],
  taxForm: { ... }
}

GET    /api/curator/payout-setup
Response: PayoutSetupData

PUT    /api/curator/payout-setup
{
  // Updated fields
}

// Earnings
GET    /api/curator/earnings/summary?currency=USD
Response: {
  lifetimeEarnings: number,
  pendingPayout: number,
  inEscrow: number,
  thisMonth: number,
  currency: string
}

GET    /api/curator/earnings/transactions?timeframe=30d&currency=USD
Response: Transaction[]

GET    /api/curator/earnings/transactions/:id
Response: TransactionWithDetails

// Currency
GET    /api/currency/rates
Response: { [currency: string]: number }

POST   /api/currency/convert
{
  amount: number,
  from: string,
  to: string
}
Response: {
  amount: number,
  rate: number,
  fee: number,
  converted: number
}

// Regional
GET    /api/regional/rules/:country
Response: {
  escrowPeriod: number,
  paymentMethods: string[],
  processingTime: string,
  taxRequirements: TaxRequirement[],
  minimumPayout: number
}
```

### Database Schema Updates

```sql
-- Add to curators table
ALTER TABLE curators ADD COLUMN payout_country VARCHAR(2);
ALTER TABLE curators ADD COLUMN payout_currency VARCHAR(3);
ALTER TABLE curators ADD COLUMN currency_locked BOOLEAN DEFAULT FALSE;
ALTER TABLE curators ADD COLUMN currency_locked_at TIMESTAMP;
ALTER TABLE curators ADD COLUMN payout_method VARCHAR(50);
ALTER TABLE curators ADD COLUMN instant_payouts BOOLEAN DEFAULT FALSE;
ALTER TABLE curators ADD COLUMN kyc_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE curators ADD COLUMN tax_form_type VARCHAR(50);
ALTER TABLE curators ADD COLUMN tax_form_status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE curators ADD COLUMN minimum_payout DECIMAL(10,2) DEFAULT 50.00;

-- Transactions table updates
ALTER TABLE transactions ADD COLUMN original_currency VARCHAR(3);
ALTER TABLE transactions ADD COLUMN payout_currency VARCHAR(3);
ALTER TABLE transactions ADD COLUMN fx_rate DECIMAL(10,6);
ALTER TABLE transactions ADD COLUMN conversion_fee DECIMAL(10,2);
ALTER TABLE transactions ADD COLUMN escrow_until TIMESTAMP;
ALTER TABLE transactions ADD COLUMN escrow_released_at TIMESTAMP;

-- New KYC documents table
CREATE TABLE kyc_documents (
  id UUID PRIMARY KEY,
  curator_id UUID REFERENCES curators(id),
  document_type VARCHAR(50), -- 'id', 'tax_form', 'bank_verification'
  file_url TEXT,
  status VARCHAR(20), -- 'pending', 'approved', 'rejected'
  uploaded_at TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewer_notes TEXT
);

-- Currency conversion log
CREATE TABLE currency_conversions (
  id UUID PRIMARY KEY,
  transaction_id UUID REFERENCES transactions(id),
  from_currency VARCHAR(3),
  to_currency VARCHAR(3),
  amount DECIMAL(10,2),
  rate DECIMAL(10,6),
  fee DECIMAL(10,2),
  converted_amount DECIMAL(10,2),
  provider VARCHAR(50), -- 'stripe', 'wise', etc.
  converted_at TIMESTAMP
);
```

---

## Environment Variables

```env
# Payment Providers
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
WISE_API_KEY=...

# Currency API
CURRENCY_API_KEY=...
CURRENCY_API_URL=https://api.exchangerate.io/v1/latest

# KYC Provider
KYC_PROVIDER=jumio
JUMIO_API_KEY=...
JUMIO_API_SECRET=...

# Document Storage
AWS_S3_BUCKET=mingla-documents
AWS_REGION=us-east-1

# Regional Settings
DEFAULT_CURRENCY=USD
SUPPORTED_CURRENCIES=USD,EUR,GBP,AUD,CAD,BRL,JPY,INR
MINIMUM_PAYOUT_USD=50
ESCROW_PERIOD_DAYS=3
```

---

## Testing

### Unit Tests

```typescript
// Currency conversion
test('converts USD to EUR correctly', () => {
  const result = convertCurrency(100, 'USD', 'EUR', 0.92);
  expect(result.amount).toBe(92);
  expect(result.fee).toBe(1.38); // 1.5%
  expect(result.net).toBe(90.62);
});

// Fee calculation
test('calculates curator payout correctly', () => {
  const sale = 100;
  const platformFee = 15;
  const commission = 20;
  const result = calculatePayout(sale, platformFee, commission);
  expect(result.curatorGross).toBe(17);
  expect(result.processorFee).toBeCloseTo(0.49);
  expect(result.net).toBeCloseTo(16.51);
});

// Escrow period
test('calculates escrow period based on region and amount', () => {
  expect(getEscrowPeriod('US', 100)).toBe(3);
  expect(getEscrowPeriod('EU', 100)).toBe(14);
  expect(getEscrowPeriod('US', 600)).toBe(5); // +2 days for high value
});
```

### Integration Tests

```typescript
describe('Payout Onboarding', () => {
  it('completes full onboarding flow', async () => {
    // Step 1: Welcome
    const { getByText } = render(<PayoutOnboardingFlow {...props} />);
    fireEvent.click(getByText('Start Setup'));
    
    // Step 2: Country & Currency
    const countrySelect = screen.getByLabelText('Payout Country');
    fireEvent.change(countrySelect, { target: { value: 'US' } });
    fireEvent.click(getByText('Continue'));
    
    // Step 3: Payment Method
    fireEvent.click(getByText('Bank Transfer'));
    fireEvent.click(getByText('Continue'));
    
    // Step 4: KYC
    // Upload documents...
    fireEvent.click(getByText('Continue'));
    
    // Step 5: Review & Complete
    fireEvent.click(getByText('Complete Setup'));
    
    await waitFor(() => {
      expect(props.onComplete).toHaveBeenCalled();
    });
  });
});
```

### E2E Tests

```typescript
describe('Earnings Dashboard', () => {
  it('displays multi-currency earnings correctly', async () => {
    await login('curator@example.com');
    await navigateTo('/dashboard/earnings');
    
    // Check summary cards
    expect(screen.getByText('Lifetime Earnings')).toBeInTheDocument();
    expect(screen.getByText(/\$28,450\.75/)).toBeInTheDocument();
    
    // Toggle currency
    const currencySelect = screen.getByLabelText('Display in:');
    fireEvent.change(currencySelect, { target: { value: 'EUR' } });
    
    // Should recalculate
    await waitFor(() => {
      expect(screen.getByText(/€26,174\.69/)).toBeInTheDocument();
    });
    
    // Expand transaction
    const firstTransaction = screen.getAllByRole('button')[0];
    fireEvent.click(firstTransaction);
    
    // Check breakdown visible
    expect(screen.getByText('Fee Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Platform Fee')).toBeInTheDocument();
  });
});
```

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations run
- [ ] Payment provider webhooks configured
- [ ] Currency API key valid
- [ ] KYC provider integrated
- [ ] Document storage (S3) configured
- [ ] Regional rules loaded
- [ ] Tax form templates uploaded
- [ ] Support team trained on new features
- [ ] User documentation updated
- [ ] Analytics tracking implemented
- [ ] Error monitoring configured
- [ ] Load testing completed

---

## Rollout Plan

### Phase 1: Beta (Week 1-2)
- [ ] Enable for 10% of curators
- [ ] Monitor for issues
- [ ] Gather feedback
- [ ] Fix critical bugs

### Phase 2: Gradual Rollout (Week 3-4)
- [ ] Increase to 25% of curators
- [ ] Continue monitoring
- [ ] Address feedback
- [ ] Optimize performance

### Phase 3: Full Launch (Week 5+)
- [ ] Enable for all curators
- [ ] Announce in-app and email
- [ ] Provide support resources
- [ ] Monitor metrics

---

## Support Resources

### For Curators
- Video tutorial: "Setting Up Global Payouts"
- Help article: "Understanding Currency Conversion"
- FAQ: "Common Payout Questions"
- Email: payouts@mingla.com
- Live chat: Available 9am-6pm PST

### For Support Team
- Internal guide: Troubleshooting Payout Issues
- Currency conversion calculator tool
- Regional rules reference
- Escalation procedures
- Contact: payment-provider support

---

## Monitoring

### Key Metrics to Track

```typescript
// Onboarding
- Onboarding start rate
- Onboarding completion rate
- Average time to complete
- Drop-off points
- Document rejection rate

// Earnings
- Total payouts processed
- Average payout amount
- Currency breakdown
- Failed payout rate
- Support ticket rate

// Performance
- Dashboard load time
- Currency conversion latency
- Transaction list pagination
- Mobile vs desktop usage
```

### Alerts to Configure

```
- Payout failure rate > 5%
- Currency API downtime
- KYC verification delays > 5 days
- Escrow release delays
- Support ticket spike (payout category)
- Conversion fee anomalies
```

---

## Contact

For implementation questions:
- **Product**: product@mingla.com
- **Engineering**: engineering@mingla.com
- **Support**: support@mingla.com

**Last Updated**: October 19, 2025
