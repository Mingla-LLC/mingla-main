import React from "react";
import { useLocalSearchParams } from "expo-router";

import { GroupChatPanel } from "../../../src/components/groupChat/GroupChatPanel";

export default function EventGroupChatRoute(): React.ReactElement | null {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (typeof id !== "string" || id.length === 0) return null;
  return <GroupChatPanel eventId={id} />;
}
