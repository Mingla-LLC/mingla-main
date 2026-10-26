/**
 * #4111 — loads the signed-in guest's plans for the message sheet and reports
 * them up. A separate, lazily-loaded component so the controller (also used on
 * the anonymous cancel page) never imports the auth-scoped hook itself.
 */
import React, { useEffect } from "react";
import type { EnquiryPlan } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import { useMyBrandPlans } from "../../hooks/useMyBrandPlans";

export interface MyBrandPlansState {
  plans: EnquiryPlan[];
  state: "loading" | "ready" | "error";
  refetch: () => void;
}

export default function MyBrandPlansLoader({
  brandId,
  onChange,
}: {
  brandId: string;
  onChange: (next: MyBrandPlansState) => void;
}): React.ReactElement | null {
  const query = useMyBrandPlans(brandId, true);
  const { data, isError, isPending, refetch } = query;
  useEffect(() => {
    onChange({
      plans: data ?? [],
      state: isError ? "error" : isPending ? "loading" : "ready",
      refetch: () => {
        void refetch();
      },
    });
  }, [data, isError, isPending, onChange, refetch]);
  return null;
}
