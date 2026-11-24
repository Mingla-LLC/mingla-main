/**
 * #4490 after #4579 — Till staff names follow #4579's public-name rule.
 *
 * The server (migration 20281203774490, issue_4490_staff_name) names an
 * auto-added Mingla admin "<public name> from Mingla" (or "Mingla Team") and
 * flags Who's selling and PIN pad rows with isMinglaTeam. Host shows that name
 * as is on every surface: Who's selling, the PIN pad and its approvers, the day
 * close (sales and tips by person, late payments "Taken by") and the CSV. A
 * Mingla admin is listed like any Brand admin (Seth: full parity); an email
 * never shows.
 *
 * FAILS-ON-REVERT: drop isMinglaTeam from mapTillServers or mapTillPinStaff and
 * N-1 / N-2 fail; put back "<name> (Mingla support)" in personName or the CSV
 * and N-3 / N-4 fail.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn() },
}));
jest.mock("../../../../utils/guestCsvExport", () => ({ exportCsvText: jest.fn(async () => ({ method: "downloaded" })) }));

import { mapTillServers } from "../../../../services/venueTillService";
import { mapTillPinStaff } from "../../../../services/tillPinService";
import { mapDayExport, mapDaySummary } from "../../../../services/venueDayCloseService";
import { latePaymentTitle, personName } from "../../close/dayCloseModel";
import { serializeDayCloseCsv } from "../../../../utils/dayCloseCsv";

const KUNLE = "Kunle from Mingla";

describe("#4490 Till staff names after #4579", () => {
  test("N-1 Who's selling: a Mingla admin is listed by the Mingla name, flagged, never an email", () => {
    const servers = mapTillServers({
      servers: [
        { userId: "u-ada", name: "Ada Seller", isMinglaTeam: false, role: "venue_staff", openChecks: 1 },
        { userId: "u-kunle", name: KUNLE, isMinglaTeam: true, role: "brand_admin", openChecks: 0 },
        { userId: "u-team", name: "Mingla Team", isMinglaTeam: true, role: "brand_admin", openChecks: 0 },
      ],
    });
    expect(servers.map((s) => [s.name, s.isMinglaTeam])).toEqual([
      ["Ada Seller", false],
      [KUNLE, true],
      ["Mingla Team", true],
    ]);
    expect(JSON.stringify(servers)).not.toMatch(/@/);
  });

  test("N-2 PIN pad and approvers: a Mingla admin can hold a PIN and approve, by the Mingla name", () => {
    const staff = mapTillPinStaff({
      gated: true,
      venueName: "Names Bar",
      autoLockMinutes: 2,
      managerHasPin: true,
      staff: [
        { memberId: "m-kunle", name: KUNLE, isMinglaTeam: true, role: "brand_admin", profile: null,
          canSell: true, canApprove: true, canManage: true },
        { memberId: "m-ada", name: "Ada Seller", role: "venue_staff", profile: "custom",
          canSell: true, canApprove: false, canManage: false },
      ],
    });
    const kunle = staff.people.find((p) => p.memberId === "m-kunle");
    expect(kunle?.name).toBe(KUNLE);
    expect(kunle?.isMinglaTeam).toBe(true);
    expect(kunle?.canApprove).toBe(true);
    expect(staff.people.find((p) => p.memberId === "m-ada")?.isMinglaTeam).toBe(false);
  });

  test("N-3 day close: sales by person and late payments 'Taken by' show the Mingla name once", () => {
    const person = { userId: "u-kunle", kind: "mingla_support" as const, name: KUNLE };
    expect(personName(person)).toBe(KUNLE);
    expect(personName({ ...person, name: null })).toBe("Mingla Team");
    expect(latePaymentTitle({ checkLabel: null, takenBy: person })).toContain(KUNLE);
    expect(latePaymentTitle({ checkLabel: null, takenBy: person })).not.toContain("support");
    const summary = mapDaySummary({ late: { payments: [{ paymentId: "p1", takenBy: { userId: "u-kunle", kind: "mingla_support", name: KUNLE } }] } });
    expect(summary.late.payments[0]?.takenBy).toEqual(person);
  });

  test("N-4 CSV export: the Mingla admin column reads '<name> from Mingla', never an email", () => {
    const csv = serializeDayCloseCsv(mapDayExport({
      venueName: "Names Bar", businessDate: "2026-11-21", currency: "NGN",
      rows: [
        { paymentId: "p1", reference: "AB12CD34", paidAtLocal: "2026-11-21 19:00", check: null, method: "cash",
          amountMinor: 550000, serviceChargeMinor: 0, tipMinor: 0, guestFeeMinor: 0, refundedMinor: 0,
          takenBy: { kind: "mingla_support", name: KUNLE }, server: { kind: "mingla_support", name: null },
          paidAfterCancel: false, late: false },
      ],
    }));
    const row = csv.trim().split("\r\n")[1] ?? "";
    expect(row).toContain(`,${KUNLE},Mingla Team,`);
    expect(csv).not.toMatch(/@|support/);
  });
});
