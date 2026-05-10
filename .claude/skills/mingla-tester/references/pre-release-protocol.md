# Pre-Release Protocol — Platform Submission Audit

Full audit before TestFlight or Google Play submission.

---

## Step 1 — Run Full TARGETED Mode
Execute all 10 steps of the targeted protocol for every changed file since last release.

---

## Step 2 — iOS Compliance

### Crashes & Performance (most common rejection)
- [ ] No crash on launch (cold start, warm start, background resume)
- [ ] Handles network failure (airplane mode, slow 3G)
- [ ] Handles auth token expiry mid-session
- [ ] Handles Supabase downtime (error states, not infinite spinners)
- [ ] Handles push notification for deleted content
- [ ] No memory leaks on repeated navigation
- [ ] Loads within 3s on WiFi
- [ ] No excessive battery drain (location, background tasks)

### Privacy & Data (second most common)
- [ ] Privacy manifest (PrivacyInfo.xcprivacy) accurate and complete
- [ ] All NSUsageDescription keys present in Info.plist
- [ ] Location: "When In Use" not "Always" (unless justified)
- [ ] ATT prompt before any tracking
- [ ] Data collection matches App Store privacy nutrition labels
- [ ] Account deletion available (Apple requirement)
- [ ] Sign in with Apple offered alongside Google Sign-In

### Design & UI
- [ ] Works on all device sizes (SE, mini, standard, Plus, Max)
- [ ] iPad layout works (or iPad excluded from build)
- [ ] Dynamic Type supported
- [ ] Safe area insets on all screens (notch, Dynamic Island, home bar)
- [ ] No broken landscape layouts (or landscape locked)
- [ ] Dark mode: fully supported or properly disabled
- [ ] Launch screen matches first screen
- [ ] Screenshots match actual behavior

### Payments
- [ ] In-app purchases via RevenueCat/StoreKit (no direct Stripe for digital)
- [ ] Subscription terms displayed before purchase
- [ ] Restore purchases button accessible
- [ ] Free trial terms explicit
- [ ] Subscription management links to iOS settings

### Content & Legal
- [ ] Age rating accurate
- [ ] Terms of service + privacy policy accessible in-app
- [ ] No placeholder content visible
- [ ] No references to other platforms

---

## Step 3 — Android Compliance

### Crashes & ANR
- [ ] No crash on launch (cold, warm, background)
- [ ] No ANR (no main thread blocking > 5s)
- [ ] Hardware back button works on every screen
- [ ] Handles task killer / low memory
- [ ] Android 13+ notification permission requested
- [ ] Android 14+ foreground service declarations

### Privacy & Permissions
- [ ] Data Safety section matches actual collection
- [ ] All permissions declared in AndroidManifest
- [ ] No unnecessary permissions
- [ ] Runtime permissions at point of use, not on launch
- [ ] Location: "While Using" before "Always"

### Compatibility
- [ ] Works on Android 10+ (API 29+)
- [ ] Works on different screen densities
- [ ] Works on phone, tablet, foldable
- [ ] Keyboard doesn't overlap inputs
- [ ] No hardcoded pixel values
- [ ] Map fallback for devices without Google Play Services

### Billing & Store
- [ ] Google Play Billing for digital goods
- [ ] Target API level meets requirements (API 34+)
- [ ] 64-bit libraries included
- [ ] App bundle (AAB) not APK

---

## Step 4 — Performance Audit

- [ ] Cold start < 3s on mid-range device
- [ ] Screen transitions < 300ms
- [ ] List scrolling 60fps (FlatList/FlashList)
- [ ] No unnecessary re-renders
- [ ] Images optimized (no 4K thumbnails)
- [ ] Bundle size: no accidentally imported large libraries
- [ ] No query waterfalls (parallel where possible)
- [ ] Session load: parallel phases per contract
- [ ] No memory leaks: subscriptions cleanup on unmount
- [ ] Persisted state loads before network (Constitution #14)

---

## Step 5 — Accessibility Audit

- [ ] VoiceOver (iOS) navigates all screens correctly
- [ ] TalkBack (Android) navigates all screens correctly
- [ ] Dynamic Type scales text to 200% without breaking layout
- [ ] Color contrast WCAG 2.1 AA (4.5:1 text, 3:1 large)
- [ ] Information not conveyed by color alone
- [ ] Animations respect "reduce motion"
- [ ] All interactive elements have accessibility labels
- [ ] Focus order is logical
