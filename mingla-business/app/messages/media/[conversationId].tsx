import React from "react";
import { Redirect, useLocalSearchParams } from "expo-router";

function first(value: string | string[] | undefined): string {
  const item = Array.isArray(value) ? value[0] : value;
  return typeof item === "string" ? item : "";
}

export default function BrandGroupMediaRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = first(params.conversationId);
  return (
    <Redirect
      href={{
        pathname: "/messages/[conversationId]",
        params: { conversationId, gallery: "1" },
      }}
    />
  );
}
