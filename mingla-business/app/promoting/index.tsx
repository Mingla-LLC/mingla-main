import React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { PromoterHomeView } from "../../src/components/referrals/PromoterHomeView";
import { ProgramScreen } from "../../src/components/programs/ProgramKit";

// #3872 — Promoting (approved K-mine): plain title bar, content scrolls.
export default function PromotingRoute(): React.ReactElement {
  const client = useQueryClient();
  return (
    <ProgramScreen
      title="Promoting"
      fallback="/(tabs)/account"
      refreshing={false}
      onRefresh={() => {
        void client.invalidateQueries({ queryKey: ["my-promoting-offers"] });
        void client.invalidateQueries({ queryKey: ["my-promoting-earnings"] });
        void client.invalidateQueries({ queryKey: ["my-payout-account"] });
      }}
    >
      <PromoterHomeView />
    </ProgramScreen>
  );
}
