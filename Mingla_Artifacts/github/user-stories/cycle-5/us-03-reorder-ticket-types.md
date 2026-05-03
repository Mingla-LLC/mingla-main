**As an** organiser
**I need** to reorder my ticket types via drag-and-drop
**So that** the order I want buyers to see them in is the order they appear on the public event page.

### Details and Assumptions
* Order persists via a `display_order: number` field on each ticket in the draft.
* Implementation: react-native-reanimated's `Reorderable` pattern OR a custom hold-and-drag handle row. Pick at /ui-ux-pro-max kickoff.
* Order also affects Step 7 mini-card preview rendering.

### Acceptance Criteria

```gherkin
Given my event has 3 ticket types in order [Early Bird, GA, VIP]
When I drag VIP above GA
Then the list re-renders as [Early Bird, VIP, GA] with smooth animation

Given I've reordered ticket types
When I close the wizard and re-open the draft from Events tab
Then the list still shows the new order [Early Bird, VIP, GA]

Given I've reordered ticket types
When I view Step 7 (Preview)
Then the public mini-card preview renders the tickets in the new order

Given I'm dragging a ticket
When I drop it in the same position it started
Then no ConfirmDialog fires and no animation jitters
```
