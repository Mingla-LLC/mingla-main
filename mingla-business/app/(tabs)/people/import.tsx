import React from "react";
import { Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { ContactImportFlow } from "../../../src/features/contact-import/ContactImportFlow";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import {
  canvas,
  spacing,
  text,
  typography,
} from "../../../src/constants/designSystem";
export default function ContactImportRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const router = useRouter();
  return (
    <SafeScreen edges={["top"]} style={s.host}>
      {brand ? (
        <ContactImportFlow
          brandId={brand.id}
          onViewBook={() => router.back()}
        />
      ) : (
        <Text style={s.empty}>Choose a brand before importing contacts.</Text>
      )}
    </SafeScreen>
  );
}
const s = StyleSheet.create({
  host: { backgroundColor: canvas.discover },
  empty: { ...typography.body, color: text.secondary, padding: spacing.lg },
});
