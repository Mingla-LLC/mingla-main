# User Review System

## Overview
When a card's scheduled date and time elapse, the card is automatically archived and users are prompted to review their experience. This helps improve recommendations and provides valuable feedback for the platform.

## How It Works

### 1. Auto-Archive on Date Elapsed
- The system checks every minute for cards with elapsed dates (see `App.tsx` useEffect)
- When a card's `scheduledDate` and `scheduledTime` have passed, it's marked as `isArchived: true`
- The `archivedAt` timestamp is recorded

### 2. Review Prompt
- Immediately upon archiving, if the card doesn't already have a `userReview`, the `ReviewModal` is displayed
- Users can rate 1-5 stars (required) and optionally add a comment
- Users can also skip the review (submits with rating: 0)

### 3. Review Data Storage
The review is stored in the card object as:
```javascript
{
  userReview: {
    rating: 1-5,           // Number of stars
    comment: string,       // Optional user comment
    reviewedAt: ISO date,  // When review was submitted
    userId: string         // Username of reviewer
  }
}
```

### 4. Visibility & Access Control

#### Explorer Users (General Users)
- ✅ Can submit reviews via ReviewModal
- ❌ Cannot see their own or others' reviews
- Reviews are private feedback for platform improvement

#### QA Managers
- ✅ Can view all user reviews
- ✅ Reviews displayed in:
  - Card list view (compact format)
  - Detailed review modal (full format)
- Use reviews to:
  - Assess card quality
  - Make approval decisions
  - Identify cards needing improvement

#### Admins
- ✅ Can view all user reviews
- ✅ Reviews displayed in card management section
- Use reviews to:
  - Monitor platform quality
  - Identify trends
  - Make data-driven decisions
  - Train LLM for better recommendations

#### Curators & Content Managers
- ❌ Cannot see user reviews
- Their focus is on creating/editing content, not rating it

## Privacy Notice
All review modals include a privacy notice:
> 🔒 Your review helps improve recommendations and is only visible to platform administrators and QA managers.

## Future Enhancements
- Aggregate review scores for experiences
- LLM integration for sentiment analysis
- Review-based recommendation weighting
- Anonymous review option
- Review history and trends dashboard
