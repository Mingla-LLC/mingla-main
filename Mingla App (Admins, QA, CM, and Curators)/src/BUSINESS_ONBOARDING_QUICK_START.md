# Business Onboarding Quick Start Guide

## 🚀 Getting Started

This guide will help you test the complete business user onboarding experience in Mingla.

## 📋 Prerequisites

- Mingla app running locally or in development
- No business onboarding completed yet (fresh signup)

## 🎯 Test the Business Onboarding Flow

### Method 1: Sign Up as New Business

1. **Start at Sign In Page**
   - Click the "Sign Up" button
   - You'll see the role selection screen

2. **Select Business Role**
   - Click on the "Business" card
   - Credentials will auto-fill with test account:
     ```
     Email: sunset.business@mingla.com
     Password: Mingla2025!
     Name: Sunset Wine Bar
     ```

3. **Complete Onboarding Steps**

   The onboarding will guide you through 8 steps:

   **Step 0: Welcome** ✨
   - Pre-filled: First Name, Last Name, Email
   - Click "Get Started" to continue

   **Step 1: Business Information** 🏢
   - Business Name: "Sunset Wine Bar" (or customize)
   - Business Type: Select "LLC" (or your choice)
   - Business Category: Select "🍸 Bar & Nightlife"
   - Optional: Founding Year, Team Size, Description
   - Click "Continue"

   **Step 2: Contact Information** 📞
   - Phone: Enter "(555) 123-4567" (or any 10-digit number)
   - Address: "123 Main Street"
   - City: "San Francisco"
   - State: "CA"
   - ZIP: "94102"
   - Optional: Website, Social Media
   - Click "Continue"

   **Step 3: Operating Hours** ⏰
   - Default hours are Mon-Fri 9:00-17:00
   - Toggle days on/off as needed
   - Modify times by clicking the time fields
   - Use "Copy to all" to apply one day's hours to all
   - Click "Continue"

   **Step 4: Media & Photos** 📸
   - **Required:** Upload at least 1 photo
   - Click "Add your first photo" button
   - Select images from your computer
   - Optional: Upload logo and cover image
   - You can upload up to 15 photos
   - Click "Continue"

   **Step 5: Verification & Terms** ✅
   - Read the Business Partner Agreement
   - Check "I have read and agree to the Terms of Service" (required)
   - Optional: Check marketing consent
   - Click "Continue"

   **Step 6: First Experience** ✨
   - Click "Create Your First Experience"
   - This opens the CardCreatorModal
   - Fill out the experience details:
     - **Basic Info:** Name, categories, description
     - **Route & Timeline:** Location(s), duration
     - **Packages:** Pricing, availability
     - **Policies:** Cancellation, requirements
   - Click "Save" to create the experience
   - OR click "I'll do this later" to skip
   - Click "Continue"

   **Step 7: Completion** 🎉
   - Review your onboarding summary
   - Click "Edit" on any section to go back
   - Review "What happens next" information
   - Click "Go to Dashboard"

4. **Access Business Dashboard**
   - You'll be redirected to your business dashboard
   - You can now manage experiences, bookings, and revenue
   - Your business profile is saved in localStorage

## 🔄 Re-testing Onboarding

If you want to test the onboarding flow again:

### Clear Onboarding State

```javascript
// Open browser console (F12) and run:
localStorage.removeItem('mingla_onboarding_completed');
localStorage.removeItem('mingla_onboarding_data');
localStorage.setItem('mingla_user_role', 'business');
// Refresh the page
```

### Or Clear All Data

```javascript
// Clear everything (nuclear option):
localStorage.clear();
// Refresh and sign up again
```

## 📊 Verify Data Saved

After completing onboarding, check that data was saved:

```javascript
// Check business data
JSON.parse(localStorage.getItem('businesses') || '[]')

// Check current user
JSON.parse(localStorage.getItem('currentUser') || '{}')

// Check onboarding completed flag
localStorage.getItem('mingla_onboarding_completed') // Should be 'true'

// Check if first experience was created
JSON.parse(localStorage.getItem('platformCards') || '[]')
```

## 🎨 Customization Tips

### Change Business Information

Edit the default test credentials in `/components/SignInPage.tsx`:

```typescript
business: {
  email: 'your.business@mingla.com',
  password: 'YourPassword123!',
  name: 'Your Business Name',
  description: 'Manage your business experiences and revenue'
}
```

### Modify Business Categories

Edit categories in `/components/business-onboarding/constants.ts`:

