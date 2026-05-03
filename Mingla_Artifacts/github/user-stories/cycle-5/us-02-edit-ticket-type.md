**As an** organiser
**I need** to edit a ticket type I've already added (change price, capacity, sale window, type, etc.)
**So that** I can adjust pricing or rules without deleting and recreating the ticket.

### Details and Assumptions
* Editing reuses the same sheet as Add (pre-filled).
* Cycle 3 already wired the edit-pencil → sheet-pre-fill pattern — extend it to cover the new fields from US-01.
* Changing type may invalidate fields (e.g. switching "Password" → "Approval" should clear the password field). Provide a confirm dialog if the change would lose data.

### Acceptance Criteria

```gherkin
Given my event has at least one ticket type
When I tap the edit pencil on a ticket card
Then the same sheet opens pre-filled with the existing ticket's values

Given I'm editing a ticket and have changed name + price
When I tap "Save changes"
Then the ticket card updates immediately and the draft persists across re-open

Given I'm editing a "Password" ticket and switch the type to "General"
When I tap Save
Then a ConfirmDialog "You'll lose the password — continue?" appears; tapping Confirm clears the password field, tapping Cancel keeps the type as Password

Given I'm editing any ticket
When I close the sheet via the chrome X without saving
Then no changes persist
```
