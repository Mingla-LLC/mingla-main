import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import {
  radius,
  color,
  materials,
  space,
  type,
} from "../../constants/designSystem";
import type { BrandPersonIdentitySummary } from "../../types/people";
import { Avatar } from "../ui/Avatar";
import { Icon } from "../ui/Icon";

function Field({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {values.map((value) => (
        <Text selectable key={value} style={styles.value}>{value}</Text>
      ))}
    </View>
  );
}

function disambiguator(person: BrandPersonIdentitySummary): string | null {
  const primary = person.contacts.find((contact) => contact.isPrimary)
    ?? person.contacts[0];
  return primary?.value ?? null;
}

export function PersonComparisonCard({
  person,
  selected = false,
  selectable = false,
  disambiguate = false,
  onSelect,
}: {
  person: BrandPersonIdentitySummary;
  selected?: boolean;
  selectable?: boolean;
  disambiguate?: boolean;
  onSelect?: () => void;
}): React.ReactElement {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 2;
  const accessibleSuffix = disambiguate ? disambiguator(person) : null;
  const accessibleLabel = selectable
    ? `Keep ${person.displayName}${accessibleSuffix ? `, ${accessibleSuffix}` : ""}`
    : person.displayName;
  const content = (
    <>
      {selectable ? (
        <View style={[styles.radioRow, largeText ? styles.largeTextRow : null]}>
          <View style={[styles.radio, selected ? styles.radioSelected : null]}>
            {selected ? <Icon name="check" size={14} color={color.textStrong} /> : null}
          </View>
          <Text style={styles.radioLabel}>Keep {person.displayName}</Text>
        </View>
      ) : null}
      <View style={styles.identity}>
        <Avatar
          name={person.displayName}
          photo={person.avatarUrl ?? undefined}
          size="row"
        />
        <Text style={styles.name}>{person.displayName}</Text>
      </View>
      <Field label="Also known as" values={person.alternateNames} />
      <Field
        label="Email"
        values={person.contacts.filter((contact) => contact.channel === "email").map((contact) => contact.value)}
      />
      <Field
        label="Phone"
        values={person.contacts.filter((contact) => contact.channel === "phone").map((contact) => contact.value)}
      />
      <View style={styles.field}>
        <Text style={styles.label}>Mingla account</Text>
        <Text style={styles.account}>{person.linked ? "Linked" : "Not linked"}</Text>
      </View>
    </>
  );
  const cardStyle = [
    styles.card,
    largeText ? styles.largeTextCard : null,
    selected ? styles.selected : null,
  ];
  if (!selectable || !onSelect) return <View style={cardStyle}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibleLabel}
      accessibilityState={{ checked: selected }}
      onPress={onSelect}
      style={({ pressed }) => [cardStyle, pressed ? styles.pressed : null]}
      testID={`keep-person-${person.personId}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 208,
    minWidth: 160,
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: Platform.OS === "android" ? color.card2 : color.line,
    backgroundColor: Platform.OS === "android" ? materials.pane.solidFill : color.fill.inset,
    padding: 12,
    gap: space[2],
  },
  selected: {
    borderWidth: 1.5,
    borderColor: color.accentLine,
    backgroundColor: Platform.OS === "android" ? materials.selected.solidFill : color.accentLine,
  },
  pressed: { opacity: 0.78 },
  radioRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2] },
  largeTextRow: { flexDirection: "column", alignItems: "stretch" },
  largeTextCard: { minWidth: 0, width: "100%" },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: color.fill.pager,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: { borderColor: color.accent, backgroundColor: color.accent },
  radioLabel: { ...type.small, fontWeight: "600", color: color.text1, flex: 1 },
  identity: { alignItems: "center", gap: space[2] },
  name: { ...type.small, fontWeight: "600", color: color.text1, textAlign: "center" },
  field: { gap: space[1] },
  label: { ...type.caption, color: color.text2 },
  value: { ...type.mono, color: color.text1, flexWrap: "wrap" },
  account: { ...type.small, color: color.text1 },
});
