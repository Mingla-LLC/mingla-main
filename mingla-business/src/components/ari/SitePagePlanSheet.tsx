/**
 * #4453 m11 rework (spec v2.1 §3.1, tester P2-1) — the full plan Ari's
 * `propose_site_page` will write, shown before anything is written: the page
 * and where it goes in the menu, each block in order with its own words or
 * Ari's question for it, the content Ari has with its source, and what Ari
 * still needs. "Add as a Draft" confirms; "Ask for something else" dismisses
 * the proposal; Cancel, a tap outside and Escape (web) just close the sheet.
 *
 * Do not import this from a screen: mount it through LazySitePagePlanSheet
 * (its code loads on intent on web, off the boot chunk).
 */
import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ariPalette, color, radius, scrim, space } from "../../constants/designSystem";
import { DESIGNS, designFor } from "../../../../packages/site-contracts/src/designs.ts";
import { useBrandSitePlan } from "../../sites/planApi";
import { useWebEscapeClose } from "../ui/useWebEscapeClose";
import { SITE_PAGE_PLAN_COPY as COPY, sitePagePlan } from "./sitePagePlan";

export interface SitePagePlanSheetProps {
  visible: boolean;
  onClose: () => void;
  args: Record<string, unknown>;
  isExecuting: boolean;
  error: string | null;
  onAdd: () => void;
  onAskForSomethingElse: () => void;
}

export function SitePagePlanSheet({ visible, onClose, args, isExecuting, error, onAdd, onAskForSomethingElse }: SitePagePlanSheetProps): React.ReactElement {
  useWebEscapeClose(visible, onClose);
  const plan = sitePagePlan(args);
  const brandId = typeof args.brand_id === "string" ? args.brand_id : "";
  const sitePlan = useBrandSitePlan(brandId, visible);
  const design = designFor(sitePlan.data?.site?.designKey ?? null);
  const style = design ? DESIGNS[design.key].label : null;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" role="button" testID="site-page-plan-scrim">
        <Pressable style={styles.dialog} role="dialog" aria-modal accessibilityLabel={COPY.heading} onPress={() => undefined} testID="site-page-plan-sheet">
          <View style={styles.head}>
            <Text style={styles.eyebrow}>{COPY.heading.toUpperCase()}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8} testID="site-page-plan-cancel">
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
            <Text style={styles.title} role="heading">{plan.title}</Text>
            <Text style={styles.line}>{style ? `${COPY.addedToMenu}, in ${style}.` : `${COPY.addedToMenu}.`}</Text>

            <Text style={styles.section} role="heading" aria-level={3}>{COPY.blocks}</Text>
            {plan.blocks.map((block) => (
              <View key={block.index} style={styles.item} testID={`site-page-plan-block-${block.index}`}>
                <Text style={styles.itemTitle}>{`${block.index + 1}. ${block.label}`}</Text>
                {block.lines.map((line, i) => <Text key={i} style={styles.itemLine}>{line}</Text>)}
                {block.questions.map((q) => (
                  <Text key={q.key} style={styles.need}>{`${COPY.ariNeeds}: ${q.question}`}</Text>
                ))}
              </View>
            ))}

            {plan.have.length ? (
              <>
                <Text style={styles.section} role="heading" aria-level={3}>{COPY.have}</Text>
                {plan.have.map((have, i) => (
                  <View key={i} style={styles.item} testID={`site-page-plan-have-${i}`}>
                    <Text style={styles.itemLine}>{have.text}</Text>
                    {have.source ? <Text style={styles.source}>{have.source}</Text> : null}
                  </View>
                ))}
              </>
            ) : null}

            {plan.questions.length ? (
              <>
                <Text style={styles.section} role="heading" aria-level={3}>{COPY.need}</Text>
                {plan.questions.map((q) => (
                  <View key={q.key} style={styles.item} testID={`site-page-plan-need-${q.key}`}>
                    <Text style={styles.itemLine}>{q.question}</Text>
                    {q.block ? <Text style={styles.source}>{q.block}</Text> : null}
                  </View>
                ))}
              </>
            ) : null}

            <Text style={styles.noGuess}>{COPY.noGuess}</Text>
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={onAskForSomethingElse}
              disabled={isExecuting}
              style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && styles.pressed, isExecuting && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={COPY.dismiss}
              testID="site-page-plan-dismiss"
            >
              <Text style={styles.btnSecondaryText}>{COPY.dismiss}</Text>
            </Pressable>
            <Pressable
              onPress={onAdd}
              disabled={isExecuting}
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed, isExecuting && styles.disabled]}
              accessibilityRole="button"
              accessibilityLabel={COPY.confirm}
              accessibilityState={{ disabled: isExecuting, busy: isExecuting }}
              testID="site-page-plan-add"
            >
              <Text style={styles.btnPrimaryText}>{isExecuting ? "Working…" : COPY.confirm}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: scrim.modal, alignItems: "center", justifyContent: "center", padding: space[4] },
  dialog: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: ariPalette.proposalBorder,
    borderRadius: radius.xl,
    paddingTop: 18,
    paddingBottom: 16,
    ...(Platform.OS === "web" ? { cursor: "default" } : {}),
  } as object,
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 6 },
  eyebrow: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1, color: color.text2 },
  cancel: { fontSize: 13, fontWeight: "600", color: color.text2 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollBody: { paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700", color: color.text1 },
  line: { fontSize: 13, lineHeight: 18, color: color.text2, marginTop: 4 },
  section: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, color: color.text1, marginTop: 18, marginBottom: 6 },
  item: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.lineStrong, gap: 2 },
  itemTitle: { fontSize: 14, fontWeight: "600", color: color.text1 },
  itemLine: { fontSize: 13, lineHeight: 18, color: color.text1 },
  source: { fontSize: 11.5, lineHeight: 15, color: color.text3 },
  need: { fontSize: 12.5, lineHeight: 17, color: color.warning, marginTop: 2 },
  noGuess: { fontSize: 12.5, lineHeight: 17, color: color.text2, marginTop: 18 },
  error: { fontSize: 12.5, lineHeight: 17, color: color.errorText, marginTop: 10 },
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 8, paddingHorizontal: 20, paddingTop: 12 },
  btn: { minHeight: 40, paddingHorizontal: 16, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  btnSecondary: { borderWidth: 1, borderColor: color.lineStrong },
  btnSecondaryText: { fontSize: 13, fontWeight: "600", color: color.text1 },
  btnPrimary: { backgroundColor: ariPalette.userBubble },
  btnPrimaryText: { fontSize: 13, fontWeight: "700", color: color.textStrong },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
});
