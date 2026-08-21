import React from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ManualGroupDetail } from "../../../../src/components/people/ManualGroupDetail";
import { SafeScreen } from "../../../../src/components/ui/SafeScreen";
import { EmptyState } from "../../../../src/components/ui/EmptyState";
import { Skeleton } from "../../../../src/components/ui/Skeleton";
import { TopBar } from "../../../../src/components/ui/TopBar";
import { useShareNetworkState } from "../../../../src/components/ui/useShareNetworkState";
import { useCurrentBrand } from "../../../../src/hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../../../src/hooks/useCurrentBrandRole";
import { useFeatureFlag } from "../../../../src/hooks/useFeatureFlag";

export default function ManualGroupRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const brand = useCurrentBrand();
  const role = useCurrentBrandRole(brand?.id ?? null);
  const flag = useFeatureFlag("manual_contact_groups_v1");
  const online = useShareNetworkState();
  const authorityLoading = role.isLoading || flag.isPending || flag.isFetching;
  const authorized = !!brand && !!groupId && role.accepted && role.rank >= 20 && flag.data === true;
  return <SafeScreen edges={["top"]}>
    <TopBar leftKind="back" title="Manual group" onBack={() => router.replace("/(tabs)/marketing/people" as never)} rightSlot={null} />
    {authorityLoading ? <View accessibilityLiveRegion="polite">{[0, 1, 2].map((row) => <Skeleton key={row} width="100%" height={64} radius="lg" />)}</View>
      : role.isError || flag.isError ? <EmptyState title="Couldn’t verify access to this group." cta={{ label: "Try again", onPress: () => { void role.refetch(); void flag.refetch(); }, variant: "secondary" }} />
      : flag.data !== true ? <EmptyState title="Manual groups are not available yet." />
      : brand && groupId ? <ManualGroupDetail brandId={brand.id} groupId={groupId} online={online} authorized={authorized} /> : null}
  </SafeScreen>;
}
