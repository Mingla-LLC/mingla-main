import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";


import {
  color,
  space,
  type,
} from "../../constants/designSystem";
/*
 * #2829 W9a / #2830 — "Build your pages", before it starts: one press creates
 * the website draft (its address first, if it has none) and every page the plan
 * asks for. Private: nothing is public until a separate publish. Everything
 * after the press is the setup screen's draft step, from server truth.
 */

export interface SiteBuildViewProps {
  isLoading: boolean;
  loadError: string | null;
  canManage: boolean;
  approved: boolean;
  /** "Home · Trips · About · Contact" from the plan. */
  pagesLine: string;
  /** The address the draft has, or the one Core proposes before it exists. */
  address: string | null;
  hasSite: boolean;
  onBuild: () => void;
  onApproveFirst: () => void;
  onRetry: () => void;
}

export function SiteBuildView(props: SiteBuildViewProps): React.ReactElement {
  if (props.isLoading) return <View style={styles.centered}><ActivityIndicator accessibilityLabel="Loading" /></View>;
  if (props.loadError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.body} accessibilityRole="alert">{props.loadError}</Text>
        <Button label="Try again" onPress={props.onRetry} variant="secondary" />
      </View>
    );
  }
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Build your pages</Text>
      <GlassCard>
        <View style={styles.card}>
          <Text style={styles.heading}>Create website draft</Text>
          {props.address ? <Text style={styles.value} testID="build-address">{props.address}</Text> : null}
          <Text style={styles.body} testID="build-pages">{props.pagesLine}</Text>
          <Text style={styles.caption}>Private draft. Nothing is public until you publish.</Text>
          {!props.hasSite && props.address ? (
            <Text style={styles.caption}>This becomes your website&apos;s address. It never changes afterwards; you can add your own domain later.</Text>
          ) : null}
        </View>
      </GlassCard>
      {!props.canManage ? (
        <Text style={styles.caption}>Only a brand admin or the owner can create the website draft.</Text>
      ) : !props.approved ? (
        <>
          <Text style={styles.body}>Approve your plan first; the draft is built from it.</Text>
          <Button label="Review and approve the plan" onPress={props.onApproveFirst} testID="build-approve-first" />
        </>
      ) : (
        <Button label="Create website draft" onPress={props.onBuild} testID="build-create" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: space[4] },
  centered: { alignItems: "center", justifyContent: "center", gap: space[4], padding: space[6] },
  title: { ...type.h1, color: color.text1 },
  heading: { ...type.h1, color: color.text1 },
  body: { ...type.body, color: color.text2 },
  value: { ...type.mono, color: color.text1 },
  caption: { ...type.caption, color: color.text3 },
  error: { ...type.small, color: color.errorText },
  card: { padding: space[4], gap: space[2] },
});
