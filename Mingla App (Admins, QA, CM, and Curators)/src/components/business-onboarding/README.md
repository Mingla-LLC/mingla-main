# Business Onboarding System

Comprehensive onboarding flow for business users joining the Mingla platform.

## Overview

The Business Onboarding system guides new business users through a complete profile setup and their first experience creation in 8 easy steps. Unlike explorers who focus on preferences, business users need to provide detailed business information, contact details, operating hours, and media assets.

## Flow Steps

### Step 0: Welcome
- Collects owner's personal information (first name, last name, email)
- Sets expectations for the onboarding process
- Validates email format

### Step 1: Business Information
- Business name and legal type (Individual, LLC, Corporation, etc.)
- Business category (Restaurant, Café, Tours, Wellness, etc.)
- Founding year and team size
- Business description (up to 500 characters)

### Step 2: Contact Information
- Phone number (validated)
- Business address (street, city, state, ZIP, country)
- Website URL (optional)
- Social media links (Instagram, Facebook, Twitter) (optional)

### Step 3: Operating Hours
- Configure hours for each day of the week
- Toggle open/closed status per day
- Set opening and closing times
- "Copy to all" functionality for convenience

### Step 4: Media & Photos
- Logo upload (optional but recommended)
- Cover image upload (optional)
- Photo gallery (minimum 1 photo required, maximum 15)
- Drag-to-reorder functionality
- Image preview and delete options

### Step 5: Verification & Terms
- Business Partner Agreement display
- Terms of Service acceptance (required)
- Marketing communications consent (optional)
- Privacy policy information
- Verification timeline expectations (24-48 hours)

### Step 6: First Experience Creation
- Integrated CardCreatorModal for experience creation
- Guided tips for creating a great first experience
- Option to skip and create later from dashboard
- Success confirmation when experience is created

### Step 7: Completion & Review
- Summary of all onboarding data
- Edit links for each section
- Next steps after onboarding
- Quick tips for business success
- Button to proceed to business dashboard

## Components

### Main Components

- **BusinessOnboardingFlow** - Main orchestrator component
- **BusinessOnboardingProgress** - Progress bar with step indicators

### Step Components

All located in `/components/business-onboarding/steps/`:

- `BusinessWelcomeStep.tsx` - Initial welcome and personal info
- `BusinessInfoStep.tsx` - Business details and categorization
- `BusinessContactStep.tsx` - Contact information and addresses
- `BusinessLocationStep.tsx` - Operating hours configuration
- `BusinessMediaStep.tsx` - Logo, cover, and photo uploads
- `BusinessVerificationStep.tsx` - Terms acceptance and compliance
- `FirstExperienceStep.tsx` - First experience creation wizard
- `BusinessCompletionStep.tsx` - Summary and completion

### Supporting Files

- `types.ts` - TypeScript interfaces and types
- `constants.ts` - Default values and configuration
- `helpers.ts` - Utility functions for validation and data handling
- `index.ts` - Public API exports

## Data Structure

```typescript
interface BusinessOnboardingData {
  // Owner info
  ownerFirstName: string;
  ownerLastName: string;
  email: string;
  
  // Business info
  businessName: string;
  businessType: 'individual' | 'llc' | 'corporation' | 'partnership' | 'nonprofit' | '';
  businessCategory: string;
  description: string;
  foundingYear: string;
  teamSize: string;
  
  // Contact info
  phone: string;
  website: string;
  socialMedia: {
    instagram: string;
    facebook: string;
    twitter: string;
  };
  
  // Location info
  address: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  operatingHours: OperatingHours;
  
  // Media
  photos: string[];
  logo: string;
  coverImage: string;
  
  // Verification
  termsAccepted: boolean;
  marketingConsent: boolean;
  
  // Experience creation
  firstExperienceCreated: boolean;
  firstExperienceId: string;
}
```

## Usage

### Basic Integration

```tsx
import BusinessOnboardingFlow from './components/BusinessOnboardingFlow';

function App() {
  const handleOnboardingComplete = (data: BusinessOnboardingData) => {
    // Save business data
    // Redirect to business dashboard
    console.log('Business onboarding completed:', data);
  };

  return (
    <BusinessOnboardingFlow 
      onComplete={handleOnboardingComplete}
      onBackToSignIn={() => console.log('Back to sign in')}
    />
  );
}
```

### Integration with App.tsx

The business onboarding is automatically triggered when:
1. User signs up as a business role
2. User is authenticated
3. User has NOT completed onboarding

```tsx
// In App.tsx
if (isAuthenticated && !hasCompletedOnboarding) {
  if (userRole === 'business') {
    return (
      <ErrorBoundary>
        <BusinessOnboardingFlow 
          onComplete={handleOnboardingComplete}
          onBackToSignIn={handleAppSignOut}
        />
      </ErrorBoundary>
    );
  }
}
```

