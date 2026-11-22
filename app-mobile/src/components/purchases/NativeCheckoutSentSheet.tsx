import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BaseBottomSheet } from "../ui/BaseBottomSheet";

type Props = {
  visible: boolean;
  buyerFirstName: string | null;
  onDone: () => void;
  /** #4541 R2.8 — the order, for "One more thing from {brand}". */
  orderId?: string | null;
};

// #4541 R2.8 — loaded on use (it reaches expo-router and AsyncStorage).
const FormHandoffBlock = React.lazy(() => import("../forms/FormHandoffBlock"));

export function NativeCheckoutSentSheet({
  visible,
  buyerFirstName,
  onDone,
  orderId = null,
}: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const normalizedName = buyerFirstName?.trim() || null;

  return (
    <BaseBottomSheet
      accessibilityLabel={normalizedName
        ? t("nativeCheckout.sentTitle", { firstName: normalizedName })
        : t("nativeCheckout.sentTitleNoName")}
      enablePanDownToClose
      onClose={onDone}
      scrollMode="view"
      snapPoints={["42%"]}
      theme="light"
      visible={visible}
      wrapInRNModal
    >
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>
          {normalizedName
            ? t("nativeCheckout.sentTitle", { firstName: normalizedName })
            : t("nativeCheckout.sentTitleNoName")}
        </Text>
        <Text style={styles.description}>
          {normalizedName
            ? t("nativeCheckout.sentBody", { firstName: normalizedName })
            : t("nativeCheckout.sentBodyNoName")}
        </Text>
        {visible && orderId !== null ? (
          <React.Suspense fallback={null}>
            <FormHandoffBlock
              kind="order"
              subjectId={orderId}
              from="purchase"
              onBeforeAnswer={onDone}
              variant="row"
            />
          </React.Suspense>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          style={({ pressed }) => [styles.done, pressed && styles.pressed]}
        >
          <Text style={styles.doneText}>{t("nativeCheckout.done")}</Text>
        </Pressable>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 28,
  },
  title: {
    color: "#17191e",
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
    textAlign: "center",
  },
  description: {
    color: "#60656e",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  done: {
    alignItems: "center",
    backgroundColor: "#eb7825",
    borderRadius: 15,
    justifyContent: "center",
    minHeight: 52,
    marginTop: 28,
  },
  doneText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  pressed: { opacity: 0.68 },
});
