/**
 * #4347 wave 3 — the plan's smaller sections: the ONE warning card (only when
 * action is needed, always with a fix), "Conditions at your stops", "Getting
 * there" (one row per leg, "You → stop 1" only with a location) and "Ends near".
 * Every string arrives translated; these only lay it out.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';
import { PLAN_SHEET, SPINE } from './spineTokens';
import { PLAN_MOTION } from './motionTokens';
import { useEnterStyle } from './planMotion';

export interface WarningFix {
  readonly key: string;
  readonly label: string;
  readonly onPress: () => void;
}

export function PlanWarningCard({
  text,
  fixes,
  reducedMotion,
}: {
  text: string;
  fixes: readonly WarningFix[];
  reducedMotion: boolean;
}): React.ReactElement | null {
  const enter = useEnterStyle({
    reduced: reducedMotion,
    durationMs: PLAN_MOTION.warningMs,
    fromY: PLAN_MOTION.warningFromY,
  });
  // A warning without a fix is not shown (the spec: always with a fix).
  if (fixes.length === 0) return null;
  return (
    <Reanimated.View testID="plan-warning" style={[styles.warning, enter]} accessibilityRole="alert">
      <Text style={styles.warningText}>{text}</Text>
      <View style={styles.fixes}>
        {fixes.map((fix) => (
          <Pressable
            key={fix.key}
            testID={`plan-warning-fix-${fix.key}`}
            onPress={fix.onPress}
            accessibilityRole="button"
            accessibilityLabel={fix.label}
            style={({ pressed }) => [styles.fix, pressed ? styles.pressed : null]}
          >
            <Text style={styles.fixText} maxFontSizeMultiplier={1.3}>
              {fix.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Reanimated.View>
  );
}

export interface TableRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly warn?: boolean;
}

function Rows({ rows, testIDPrefix }: { rows: readonly TableRow[]; testIDPrefix: string }): React.ReactElement {
  return (
    <>
      {rows.map((row) => (
        <View key={row.key} style={styles.row} testID={`${testIDPrefix}-${row.key}`}>
          <Text style={styles.rowLabel} maxFontSizeMultiplier={1.4}>
            {row.label}
          </Text>
          <Text style={[styles.rowValue, row.warn ? styles.rowWarn : null]} maxFontSizeMultiplier={1.4}>
            {row.value}
          </Text>
        </View>
      ))}
    </>
  );
}

export function PlanConditions({
  title,
  rows,
  note,
}: {
  title: string;
  rows: readonly TableRow[];
  note: string;
}): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <View style={styles.section} testID="plan-conditions">
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      <Rows rows={rows} testIDPrefix="plan-conditions-row" />
      <Text style={styles.note} testID="plan-conditions-note">
        {note}
      </Text>
    </View>
  );
}

export function PlanGettingThere({
  title,
  rows,
  routeLabel,
  routeNote = null,
  onRoute,
}: {
  title: string;
  rows: readonly TableRow[];
  routeLabel: string;
  /** "Opens 10 of 12 stops" when the route link cannot carry every stop. */
  routeNote?: string | null;
  onRoute: (() => void) | null;
}): React.ReactElement | null {
  if (rows.length === 0 && onRoute === null) return null;
  return (
    <View style={styles.section} testID="plan-getting-there">
      <View style={styles.headingRow}>
        <Text style={[styles.heading, styles.headingFlex]} accessibilityRole="header">
          {title}
        </Text>
        {onRoute ? (
          <Pressable
            testID="plan-route-all"
            onPress={onRoute}
            accessibilityRole="button"
            accessibilityLabel={routeLabel}
            accessibilityHint={routeNote ?? undefined}
            hitSlop={8}
          >
            <Text style={styles.link}>{routeLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {onRoute && routeNote ? (
        <Text style={styles.routeNote} testID="plan-route-note">
          {routeNote}
        </Text>
      ) : null}
      <Rows rows={rows} testIDPrefix="plan-leg" />
    </View>
  );
}

export function PlanEndsNear({ title, text }: { title: string; text: string | null }): React.ReactElement | null {
  if (!text) return null;
  return (
    <View style={styles.section} testID="plan-ends-near">
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.prose}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // #4347 wave 3 rework — the route cap note, under the Getting there heading.
  routeNote: { marginTop: 4, fontSize: 13, color: SPINE.muted },
  warning: {
    marginHorizontal: SPINE.gutter,
    marginTop: 12,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: PLAN_SHEET.warningBorder,
    backgroundColor: PLAN_SHEET.warningFill,
  },
  warningText: {
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '500',
    color: PLAN_SHEET.warningText,
  },
  fixes: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  fix: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: PLAN_SHEET.warningBorder,
    backgroundColor: PLAN_SHEET.warningButtonFill,
  },
  fixText: {
    fontSize: 13,
    fontWeight: '700',
    color: PLAN_SHEET.warningText,
  },
  pressed: {
    opacity: 0.6,
  },
  section: {
    paddingHorizontal: SPINE.gutter,
    paddingVertical: SPINE.sectionPaddingVertical,
    borderTopWidth: 1,
    borderTopColor: SPINE.rule,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  headingFlex: {
    flex: 1,
    marginBottom: 0,
  },
  heading: {
    fontSize: SPINE.headingSize,
    letterSpacing: SPINE.headingLetterSpacing,
    fontWeight: '700',
    color: SPINE.heading,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  link: {
    fontSize: 14,
    fontWeight: '700',
    color: SPINE.link,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 36,
    alignItems: 'center',
    paddingVertical: 4,
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: 14,
    color: SPINE.factLabel,
  },
  rowValue: {
    fontSize: 14,
    fontWeight: '600',
    color: SPINE.factValue,
  },
  rowWarn: {
    color: PLAN_SHEET.chipWarnText,
  },
  note: {
    marginTop: 6,
    fontSize: 12,
    color: SPINE.muted,
  },
  prose: {
    fontSize: 15,
    lineHeight: 22,
    color: SPINE.prose,
  },
});
