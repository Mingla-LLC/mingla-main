/**
 * #4347 wave 3 follow-up — the ONE main-button style of the expanded sheets'
 * pinned bar. The plan's "Schedule this plan" (ActionButtons) and the place
 * sheet's "Reserve a table" / "Directions" (ExpandedCardModal, through the
 * ActionButtons `reserve` slot) both use it, so the two sheets' primary buttons
 * are the same fill, label, height and shape. Colours: `PINNED_PRIMARY` in
 * spineTokens (near-black on the accent fill, 6.47:1).
 */
import { StyleSheet } from 'react-native';
import { PINNED_BAR, PINNED_PRIMARY } from './spineTokens';

export const pinnedPrimaryStyles = StyleSheet.create({
  button: {
    flex: 1,
    // #4347 round 2 — the button may be narrower than its label (three side
    // buttons, a long language). It keeps its own width and the label shrinks
    // INSIDE it with an ellipsis; before, the label kept its full width and
    // pushed the icon out of the left edge and the text off the screen.
    minWidth: 0,
    overflow: 'hidden',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: PINNED_BAR.buttonHeight,
    borderRadius: PINNED_BAR.buttonRadius,
    backgroundColor: PINNED_PRIMARY.fill,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    color: PINNED_PRIMARY.label,
    fontSize: PINNED_BAR.primaryLabelSize,
    fontWeight: '700',
  },
});