## Validation Rules

### Required Fields by Step

**Step 0 (Welcome):**
- First name (non-empty)
- Last name (non-empty)
- Email (valid email format)

**Step 1 (Business Info):**
- Business name (non-empty)
- Business type (selected)
- Business category (selected)

**Step 2 (Contact):**
- Phone number (10+ digits)
- Address (non-empty)

**Step 3 (Operating Hours):**
- At least one day configured (checked automatically)

**Step 4 (Media):**
- At least 1 photo uploaded
- Logo and cover are optional but recommended

**Step 5 (Verification):**
- Terms of Service accepted (checkbox checked)

**Step 6 (First Experience):**
- Experience created OR user chooses to skip

**Step 7 (Completion):**
- Review and confirm (always valid)

## Helper Functions

### saveBusinessOnboardingData

Saves completed onboarding data to localStorage and creates business record.

```typescript
const business = await saveBusinessOnboardingData(onboardingData);
// Returns business object with generated ID
```

### validateEmail

Validates email address format.

```typescript
const isValid = validateEmail('test@example.com'); // true
```

### validatePhone

Validates phone number has at least 10 digits.

```typescript
const isValid = validatePhone('(555) 123-4567'); // true
```

### formatPhoneNumber

Formats phone number to US format (XXX) XXX-XXXX.

```typescript
const formatted = formatPhoneNumber('5551234567');
// Returns: (555) 123-4567
```

### generateBusinessSlug

Generates URL-friendly slug from business name.

```typescript
const slug = generateBusinessSlug('The Coffee Lab');
// Returns: the-coffee-lab
```

## Design System

### Brand Colors
- Primary: `#eb7825`
- Secondary: `#d6691f`
- White, Black

### UI Patterns
- Modern white containers with subtle borders
- Consistent spacing and padding
- Step icons with brand color backgrounds
- Progress bar with percentage indicator
- Form validation with inline error messages

### Mobile Optimization
- Responsive layouts for all screen sizes
- Touch-friendly button sizes
- Mobile-optimized form inputs
- Image upload with mobile camera support

## Data Persistence

### LocalStorage Keys

- `businesses` - Array of all businesses
- `currentUser` - Updated with business association
- `mingla_onboarding_completed` - Set to 'true' after completion
- `platformCards` - Updated when first experience is created

### Business Object Structure

```typescript
{
  id: 'business-1234567890',
  ownerName: 'John Smith',
  ownerEmail: 'john@example.com',
  name: 'The Coffee Lab',
  legalName: 'The Coffee Lab',
  type: 'llc',
  category: 'cafe',
  description: '...',
  contactInfo: { ... },
  location: { ... },
  operatingHours: { ... },
  media: { logo, coverImage, photos },
  verification: { status, termsAccepted, termsAcceptedDate },
  onboarding: { completed, completedDate, firstExperienceCreated },
  createdAt: '2025-12-17T...',
  updatedAt: '2025-12-17T...'
}
```

## Testing

### Test Credentials

For testing, use the business test account:

```
Email: sunset.business@mingla.com
Password: Mingla2025!
Name: Sunset Wine Bar
```

### Test Flow

1. Sign in page → Click "Sign Up"
2. Select "Business" role
3. Complete all 8 onboarding steps
4. Verify business is created in localStorage
5. Verify first experience is created (if not skipped)
6. Verify redirect to business dashboard

## Future Enhancements

### Phase 1 (Current)
- ✅ Basic business profile setup
- ✅ Operating hours configuration
- ✅ Photo upload
- ✅ First experience creation

### Phase 2
- [ ] Business license/document upload
- [ ] Bank account connection for payouts
- [ ] Tax information collection
- [ ] Multiple business locations

### Phase 3
- [ ] Advanced verification (KYC)
- [ ] Integration with payment processors
- [ ] Multi-user business accounts
- [ ] Business analytics preview

## Support & Documentation

For more information, see:
- `/BUSINESS_USER_IMPLEMENTATION.md` - Complete production roadmap
- `/BUSINESS_COMPLETE_SYSTEM_GUIDE.md` - System architecture
- `/BUSINESS_SYSTEM_QUICK_START.md` - Quick start guide

## Troubleshooting

### Onboarding doesn't start
- Check that user role is 'business'
- Verify `hasCompletedOnboarding` is false
- Check AppStateManager configuration

### Photos not uploading
- Verify file size < 5MB
- Check file format (JPEG, PNG, WebP)
- Ensure FileReader API is supported

### Experience creation fails
- Check CardCreatorModal is properly imported
- Verify platformCards localStorage exists
- Check console for errors

### Data not persisting
- Verify localStorage is enabled
- Check browser storage quota
- Look for localStorage errors in console

## License

Proprietary - Mingla Platform © 2025
