/**
 * SUPPLIES — the picnic shopping checklist, re-homed onto the spine. #1605 P1-4.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: A FEATURE VANISHED WITH A COMPONENT
 *
 * `PicnicShoppingList.tsx` rendered at `ExpandedCardModal:990-992` on `main`, an
 * interactive checklist of the AI-generated picnic supplies. Wave 4 deleted the
 * component; the spec's deletion list (§11.3, §12) never mentioned it. §6.5
 * removes the grocery STORE block — "becomes one stop row with a `SHOP` chip",
 * correctly built — and says nothing about the LIST OF THINGS TO BUY.
 *
 * The data was never dead. `shoppingList` is carried by FIVE producers
 * (`cardConverters:98`, `savedCardToExpandedCardData:223`,
 * `holidayCardToExpandedCardData:96`, `collabSaveCard:76`, `calendarService:252`),
 * regenerated on customisation (`mutateCuratedCard:184`), and #1669's own parity
 * tests assert it survives the one-producer mapper. Keeping the data, the sync,
 * the collab copy and the calendar column while rendering it NOWHERE is the
 * worst of the three available outcomes.
 *
 * ---------------------------------------------------------------------------
 * IT COMES BACK AS A SECTION, NOT AS THE BOX IT WAS
 *
 * The old component was a #FFF8F0 rounded card with a #F0E6D9 border, a 18pt
 * orange icon, a #8E8E93 counter (2.83:1) and #1C1C1E item text — one more
 * tinted box in the four-tinted-box body this wave exists to remove, carrying
 * the dark fill S-4b forbids and a counter below the contrast floor.
 *
 * So it is a `Section` like every other group: a rule, a heading, rows. What
 * survives verbatim is the BEHAVIOUR, which is the part that was actually being
 * used — tap to check, strike through, light haptic, a checked/total count.
 * The count moves into the heading's trailing `Chip`, where the Plan's
 * `Customized` chip already lives, at 12/600 #6B7280 (4.83:1).
 *
 * ---------------------------------------------------------------------------
 * THE CHECKED SET IS CLIENT STATE AND STAYS THAT WAY
 *
 * Nothing here persists. Ticking "blanket" is a scratchpad for the ten minutes
 * before you leave the house, not a fact about the plan, and writing it to the
 * saved card would make two devices disagree about a list neither of them owns.
 * The set resets when the sheet closes, exactly as it did on `main`.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import { Icon } from "../ui/Icon";
import { Chip, Section } from "./SpineParts";
import { SPINE } from "./spineTokens";

interface SuppliesListProps {
  /** Already trimmed and non-empty by the caller. */
  readonly items: readonly string[];
}

export default function SuppliesList({ items }: SuppliesListProps): React.ReactElement | null {
  const { t } = useTranslation(["cards", "common"]);
  const [checked, setChecked] = React.useState<ReadonlySet<number>>(() => new Set<number>());

  // A section with nothing in it does not render, and the rule above it goes
  // with it — the same contract every other body group obeys.
  if (items.length === 0) return null;

  const toggle = (index: number): void => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Section
      title={t("cards:expanded.supplies", { defaultValue: "Supplies" })}
      trailing={<Chip label={`${checked.size}/${items.length}`} />}
    >
      {items.map((item, index) => {
        const isChecked = checked.has(index);
        return (
          <Pressable
            key={`${index}_${item}`}
            onPress={() => toggle(index)}
            style={({ pressed }) => [
              styles.row,
              index === 0 ? null : styles.rowDivided,
              pressed ? styles.rowPressed : null,
            ]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isChecked }}
            accessibilityLabel={item}
          >
            <View style={[styles.box, isChecked ? styles.boxChecked : null]}>
              {/* The tick is ON the accent fill, so it is the near-black label
                  token (6.47:1) and never white (2.90:1). */}
              {isChecked ? <Icon name="checkmark" size={14} color={SPINE.onAccent} /> : null}
            </View>
            <Text style={[styles.item, isChecked ? styles.itemChecked : null]}>{item}</Text>
          </Pressable>
        );
      })}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: SPINE.factRowMinHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: SPINE.gutter,
    paddingVertical: 8,
  },
  rowDivided: { borderTopWidth: 1, borderTopColor: SPINE.rule },
  rowPressed: { backgroundColor: SPINE.pressedRow },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    // 2.24:1 against paper as a BORDER, which SC 1.4.11 does not govern for a
    // control that also carries its state in the label's strike-through.
    borderColor: SPINE.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: SPINE.accentFill, borderColor: SPINE.accentRing },
  item: { flex: 1, fontSize: 15, lineHeight: 22, color: SPINE.factValue },
  // State is carried by the strike-through AND the fill, never by colour alone.
  itemChecked: { textDecorationLine: "line-through", color: SPINE.muted },
});
