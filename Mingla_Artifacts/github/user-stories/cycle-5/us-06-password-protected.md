**As an** organiser
**I need** to mark a ticket as "Password protected"
**So that** only buyers who know the password can purchase it (used for industry comps, friends-and-family pricing, etc.).

### Details and Assumptions
* `password_protected: true` flag + a `password` field captured in the sheet.
* Password is stored locally in the draft; hashing/encryption happens server-side at B4.
* On the public event page (Cycle 6), the buyer enters the password to unlock the ticket.
* This cycle only captures + persists; no real verification yet.

### Acceptance Criteria

```gherkin
Given I'm editing a ticket type
When I select "Password protected" from the type segmented control
Then a password input field appears in the sheet with min-4-character validation

Given I'm setting up a password-protected ticket
When the password is fewer than 4 characters
Then a helper error "Password must be at least 4 characters" shows and Save is disabled

Given a password-protected ticket has been saved
When I view Step 7 mini-card preview
Then the ticket card shows a "Password required" badge

Given a password-protected ticket has been saved
When I edit it again later
Then the sheet pre-fills with the saved password (shown as masked dots, with a "Show" toggle)
```
