import React from "react";
import { Text, StyleSheet } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { RetryableLazyErrorBoundary } from "../../../src/components/ui/RetryableLazyBoundary";
import { useCurrentBrand } from "../../../src/hooks/useCurrentBrand";
import {
  canvas,
  spacing,
  text,
  typography,
} from "../../../src/constants/designSystem";

const loadContactImportFlow = async () => {
  const module = await import("../../../src/features/contact-import/ContactImportFlow");
  return { default: module.ContactImportFlow };
};

export default function ContactImportRoute(): React.ReactElement {
  const brand = useCurrentBrand();
  const router = useRouter();
  const navigation = useNavigation();
  const replacingRef = React.useRef(false);
  const params = useLocalSearchParams<{ returnTo?: string | string[]; brandId?: string | string[] }>();
  const routeBrandId = Array.isArray(params.brandId) ? params.brandId[0] : params.brandId;
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const validRoute = returnTo === "marketingPeople" && typeof routeBrandId === "string" && brand?.id === routeBrandId;
  const returnToPeople = React.useCallback((): void => {
    replacingRef.current = true;
    router.replace("/(tabs)/marketing/people" as never);
  }, [router]);
  React.useEffect(() => {
    const unsubscribe = navigation.addListener(
      "beforeRemove" as never,
      ((event: { preventDefault: () => void }) => {
        if (replacingRef.current) return;
        event.preventDefault();
        returnToPeople();
      }) as never,
    );
    return unsubscribe;
  }, [navigation, returnToPeople]);
  return (
    <SafeScreen edges={["top"]} style={s.host}>
      {brand && validRoute ? (
        <RetryableLazyErrorBoundary
          loader={loadContactImportFlow}
          accessibilityLiveRegion="polite"
          loadingLabel="Opening contact import…"
          componentProps={{ brandId: brand.id, onViewBook: returnToPeople }}
        />
      ) : (
        <Text style={s.empty} onPress={returnToPeople} accessibilityRole="button">This import belongs to another brand. Return to People and try again.</Text>
      )}
    </SafeScreen>
  );
}
const s = StyleSheet.create({
  host: { backgroundColor: canvas.discover },
  empty: { ...typography.body, color: text.secondary, padding: spacing.lg },
});
