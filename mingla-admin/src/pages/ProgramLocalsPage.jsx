// Issue #3872 — Programs › Mingla Locals: seats and pay per city, then the
// queue of applications, picks, reviews and payouts (pages/locals/LocalsPanel).

import { PageHeader } from "../components/ui/PageHeader";
import { LocalsPanel } from "./locals/LocalsPanel";

export function ProgramLocalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mingla Locals"
        description="Mingla—not the place—selects the Local, reviews the work and funds the monthly payout. Each city sets its own rate and payout currency."
      />
      <LocalsPanel />
    </div>
  );
}
