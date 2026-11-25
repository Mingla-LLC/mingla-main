/**
 * #4490 spec 07-C — the shared priced-extras editor used by group packages
 * and private hire. New rows get their durable server id after save.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { MoneyField } from "../../../ui/MoneyField";
import { Segmented } from "../../../ui/Pill";
import { emptyExtra, extraIssue, type ExtraDraft } from "./packageModel";

const MAX_EXTRAS = 20;

export interface ExtrasEditorProps {
  title: string;
  helper: string;
  extras: readonly ExtraDraft[];
  onChange: (extras: ExtraDraft[]) => void;
  currency: string | null;
  disabled: boolean;
  showErrors: boolean;
  testIDPrefix: string;
  addTestID: string;
}

export function ExtrasEditor({
  title,
  helper,
  extras,
  onChange,
  currency,
  disabled,
  showErrors,
  testIDPrefix,
  addTestID,
}: ExtrasEditorProps): React.ReactElement {
  const full = extras.length >= MAX_EXTRAS;
  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <Text style={styles.hint}>{helper}</Text>
      {extras.map((extra, index) => {
        const issue = showErrors ? extraIssue(extra) : null;
        const update = (next: Partial<ExtraDraft>): void =>
          onChange(extras.map((row) => (row.key === extra.key ? { ...row, ...next } : row)));
        return (
          <View key={extra.key} style={styles.subCard} testID={`${testIDPrefix}-${index}`}>
            <Input
              value={extra.name}
              onChangeText={(name) => update({ name: name.slice(0, 80) })}
              placeholder="e.g. Cake table"
              accessibilityLabel="Extra name"
              disabled={disabled}
              error={issue === "Name this extra" ? issue : null}
              testID={`${testIDPrefix}-name-${index}`}
            />
            <View style={styles.inlineRow}>
              <View style={styles.grow}>
                <MoneyField
                  label="Price"
                  valueMinor={extra.priceMinor}
                  onChangeMinor={(priceMinor) => update({ priceMinor })}
                  currency={currency}
                  disabled={disabled}
                  error={issue === "Enter a price" ? issue : null}
                  testID={`${testIDPrefix}-price-${index}`}
                />
              </View>
              <View style={styles.grow}>
                <Text style={styles.label}>Charged</Text>
                <Segmented
                  options={[
                    { key: "booking", label: "Per booking" },
                    { key: "guest", label: "Per guest" },
                  ]}
                  value={extra.per}
                  onChange={(per) => update({ per })}
                  accessibilityLabel="How the extra is charged"
                  testID={`${testIDPrefix}-per-${index}`}
                />
              </View>
            </View>
            <View>
              <Button
                label="Remove extra"
                variant="ghost"
                size="sm"
                onPress={() => onChange(extras.filter((row) => row.key !== extra.key))}
                disabled={disabled}
              />
            </View>
          </View>
        );
      })}
      <View style={styles.add}>
        <Button
          label="Add an extra"
          variant="secondary"
          size="md"
          leadingIcon="plus"
          onPress={() => onChange([...extras, emptyExtra()])}
          disabled={disabled || full}
          testID={addTestID}
        />
        {full ? <Text style={styles.error}>You can add up to 20 extras.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  sectionLabel: { ...type.label, color: color.text2, marginTop: space[2] },
  hint: { ...type.small, color: color.text2 },
  subCard: { gap: space[3], padding: space[3], borderWidth: 1, borderColor: color.line, borderRadius: radius.md },
  inlineRow: { flexDirection: "row", flexWrap: "wrap", gap: space[3] },
  grow: { flex: 1, minWidth: 220 },
  label: { ...type.label, color: color.text2, marginBottom: space[1] },
  add: { alignItems: "flex-start", gap: space[2] },
  error: { ...type.small, color: color.danger },
});
