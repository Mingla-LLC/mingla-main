// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * #4111 Wave D — /enquiry/{enquiryId}: one brand enquiry thread (guest side).
 * Opened from the Friends tab row, after sending from the message sheet, and
 * by the `explorer.brand_enquiry_reply` push (deepLinkService `enquiry`).
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";

import { EnquiryThreadScreen } from "../../src/components/brandEnquiry/EnquiryThreadScreen";

export default function EnquiryThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ enquiryId?: string | string[] }>();
  const enquiryId = Array.isArray(params.enquiryId) ? params.enquiryId[0] : params.enquiryId;
  return <EnquiryThreadScreen enquiryId={typeof enquiryId === "string" ? enquiryId : ""} />;
}
