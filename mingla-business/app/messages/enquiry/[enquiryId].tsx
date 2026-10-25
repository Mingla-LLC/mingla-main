import React from "react";
import { useLocalSearchParams } from "expo-router";

import { BrandEnquiryThreadScreen } from "../../../src/components/messages/BrandEnquiryThreadScreen";

/** #4111 — a customer enquiry thread (Messages list, Brand-group card, To-do, push). */
export default function BrandEnquiryThreadRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ enquiryId?: string | string[] }>();
  const raw = Array.isArray(params.enquiryId) ? params.enquiryId[0] : params.enquiryId;
  return <BrandEnquiryThreadScreen enquiryId={typeof raw === "string" ? raw : ""} />;
}
