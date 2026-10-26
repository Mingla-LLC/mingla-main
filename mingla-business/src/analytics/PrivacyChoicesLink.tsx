/**
 * PrivacyChoicesLink.tsx — NATIVE no-op stub (#2331).
 *
 * Metro resolves the sibling `PrivacyChoicesLink.web.tsx` on web. Native apps
 * ask for consent during onboarding and have no cookie bar to reopen.
 */

import type React from "react";

export interface PrivacyChoicesLinkProps {
  color?: string;
}

export function PrivacyChoicesLink(
  _props: PrivacyChoicesLinkProps,
): React.ReactElement | null {
  return null;
}
