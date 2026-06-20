// T-WL-04 — QuantityRow waitlist CTA contract.

import fs from "node:fs";
import path from "node:path";

describe("T-WL-04 QuantityRow waitlist CTA", () => {
  const packageSource = fs.readFileSync(
    path.resolve(
      __dirname,
      "../../../../../packages/offering-rendering/QuantityRow.tsx",
    ),
    "utf8",
  );
  const wrapperSource = fs.readFileSync(
    path.resolve(__dirname, "../QuantityRow.tsx"),
    "utf8",
  );

  it("renders Join waitlist when sold out, waitlist-enabled, and callback supplied", () => {
    expect(packageSource).toContain("waitlistEnabled?: boolean");
    expect(packageSource).toContain(
      "onJoinWaitlist?: (ticketId: string) => void",
    );
    expect(packageSource).toContain("canJoinWaitlist");
    expect(packageSource).toContain("Join waitlist");
    expect(packageSource).toContain("handleJoinWaitlist");
    expect(packageSource).toContain("onJoinWaitlist(ticket.id)");
  });

  it("mingla-business wrapper passes waitlistEnabled and onJoinWaitlist through", () => {
    expect(wrapperSource).toContain(
      "onJoinWaitlist?: (ticketId: string) => void",
    );
    expect(wrapperSource).toContain("waitlistEnabled: ticket.waitlistEnabled");
    expect(wrapperSource).toContain("onJoinWaitlist={onJoinWaitlist}");
  });
});
