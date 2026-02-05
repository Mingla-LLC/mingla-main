# Coach Mark System - Complete Guide

## Overview

The Mingla Explorer Coach Mark system provides a one-time, mobile-first, non-obstructive guided tour for new users. It highlights key features and educates users on the platform's core functionality.

## Features

✅ **One-time display** - Shows only once per user (stored in localStorage)
✅ **Mobile-optimized** - Fully responsive with gesture-friendly controls
✅ **Non-obstructive** - Semi-transparent overlay with spotlight highlighting
✅ **Skippable** - Users can skip at any point
✅ **Auto-triggers** - Starts automatically after onboarding completion
✅ **Manual trigger** - Help button allows users to replay the tour
✅ **Smooth animations** - Motion-powered transitions and effects

## Architecture

### Core Components

1. **CoachMarkProvider.tsx** - Context provider managing state and tour flow
2. **CoachMarkOverlay.tsx** - Main orchestrator rendering welcome screen and tour
3. **CoachMarkWelcome.tsx** - Initial welcome modal before tour starts
4. **CoachMarkSpotlight.tsx** - Highlighted ring around target elements
5. **CoachMarkTooltip.tsx** - Information cards with tour content
6. **CoachMarkProgress.tsx** - Visual progress dots (1/5, 2/5, etc.)
7. **CoachMarkTrigger.tsx** - Manual trigger button (help icon)

### Configuration Files

- **types.ts** - TypeScript interfaces and type definitions
- **coachMarkSteps.ts** - Tour step configurations and content
- **index.ts** - Barrel export for easy imports

## Tour Flow

### Step 0: Welcome Screen (Modal)
- Mingla logo
- "Welcome to Mingla! 👋"
- "Let's show you the essentials (takes 30 seconds)"
- Start Tour / Skip buttons

### Step 1: Preferences Button
- **Target**: Settings/Sliders icon (top-left)
- **Message**: "Set your vibe, budget, and location here"
- **Icon**: ⚙️

### Step 2: Collaboration Mode
- **Target**: Collaborate button (top-right)
- **Message**: "Plan with friends in real-time"
- **Icon**: 👥

### Step 3: Swipeable Cards
- **Target**: Main card display area
- **Message**: "Swipe right to save, left to pass"
- **Icon**: 👈👉

### Step 4: Activity Navigation
- **Target**: Activity tab (sidebar or bottom nav)
- **Message**: "Saved & scheduled experiences live here"
- **Icon**: 📅

### Step 5: Connections Navigation
- **Target**: Connections tab
- **Message**: "Manage friends & collaboration invites"
- **Icon**: 🤝
- **Final step**: Shows "Finish" button instead of "Next"

## Implementation Guide

### 1. Add CoachMark Provider to App

```tsx
import CoachMarkProvider from './components/CoachMark/CoachMarkProvider';
import CoachMarkOverlay from './components/CoachMark/CoachMarkOverlay';
import CoachMarkTrigger from './components/CoachMark/CoachMarkTrigger';

// Wrap your app content
<CoachMarkProvider 
  autoStart={hasCompletedOnboarding}
  onComplete={() => {
    toast.success("You're all set! 🎉");
  }}
>
  <CoachMarkOverlay />
  {/* Your app content */}
  <CoachMarkTrigger /> {/* Optional manual trigger */}
</CoachMarkProvider>
```

### 2. Add Data Attributes to Target Elements

Each highlighted element needs a `data-coachmark` attribute:

```tsx
{/* Preferences Button */}
<button data-coachmark="preferences-button">
  <SlidersHorizontal />
</button>

{/* Collaboration Button */}
<button data-coachmark="mode-switcher">
  <Users /> Collaborate
</button>

{/* Swipeable Cards Container */}
<main data-coachmark="swipeable-cards-container">
  <SwipeableCards />
</main>

{/* Activity Navigation */}
<button data-coachmark="nav-activity">
  <Calendar /> Activity
</button>

{/* Connections Navigation */}
<button data-coachmark="nav-connections">
  <Users /> Connections
</button>
```

### 3. Add Toast Support (Optional)

```tsx
import { Toaster } from './components/ui/sonner';

// In your app
<Toaster />
```

## Usage Examples

### Auto-start after Onboarding

```tsx
<CoachMarkProvider 
  autoStart={hasCompletedOnboarding && !isLoadingOnboarding}
>
  {/* ... */}
</CoachMarkProvider>
```

### Manual Trigger from Code

```tsx
import { useCoachMark } from './components/CoachMark';

function MyComponent() {
  const { startTour } = useCoachMark();
  
  return (
    <button onClick={startTour}>
      Show Tour
    </button>
  );
}
```

### Reset Tour for Testing

```tsx
// Clear localStorage and restart
localStorage.removeItem('mingla_coachmark_v1');
startTour();
```

