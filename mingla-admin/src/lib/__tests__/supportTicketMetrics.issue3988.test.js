import { describe, expect, it } from "vitest";
import { isActiveUnassignedTicket } from "../supportTicketMetrics";

describe("#3988 active unassigned support count", () => {
  it.each(["new", "open", "pending"])("includes an unassigned %s ticket", (status) => {
    expect(isActiveUnassignedTicket({ status, assigned_staff_id: null })).toBe(true);
  });

  it.each(["resolved", "closed"])("does not report an unassigned %s ticket as waiting", (status) => {
    expect(isActiveUnassignedTicket({ status, assigned_staff_id: null })).toBe(false);
  });

  it("does not report assigned active work", () => {
    expect(isActiveUnassignedTicket({ status: "open", assigned_staff_id: "staff-1" })).toBe(false);
  });
});
