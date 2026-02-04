# Story 1: Experience Type Selection & Card Filtering

**Story ID:** PREF-001  
**Priority:** High  
**Effort:** 3 Story Points  
**Dependencies:** None (foundational story)

---

## User Story

**As an** Explorer  
**I need** to select one or more Experience Types (Solo Adventure, First Date, Romantic, Friendly, Group Fun, Business)  
**So that** the generated cards match the vibe and social context I'm planning for

---

## Details and Assumptions

- Experience Types are **multi-select** (0 to 6 selections possible)
- Each card in database has `experienceTypes: string[]` field
- **OR logic** within selections: card matches if it has ANY selected type
- When NO types selected: ALL cards shown (no filter applied)
- Visual selection state: selected pills show Mingla orange background (#eb7825) with white text
- Unselected pills show white background with gray border and gray text
- Each pill displays icon + label
- Selection affects which Categories are available (see Story 2)
- Selection state persists during session until Reset

---

## Experience Type Definitions

| ID | Label | Icon | Typical Use Case | Associated Categories |
|---|---|---|---|---|
| `soloAdventure` | Solo Adventure | Star | Individual exploration, personal time | All 10 categories |
| `firstDate` | First Date | Heart | Meeting someone new, low-pressure | stroll, sipChill, picnics, screenRelax, creative, playMove, diningExp |
| `romantic` | Romantic | Heart | Established relationships, special occasions | sipChill, picnics, diningExp, wellness |
| `friendly` | Friendly | Users | Hanging out with friends | All 10 categories |
| `groupFun` | Group Fun | Users | 3+ people, parties, celebrations | playMove, creative, casualEats, screenRelax, freestyle |
| `business` | Business | Target | Professional networking, client meetings | stroll, sipChill, diningExp |

---

## Card Data Structure

```typescript
interface Card {
  id: string;
  title: string;
  experienceTypes: string[]; // e.g., ['romantic', 'firstDate', 'friendly']
  categories: string[];
  pricePerPerson: number;
  // ... other fields
}
```

---

## Acceptance Criteria - Basic Functionality

### AC1.1: Initial State - No Selection
**Given** an Explorer opens the Preferences Sheet  
**When** the Experience Type section is displayed  
**Then** all 6 experience type pills are visible  
**And** NO pills are selected (all show white background)  
**And** the section header shows "Experience Type"  
**And** the section subtitle shows "Date Idea / Friends / Romantic / Solo Adventure"  
**And** NO selection badge is displayed

---

### AC1.2: Single Selection
**Given** an Explorer views the Experience Type section  
**When** they tap on "Romantic"  
**Then** the "Romantic" pill changes to orange background (#eb7825) with white text  
**And** the Heart icon changes to white  
**And** the pill border changes to orange  
**And** a subtle shadow/elevation effect appears  
**And** NO other pills are affected  
**And** haptic feedback fires (medium impact)

---

### AC1.3: Multiple Selections
**Given** an Explorer has already selected "Romantic"  
**When** they tap "First Date"  
**Then** both "Romantic" AND "First Date" pills show selected state  
**And** all other pills remain unselected  
**And** haptic feedback fires for the new selection  
**And** both selections are stored in state array: `['romantic', 'firstDate']`

---

### AC1.4: Deselection
**Given** an Explorer has selected "Romantic" and "First Date"  
**When** they tap "Romantic" again  
**Then** "Romantic" pill returns to unselected state (white background, gray border)  
**And** "First Date" remains selected  
**And** haptic feedback fires (light impact)  
**And** state updates to: `['firstDate']`

---

### AC1.5: Select All Then Deselect All
**Given** an Explorer has selected all 6 experience types  
**When** they tap each pill to deselect all  
**Then** all pills return to unselected state  
**And** state becomes empty array: `[]`  
**And** NO selection badge appears

---

## Acceptance Criteria - Card Filtering Logic

### AC1.6: No Selection = No Filter
**Given** an Explorer has NOT selected any Experience Type  
**When** cards are generated  
**Then** NO experience type filtering is applied  
**And** cards with ANY experience type are included in results  
**And** console logs: "Experience Type filter: SKIPPED (no selection)"

**Test Data:**
- Card A: `experienceTypes: ['romantic']` → INCLUDED ✅
- Card B: `experienceTypes: ['business']` → INCLUDED ✅
- Card C: `experienceTypes: ['soloAdventure']` → INCLUDED ✅
- Card D: `experienceTypes: []` → INCLUDED ✅ (even empty array)

---

### AC1.7: Single Selection Filter
**Given** an Explorer has selected only "Romantic"  
**When** cards are generated  
**Then** ONLY cards with "romantic" in their `experienceTypes` array are included  
**And** console logs: "Experience Type filter: 'romantic' (X cards match)"

**Test Data:**
- Card A: `experienceTypes: ['romantic']` → INCLUDED ✅
- Card B: `experienceTypes: ['romantic', 'firstDate']` → INCLUDED ✅
- Card C: `experienceTypes: ['firstDate']` → EXCLUDED ❌
- Card D: `experienceTypes: ['business', 'friendly']` → EXCLUDED ❌
- Card E: `experienceTypes: []` → EXCLUDED ❌
- Card F: `experienceTypes: ['Romantic']` (capital R) → EXCLUDED ❌ (case-sensitive)

---

### AC1.8: Multiple Selection Filter (OR Logic)
**Given** an Explorer has selected "Romantic" AND "Business"  
**When** cards are generated  
**Then** cards matching EITHER "romantic" OR "business" are included  
**And** console logs: "Experience Type filter: 'romantic', 'business' (X cards match)"

**Test Data:**
- Card A: `experienceTypes: ['romantic']` → INCLUDED ✅ (has romantic)
- Card B: `experienceTypes: ['business']` → INCLUDED ✅ (has business)
- Card C: `experienceTypes: ['romantic', 'business']` → INCLUDED ✅ (has both)
- Card D: `experienceTypes: ['friendly']` → EXCLUDED ❌ (has neither)
- Card E: `experienceTypes: ['romantic', 'friendly']` → INCLUDED ✅ (has romantic)
- Card F: `experienceTypes: ['business', 'firstDate']` → INCLUDED ✅ (has business)
- Card G: `experienceTypes: ['firstDate', 'groupFun']` → EXCLUDED ❌ (has neither)

---

### AC1.9: All Six Types Selected
**Given** an Explorer has selected all 6 experience types  
**When** cards are generated  
**Then** the filter effectively becomes "show all cards" (equivalent to no selection)  
**And** cards with ANY experience type are included  
**And** console logs: "Experience Type filter: ALL TYPES (showing all cards)"

**Test Data:**
- Card A: `experienceTypes: ['romantic']` → INCLUDED ✅
- Card B: `experienceTypes: ['business', 'groupFun']` → INCLUDED ✅
- Card C: `experienceTypes: []` → EXCLUDED ❌ (has no types)

---

## Acceptance Criteria - Impact on Categories Section

### AC1.10: Category Filtering When Experience Type Selected
**Given** an Explorer selects "Romantic"  
**When** the Categories section updates  
**Then** ONLY these 4 categories are shown: Sip & Chill, Picnics, Dining Experiences, Wellness Dates  
**And** an orange badge shows "4 of 10"  
**And** helper text shows "Filtered by your selected experience types"  
**And** any previously selected categories NOT in this list are auto-deselected

---

### AC1.11: Auto-Deselect Invalid Categories
**Given** an Explorer has selected "Friendly" (shows all 10 categories)  
**And** has selected "Casual Eats" category  
**When** they deselect "Friendly" and select only "Romantic" (which doesn't support Casual Eats)  
**Then** "Casual Eats" is automatically removed from selected categories  
**And** the green "Selected" badge in Categories section updates  
**And** NO error message is shown (silent auto-correction)

---

### AC1.12: Expand Categories When Adding More Types
**Given** an Explorer has selected "Romantic" (4 categories available)  
**When** they also select "Group Fun"  
**Then** all categories supported by EITHER type are shown  
**And** the combined set includes: sipChill, picnics, diningExp, wellness (from Romantic) + playMove, creative, casualEats, screenRelax, freestyle (from Group Fun)  
**And** badge shows "9 of 10" (all except stroll)

---

## Acceptance Criteria - Edge Cases & Error Handling

### AC1.13: Malformed Card Data - Null experienceTypes
**Given** a card in the database has `experienceTypes: null`  
**When** filtering is applied  
**Then** the card is treated as having an empty array `[]`  
**And** the card is EXCLUDED when any experience type is selected  
**And** the card is INCLUDED when no experience type is selected  
**And** an error is logged: "Warning: Card {id} has null experienceTypes, treating as empty array"

---

### AC1.14: Malformed Card Data - Undefined experienceTypes
**Given** a card in the database has no `experienceTypes` field  
**When** filtering is applied  
**Then** the card is treated as having an empty array `[]`  
**And** the same behavior as AC1.13 applies  
**And** an error is logged: "Warning: Card {id} missing experienceTypes field"

---

### AC1.15: Malformed Card Data - String Instead of Array
**Given** a card in the database has `experienceTypes: 'romantic'` (string instead of array)  
**When** filtering is applied  
**Then** the system converts it to an array: `['romantic']`  
**And** filtering proceeds normally  
**And** a warning is logged: "Warning: Card {id} has string experienceTypes, expected array"

---

### AC1.16: Case Sensitivity Mismatch
**Given** a card has `experienceTypes: ['Romantic']` (capital R)  
**And** the filter expects lowercase `'romantic'`  
**When** filtering is applied  
**Then** the card is EXCLUDED (strict case-sensitive matching)  
**And** an error is logged: "Warning: Card {id} has invalid experienceType 'Romantic' (expected lowercase)"

---

### AC1.17: Unknown Experience Type in Card Data
**Given** a card has `experienceTypes: ['romantic', 'unknown_type']`  
**When** filtering by "Romantic"  
**Then** the card is INCLUDED (matches 'romantic')  
**And** a warning is logged: "Warning: Card {id} has unknown experienceType 'unknown_type'"

---

## Acceptance Criteria - Visual & Interactive States

### AC1.18: Pill Hover State (Web/Tablet with Pointer)
**Given** the app is running on a device with pointer (tablet with mouse)  
**When** the user hovers over an unselected pill  
**Then** the pill shows hover state: border changes to orange-300, background to orange-50  
**And** cursor changes to pointer  
**And** transition animation is smooth (200ms)

---

### AC1.19: Pill Active/Press State
**Given** an Explorer presses down on a pill (touch start)  
**When** the touch is active  
**Then** the pill scales down slightly (0.95 scale)  
**And** opacity reduces to 0.8  
**And** when touch is released, pill returns to normal scale  
**And** selection state toggles

---

### AC1.20: Disabled State (Future Enhancement)
**Given** a pill needs to be disabled for business logic reasons  
**When** the pill is in disabled state  
**Then** opacity is reduced to 0.5  
**And** the pill cannot be tapped  
**And** cursor shows not-allowed icon  
**And** haptic feedback does NOT fire

---

### AC1.21: Responsive Layout - Mobile (320px width)
**Given** the app is displayed on a small mobile device (320px width)  
**When** the Experience Type section is rendered  
**Then** pills wrap to multiple rows as needed  
**And** each pill maintains minimum touch target of 44x44 pixels  
**And** gap between pills is at least 12px (1.5 rem)  
**And** text does NOT truncate

---

### AC1.22: Responsive Layout - Tablet (768px+ width)
**Given** the app is displayed on a tablet  
**When** the Experience Type section is rendered  
**Then** pills may display in fewer rows (possibly single row if space allows)  
**And** pill size increases according to responsive design (larger text, more padding)  
**And** gaps increase proportionally

---

## Acceptance Criteria - Accessibility

### AC1.23: Screen Reader Support
**Given** an Explorer is using a screen reader  
**When** they navigate to an Experience Type pill  
**Then** the screen reader announces: "{Label}, button, {selected/not selected}"  
**Example:** "Romantic, button, selected"  
**And** the role is set to "button"  
**And** aria-pressed is true when selected, false when not selected

---

### AC1.24: Keyboard Navigation
**Given** an Explorer is using keyboard navigation  
**When** they tab to the Experience Type section  
**Then** focus moves to the first pill  
**And** pressing Tab moves focus to the next pill  
**And** pressing Shift+Tab moves focus to previous pill  
**And** pressing Space or Enter toggles selection  
**And** focus indicator is clearly visible (2px outline)

---

### AC1.25: Voice Control
**Given** an Explorer is using voice control (Voice Access on Android)  
**When** they say "Tap Romantic"  
**Then** the Romantic pill toggles selection  
**And** voice feedback confirms: "Romantic selected" or "Romantic deselected"

---

## Acceptance Criteria - State Persistence & Reset

### AC1.26: State Persistence During Session
**Given** an Explorer selects "Romantic" and "First Date"  
**When** they scroll down to other sections and back up  
**Then** "Romantic" and "First Date" remain selected  
**And** selection state is preserved in component state

---

### AC1.27: Reset Functionality
**Given** an Explorer has selected "Romantic", "Business", and "Friendly"  
**When** they tap the "Reset" button at bottom of Preferences Sheet  
**Then** all Experience Type selections are cleared  
**And** all pills return to unselected state  
**And** the selection count in Apply button decreases by 3

---

### AC1.28: State After Applying Preferences
**Given** an Explorer selects "Romantic", applies preferences, and closes the sheet  
**When** they re-open the Preferences Sheet  
**Then** "Romantic" is still selected (state persisted from last application)  
**And** they can modify the selection

---

## Acceptance Criteria - Performance

### AC1.29: Selection Performance
**Given** an Explorer rapidly taps multiple pills  
**When** they toggle selections  
**Then** each tap responds within 50ms  
**And** UI updates smoothly without lag  
**And** no race conditions occur (all taps register correctly)

---

### AC1.30: Filtering Performance
**Given** a dataset of 1000 cards  
**When** Experience Type filter is applied with 2 types selected  
**Then** filtering completes within 100ms  
**And** console shows timing log: "Experience Type filter: 234ms"

---

## Technical Implementation

### State Management

```typescript
import { useState } from 'react';

const [selectedExperiences, setSelectedExperiences] = useState<string[]>([]);

const handleExperienceToggle = (id: string) => {
  setSelectedExperiences(prev => {
    const newSelection = prev.includes(id) 
      ? prev.filter(x => x !== id) 
      : [...prev, id];
    
    // When experience types change, remove invalid categories
    if (newSelection.length > 0) {
      const experienceTypeFilters: Record<string, string[]> = {
        soloAdventure: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'],
        firstDate: ['stroll', 'sipChill', 'picnics', 'screenRelax', 'creative', 'playMove', 'diningExp'],
        romantic: ['sipChill', 'picnics', 'diningExp', 'wellness'],
        friendly: ['stroll', 'sipChill', 'casualEats', 'screenRelax', 'creative', 'picnics', 'playMove', 'diningExp', 'wellness', 'freestyle'],
        groupFun: ['playMove', 'creative', 'casualEats', 'screenRelax', 'freestyle'],
        business: ['stroll', 'sipChill', 'diningExp']
      };

      const relevantCategoryIds = new Set<string>();
      newSelection.forEach(expType => {
        const categoryIds = experienceTypeFilters[expType] || [];
        categoryIds.forEach(catId => relevantCategoryIds.add(catId));
      });

      setSelectedCategories(prevCategories => 
        prevCategories.filter(catId => relevantCategoryIds.has(catId))
      );
    }
    
    return newSelection;
  });
};
```

### Filtering Function

```typescript
const filterByExperienceType = (
  cards: Card[], 
  selectedExperienceTypes: string[]
): Card[] => {
  if (selectedExperienceTypes.length === 0) {
    console.log('Experience Type filter: SKIPPED (no selection)');
    return cards;
  }
  
  const filtered = cards.filter(card => {
    // Handle malformed data
    if (!card.experienceTypes) {
      console.warn(`Warning: Card ${card.id} missing experienceTypes field`);
      return false;
    }
    
    if (card.experienceTypes === null) {
      console.warn(`Warning: Card ${card.id} has null experienceTypes`);
      return false;
    }
    
    // Convert string to array if needed
    let types = card.experienceTypes;
    if (typeof types === 'string') {
      console.warn(`Warning: Card ${card.id} has string experienceTypes, expected array`);
      types = [types];
    }
    
    // Check if card has any selected type
    return types.some(type => selectedExperienceTypes.includes(type));
  });
  
  console.log(`Experience Type filter: ${selectedExperienceTypes.join(', ')} (${filtered.length} cards match)`);
  return filtered;
};
```

### UI Component (React Native)

```tsx
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Star, Heart, Users, Target } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

const experienceTypes = [
  { id: 'soloAdventure', label: 'Solo Adventure', icon: Star },
  { id: 'firstDate', label: 'First Date', icon: Heart },
  { id: 'romantic', label: 'Romantic', icon: Heart },
  { id: 'friendly', label: 'Friendly', icon: Users },
  { id: 'groupFun', label: 'Group Fun', icon: Users },
  { id: 'business', label: 'Business', icon: Target }
];

const ExperienceTypeSection = ({ 
  selectedExperiences, 
  onToggle 
}: {
  selectedExperiences: string[];
  onToggle: (id: string) => void;
}) => {
  const handlePress = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onToggle(id);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Experience Type</Text>
        <Text style={styles.subtitle}>
          Date Idea / Friends / Romantic / Solo Adventure
        </Text>
      </View>
      
      <View style={styles.pillContainer}>
        {experienceTypes.map((type) => {
          const Icon = type.icon;
          const isSelected = selectedExperiences.includes(type.id);
          
          return (
            <TouchableOpacity
              key={type.id}
              onPress={() => handlePress(type.id)}
              style={[
                styles.pill,
                isSelected ? styles.pillSelected : styles.pillUnselected
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${type.label}, ${isSelected ? 'selected' : 'not selected'}`}
            >
              <Icon 
                size={14} 
                color={isSelected ? '#fff' : '#6b7280'} 
              />
              <Text style={[
                styles.pillText,
                isSelected ? styles.pillTextSelected : styles.pillTextUnselected
              ]}>
                {type.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  header: {
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#6b7280',
  },
  pillContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillUnselected: {
    backgroundColor: '#fff',
    borderColor: '#d1d5db',
  },
  pillSelected: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
    shadowColor: '#eb7825',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  pillText: {
    fontSize: 12,
  },
  pillTextUnselected: {
    color: '#374151',
  },
  pillTextSelected: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default ExperienceTypeSection;
```

---

## Testing Checklist

### Unit Tests
- [ ] Toggle selection adds/removes from array
- [ ] Multiple selections maintain all selected IDs
- [ ] Deselection removes correct ID
- [ ] Category auto-deselection when experience type changes
- [ ] Filter function with 0, 1, and multiple selections
- [ ] Filter function handles malformed data (null, undefined, string)
- [ ] Case-sensitive filtering

### Integration Tests
- [ ] UI updates when selection changes
- [ ] Categories section updates when experience types change
- [ ] Selected categories auto-deselect when no longer valid
- [ ] Haptic feedback fires on selection/deselection
- [ ] State persists during session

### Accessibility Tests
- [ ] Screen reader announces selection state
- [ ] Keyboard navigation works (Tab, Space, Enter)
- [ ] Focus indicators are visible
- [ ] Minimum touch target size (44x44)

### Performance Tests
- [ ] Selection responds within 50ms
- [ ] Filtering 1000 cards completes within 100ms
- [ ] No memory leaks with rapid selection changes

---

## Definition of Done

- [ ] All 30 acceptance criteria pass
- [ ] Unit tests written and passing (>90% coverage)
- [ ] Integration tests passing
- [ ] Accessibility tests passing
- [ ] Performance benchmarks met
- [ ] Code reviewed and approved
- [ ] Documentation updated
- [ ] QA validation complete

---

## Related Stories

- **Story 2:** Categories Selection (depends on Experience Type filtering)
- **Story 8:** Complete Filter Pipeline (integrates this filter)
- **Story 9:** Card Data Model (defines experienceTypes field structure)

---

**Last Updated:** December 16, 2025  
**Reviewed By:** Product Team  
**Status:** ✅ Ready for Development
