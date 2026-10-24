import React from "react";
import { useLocalSearchParams, useRouter } from "expo-router";

import { BrandGroupMediaPanel } from "../../../src/components/messages/BrandGroupMediaPanel";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { useBrandGroups } from "../../../src/hooks/useBrandGroups";

function first(value: string | string[] | undefined): string {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" ? item : "";
}

export default function BrandGroupMediaRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = first(params.conversationId);
  const { groups } = useBrandGroups();
  const group = groups.find((item) => item.conversation_id === conversationId);
  return (
    <SafeScreen edges={["top", "bottom"]}>
      <BrandGroupMediaPanel
        conversationId={conversationId}
        groupName={group?.brand_name ?? "Brand group"}
        onBack={() => router.back()}
        onShowInChat={(messageId) => router.replace({
          pathname: "/messages/[conversationId]",
          params: { conversationId, focusMessageId: messageId },
        })}
      />
    </SafeScreen>
  );
}