```typescript
export const BUSINESS_CATEGORIES = [
  { value: 'restaurant', label: '🍽️ Restaurant & Dining' },
  { value: 'cafe', label: '☕ Café & Coffee Shop' },
  // Add your custom categories here
];
```

### Adjust Operating Hours Default

Edit default hours in `/components/business-onboarding/constants.ts`:

```typescript
export const DEFAULT_OPERATING_HOURS: OperatingHours = {
  monday: { isOpen: true, open: '10:00', close: '22:00' },
  // Customize other days...
};
```

## 🧪 Testing Scenarios

### Scenario 1: Happy Path
- Fill all required fields
- Upload 3-5 photos
- Create first experience
- Complete onboarding
- ✅ **Expected:** Redirect to business dashboard

### Scenario 2: Minimum Required Fields
- Fill only required fields (marked with *)
- Upload 1 photo
- Skip first experience creation
- Complete onboarding
- ✅ **Expected:** Redirect to business dashboard

### Scenario 3: Back and Edit
- Progress to Step 5
- Click "Back" to Step 3
- Modify operating hours
- Continue forward again
- ✅ **Expected:** Changes are preserved

### Scenario 4: Edit from Completion
- Complete all steps
- On completion screen, click "Edit" on Business Info
- Modify business name
- Return to completion
- ✅ **Expected:** Changes appear in summary

### Scenario 5: Skip Experience Creation
- Progress through all steps
- On Step 6, click "I'll do this later"
- Complete onboarding
- ✅ **Expected:** firstExperienceCreated is false

## 🐛 Common Issues

### Issue: Onboarding doesn't start
**Solution:** 
- Verify you selected "Business" role during signup
- Check that `mingla_onboarding_completed` is NOT set to 'true'
- Look for errors in browser console

### Issue: Can't proceed to next step
**Solution:**
- Check validation requirements for current step
- Required fields are marked with asterisk (*)
- Error messages will appear below invalid fields

### Issue: Photos won't upload
**Solution:**
- Check file size (max 5MB per image)
- Use JPG, PNG, or WebP format
- Try a different image
- Check browser console for errors

### Issue: Experience creator doesn't open
**Solution:**
- Ensure CardCreatorModal is properly loaded
- Check browser console for import errors
- Verify localStorage has 'platformCards' key

### Issue: Completion doesn't redirect
**Solution:**
- Check `handleOnboardingComplete` function is called
- Verify business data is saved to localStorage
- Look for routing errors in console

## 📸 Screenshots Reference

### Step Progression
```
Welcome (0) → Business Info (1) → Contact (2) → Hours (3) 
→ Media (4) → Terms (5) → Experience (6) → Complete (7)
```

### Progress Bar
```
[████████░░░░░░] 50% - Step 4 of 7 - Media
```

## 🎓 Best Practices

### For Testing
1. Test with realistic business data
2. Upload actual business photos for visual testing
3. Create a complete first experience to test full flow
4. Test all validation rules
5. Test back/forward navigation thoroughly

### For Development
1. Keep onboarding steps focused and simple
2. Provide clear validation messages
3. Allow users to skip optional steps
4. Save progress automatically
5. Make it easy to edit completed sections

## 📚 Related Documentation

- **Complete Implementation Guide:** `/BUSINESS_USER_IMPLEMENTATION.md`
- **Component Documentation:** `/components/business-onboarding/README.md`
- **Business System Guide:** `/BUSINESS_COMPLETE_SYSTEM_GUIDE.md`
- **General Quick Start:** `/BUSINESS_SYSTEM_QUICK_START.md`

## 🎯 Success Criteria

After completing onboarding, verify:

- ✅ Business profile created in localStorage
- ✅ Business ID assigned to current user
- ✅ Onboarding marked as completed
- ✅ Business dashboard accessible
- ✅ All required data fields saved
- ✅ Optional data saved if provided
- ✅ First experience created (if not skipped)

## 💡 Next Steps After Onboarding

Once onboarding is complete, businesses can:

1. **Create More Experiences**
   - Access CardCreatorModal from dashboard
   - Add multiple offerings

2. **Manage Business Profile**
   - Edit business information
   - Update operating hours
   - Add/remove photos

3. **Track Performance**
   - View bookings and revenue
   - Check analytics
   - Respond to reviews

4. **Set Up Payouts**
   - Configure bank account
   - Complete KYC verification
   - Start accepting payments

## 🆘 Support

If you encounter issues:

1. Check browser console for errors
2. Review this Quick Start Guide
3. Consult the main documentation
4. Clear localStorage and retry
5. File an issue with steps to reproduce

---

**Happy Testing! 🚀**

*Last Updated: December 17, 2025*
