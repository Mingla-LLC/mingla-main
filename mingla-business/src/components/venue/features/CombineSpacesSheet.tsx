/**
 * #4490 P1-8 — combine spaces ("Whole Green Area" = North + South). Hiring a
 * combination blocks every part; its capacity is the sum of the parts.
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";
import type {
  VenueSpace,
  VenueSpaceCombination,
} from "../../../services/venueFeaturesService";
import { ScrollView } from "../../../wrappers/SmartScrollView";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import { SpacePicker, combinationCapacity, spaceFitsLabel } from "../../ui/SpacePicker";
import { combinationIssues } from "./spaceModel";

export interface CombineSpacesSheetProps {
  visible: boolean;
  combination: VenueSpaceCombination | null;
  spaces: readonly VenueSpace[];
  combinations: readonly VenueSpaceCombination[];
  saving: boolean;
  error: string | null;
  onSave: (input: { name: string; spaceIds: string[] }) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function CombineSpacesSheet({
  visible,
  combination,
  spaces,
  combinations,
  saving,
  error,
  onSave,
  onRemove,
  onClose,
}: CombineSpacesSheetProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const [name, setName] = useState("");
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(combination?.name ?? "");
    setSpaceIds(combination?.spaceIds ?? []);
    setShowErrors(false);
  }, [combination, visible]);

  const issues = combinationIssues({ name, spaceIds, id: combination?.id }, combinations);
  const total = combinationCapacity({ spaceIds }, spaces);

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        if (!saving) onClose();
      }}
      snapPoint={0.85}
      presentation={isWideDesktop ? "modal" : undefined}
      dismissDisabled={saving}
      testID="combine-spaces-sheet"
    >
      <View style={styles.body}>
        <Text style={styles.heading} accessibilityRole="header">
          {combination === null ? "Combine spaces" : combination.name}
        </Text>
        <Text style={styles.hint}>Hiring a combination blocks every space in it.</Text>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Input
            value={name}
            onChangeText={(next) => setName(next.slice(0, 80))}
            placeholder="Whole Green Area"
            accessibilityLabel="Combination name"
            error={showErrors ? issues.name : null}
            testID="combine-spaces-name"
          />
          <SpacePicker
            label="Spaces in it"
            spaces={spaces}
            value={spaceIds}
            onChange={setSpaceIds}
            mode="multi"
            testID="combine-spaces-picker"
          />
          {showErrors && issues.parts !== null ? (
            <Text style={styles.error} testID="combine-spaces-parts-error">{issues.parts}</Text>
          ) : null}
          {spaceIds.length >= 2 ? (
            <Text style={styles.total} testID="combine-spaces-total">
              Together it fits {spaceFitsLabel(total)}.
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          {error !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
          ) : null}
          <View style={styles.footerRow}>
            {combination !== null ? (
              <Button label="Remove" variant="ghost" size="md" onPress={onRemove} disabled={saving} testID="combine-spaces-remove" />
            ) : (
              <Button label="Cancel" variant="ghost" size="md" onPress={onClose} disabled={saving} />
            )}
            <Button
              label={combination === null ? "Combine" : "Save"}
              variant="primary"
              size="md"
              loading={saving}
              onPress={() => {
                setShowErrors(true);
                if (issues.name !== null || issues.parts !== null) return;
                onSave({ name: name.trim(), spaceIds });
              }}
              testID="combine-spaces-save"
            />
          </View>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[1] },
  heading: { ...type.h1, color: color.text1 },
  hint: { ...type.caption, color: color.text3 },
  scroll: { flex: 1 },
  scrollContent: { gap: space[3], paddingTop: space[2], paddingBottom: space[6] },
  total: { ...type.small, color: color.text1 },
  error: { ...type.caption, color: color.errorText },
  footer: {
    gap: space[2],
    paddingTop: space[3],
    paddingBottom: space[4],
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  footerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
