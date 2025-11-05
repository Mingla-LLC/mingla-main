# Phone Signup Setup Instructions

## Overview

This document outlines the phone signup feature implementation and required Supabase configuration.

## What Has Been Implemented

### 1. Components Created

- **PhoneSignUpForm** (`app-mobile/src/components/signIn/PhoneSignUpForm.tsx`)

  - Phone number input with country code picker
  - Username field with availability checking
  - Password field
  - Form validation

- **OTPScreen** (`app-mobile/src/components/signIn/OTPScreen.tsx`)

  - 6-digit OTP input
  - Auto-verification when complete
  - Resend OTP functionality with 5-minute timer
  - Error handling

- **Country Codes Utility** (`app-mobile/src/utils/countryCodes.ts`)
  - List of countries with flags and dial codes
  - Phone number formatting and validation

### 2. Database Changes

#### Migration: `20250126000012_add_phone_to_profiles.sql`

- Adds `phone` column to `profiles` table
- Creates index on phone for faster lookups

#### Updated Migration: `20250126000010_auto_create_profile.sql`

- Updated trigger to handle both email and phone-based users
- Auto-confirms phone numbers
- Creates profiles with phone number support

### 3. Code Updates

- **useAuthSimple.ts**: Added `signUpWithPhone`, `verifyPhoneOTP`, `resendPhoneOTP`
- **OnboardingFlow.tsx**: Integrated phone signup flow
- **AccountSetupStep.tsx**: Added navigation to phone signup

## Required Supabase Dashboard Configuration

### 1. Enable Phone Authentication

1. Go to Supabase Dashboard → Authentication → Providers
2. Find "Phone" provider
3. Enable it

### 2. Configure OTP Settings

1. Go to Authentication → Settings
2. Find "OTP Settings" or "Phone Auth Settings"
3. Set OTP expiration to **5 minutes (300 seconds)**
   - Note: This might be in "SMS OTP Expiry" or similar setting
   - If you can't find this setting, it might require Supabase CLI or API access

### 3. Configure SMS Provider (Required for Production)

Supabase requires an SMS provider for phone authentication:

- **Twilio** (recommended)
- **MessageBird**
- **Vonage**

In development/testing, Supabase provides a default provider, but for production you'll need to configure one.

### 4. Database Migrations

Run these SQL migrations in order:

1. `20250126000012_add_phone_to_profiles.sql` - Adds phone column
2. `20250126000010_auto_create_profile.sql` - Updates trigger function

## Testing the Flow

1. User clicks "Continue with Phone" on AccountSetupStep
2. PhoneSignUpForm appears with:
   - Country code picker
   - Phone number input
   - Username input (with availability check)
   - Password input
3. After clicking "Sign Up", OTP is sent to phone
4. OTPScreen appears for OTP entry
5. After successful verification, user continues with onboarding

## Important Notes

1. **Password Storage**: Passwords are temporarily stored in user metadata and set after OTP verification. This is because Supabase phone auth is typically passwordless, but we're adding password support per your requirements.

2. **OTP Expiration**: The 5-minute expiration is handled in the OTP component's timer. However, the actual expiration is controlled by Supabase's settings. Make sure to configure this in the dashboard.

3. **Development vs Production**:

   - Development: Supabase provides test OTP codes
   - Production: Requires SMS provider setup

4. **Phone Number Format**: Phone numbers are stored with country code (e.g., +1234567890)

## Next Steps

1. **Enable Phone Auth in Supabase Dashboard**
2. **Run the database migrations**
3. **Configure OTP expiration to 5 minutes**
4. **Set up SMS provider for production**
5. **Test the complete flow**

## Troubleshooting

- If OTP is not received: Check SMS provider configuration
- If profile creation fails: Check that the trigger function is updated
- If username shows as taken: Check username validation logic
