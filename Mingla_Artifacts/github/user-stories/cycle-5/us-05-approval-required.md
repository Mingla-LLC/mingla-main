**As an** organiser running a curated event (e.g. private dinner, member-only night)
**I need** to mark a ticket type as "Approval required"
**So that** buyers submit a request, I review it, and only approved buyers complete checkout.

### Details and Assumptions
* `approval_required: true` flag on the ticket type.
* UI for the buyer-side approval submit + organiser-side approval queue lands Cycle 10 (Guests). Cycle 5 only ships the toggle + helper copy + Preview indication.
* Organiser-side queue + approve/reject actions wire backend in B4.

### Acceptance Criteria

```gherkin
Given I'm editing a ticket type
When I select "Approval required" from the type segmented control
Then the sheet shows a helper "Buyers will submit a request. You approve or reject before they pay." and saves `approval_required: true`

Given a ticket has approval_required = true
When I view Step 7 mini-card preview
Then the ticket card shows a "Approval required" badge below price

Given a ticket has approval_required = true
When I navigate to PreviewEventView (the in-app preview of the public page)
Then the public preview shows "Request access" instead of "Buy ticket" and a footer note "You'll get an email once approved"
```
