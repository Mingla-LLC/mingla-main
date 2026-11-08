/**
 * #4304 part 2 — web (and node render proof) bubble gestures: none. On web
 * the message menu opens from right-click or the hover "⋯", and replying is a
 * menu action. Phones get swipe-to-reply and double-tap heart from
 * BrandGroupBubbleGestures.native.tsx.
 */
import React from "react";

export function BrandGroupBubbleGestures({
  children,
}: {
  children: React.ReactNode;
  onReply: () => void;
  onDoubleTap: () => void;
  enabled?: boolean;
}): React.ReactElement {
  return <>{children}</>;
}
