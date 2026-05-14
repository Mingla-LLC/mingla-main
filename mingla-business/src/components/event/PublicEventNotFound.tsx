/**
 * PublicEventNotFound — adapter for the shared @mingla/event-rendering package.
 *
 * Per META-ORCH-0827 Pass 2 (Option C). The predecessor moved into the
 * shared package; this adapter injects the navigation callback.
 */

import React from "react";
import { useRouter } from "expo-router";

import { PublicEventNotFound as SharedPublicEventNotFound } from "@mingla/event-rendering";

export const PublicEventNotFound: React.FC = () => {
  const router = useRouter();
  return (
    <SharedPublicEventNotFound
      onBrowse={() => {
        router.replace("/" as never);
      }}
    />
  );
};