## Customization

### Update Tour Steps

Edit `/components/CoachMark/coachMarkSteps.ts`:

```typescript
export const coachMarkSteps: CoachMarkStep[] = [
  {
    id: 'my-feature',
    title: 'Check out this feature!',
    description: 'Here\'s how it works',
    icon: '✨',
    targetRef: 'my-element-ref',
    position: 'bottom',
    spotlightShape: 'rectangle',
    spotlightPadding: 12
  },
  // ... more steps
];
```

### Adjust Styling

**Spotlight Color:**
```tsx
// In CoachMarkSpotlight.tsx
border: '3px solid #YOUR_COLOR',
boxShadow: '0 0 0 4px rgba(YOUR_RGB, 0.3)'
```

**Tooltip Styling:**
```tsx
// In CoachMarkTooltip.tsx
className="bg-white rounded-2xl shadow-2xl"
```

**Progress Dots:**
```tsx
// In CoachMarkProgress.tsx
backgroundColor: index === current ? '#eb7825' : '#e5e7eb'
```

### Change Positioning Logic

Edit tooltip position calculation in `CoachMarkTooltip.tsx`:

```typescript
switch (step.position) {
  case 'bottom':
    // Customize bottom positioning
    break;
  case 'top':
    // Customize top positioning
    break;
  // ... etc
}
```

## Browser Compatibility

- ✅ Modern browsers (Chrome, Safari, Firefox, Edge)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)
- ✅ Responsive breakpoints (mobile, tablet, desktop)
- ✅ Touch and mouse interactions
- ✅ Keyboard navigation (Tab, Enter, Esc)

## Accessibility

- **Focus Management**: Focus trapped within tour during playback
- **Screen Readers**: Announces step number and total ("Step 1 of 5")
- **Keyboard Support**: 
  - `Tab`: Focus buttons
  - `Enter`: Activate button
  - `Esc`: Skip tour
- **Color Contrast**: WCAG AA compliant (4.5:1 ratio)
- **Reduced Motion**: Respects `prefers-reduced-motion` setting

## Storage

**Key**: `mingla_coachmark_v1`
**Value**: `'completed'`
**Location**: `localStorage`

To version the tour (force replay):
1. Change `COACH_MARK_VERSION` in `coachMarkSteps.ts`
2. Update `COACH_MARK_STORAGE_KEY` to match new version
3. Old version will be ignored, tour will replay

## Troubleshooting

### Tour Not Showing
1. Check `autoStart` prop is true
2. Verify `hasCompletedOnboarding` state
3. Check localStorage: `localStorage.getItem('mingla_coachmark_v1')`
4. Clear storage to test: `localStorage.removeItem('mingla_coachmark_v1')`

### Spotlight Not Highlighting Correctly
1. Verify `data-coachmark` attribute matches `targetRef` in steps
2. Check element is visible and rendered
3. Inspect console for warnings
4. Try adjusting `spotlightPadding` in step config

### Tooltip Positioning Issues
1. Check screen size and responsive breakpoints
2. Adjust position in step config (`top`, `bottom`, `left`, `right`)
3. Verify tooltip doesn't overflow viewport
4. Test on actual device, not just dev tools

### Tour Stuck on Step
1. Check browser console for errors
2. Verify all navigation elements are rendered
3. Ensure `data-coachmark` attributes are present
4. Try manual navigation using trigger button

## Testing Checklist

- [ ] Tour shows on first visit after onboarding
- [ ] Welcome screen displays correctly
- [ ] All 5 steps highlight correct elements
- [ ] Spotlight follows element on scroll/resize
- [ ] Tooltip positions correctly on all screen sizes
- [ ] Progress dots update correctly
- [ ] Skip button works at any step
- [ ] Finish button completes tour
- [ ] Toast notification shows on completion
- [ ] Tour doesn't show again after completion
- [ ] Manual trigger button works
- [ ] Mobile gestures work (touch/swipe)
- [ ] Desktop keyboard navigation works
- [ ] Tour respects reduced motion preference

## Future Enhancements

- [ ] Add gesture animations (swipe demo on cards)
- [ ] Multi-language support
- [ ] Analytics tracking (completion rate, dropout points)
- [ ] A/B testing different copy/flows
- [ ] Video demonstrations in tooltips
- [ ] Interactive mini-challenges
- [ ] Role-specific tours (Curator, Business, etc.)
- [ ] Advanced tour builder UI for admins

## Support

For questions or issues with the Coach Mark system, check:
1. This README
2. Component TypeScript interfaces in `types.ts`
3. Step configurations in `coachMarkSteps.ts`
4. Browser console for warnings/errors

---

**Version**: 1.0  
**Last Updated**: 2025-10-23  
**Maintainer**: Mingla Development Team
