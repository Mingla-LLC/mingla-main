import fs from "node:fs";
import path from "node:path";

const stayDirectory = path.resolve(__dirname, "..");
const moduleSource = fs.readFileSync(
  path.join(stayDirectory, "StayReservationsModule.tsx"),
  "utf8",
);
const createSource = fs.readFileSync(
  path.join(stayDirectory, "StayStaffReservationCreateSheet.tsx"),
  "utf8",
);
const detailSource = fs.readFileSync(
  path.join(stayDirectory, "StayReservationManagementDetail.tsx"),
  "utf8",
);
const lazyBookingSource = fs.readFileSync(
  path.join(stayDirectory, "StayGuestBooking.lazy.ts"),
  "utf8",
);
const staffDetailServiceSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../services/staffStayDetailService.ts",
  ),
  "utf8",
);
const sharedBookingSource = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../../packages/brand-rendering/StayGuestBooking.tsx",
  ),
  "utf8",
);

describe("#4188 Stay staff front-desk reservation contract", () => {
  it("gates the add action on the server-projected create permission", () => {
    expect(moduleSource).toContain("list.data?.permissions.canCreate");
    expect(moduleSource).toContain('testID="stay-add-reservation"');
  });

  it("uses canonical Stay selection and offers honest link/property collection", () => {
    expect(createSource).toContain("<LazyStayGuestBooking");
    expect(createSource).toContain(
      'import("./StayGuestBooking.lazy")',
    );
    expect(lazyBookingSource).toContain(
      '@mingla/brand-rendering/StayGuestBooking',
    );
    expect(createSource).toContain("useStaffStayDetail");
    expect(createSource).not.toContain("usePublicStayDetail");
    expect(staffDetailServiceSource).toContain('"issue_4188_staff_stay_details"');
    expect(createSource).toContain('checkoutContext="staff"');
    expect(createSource).toContain("stayReservationService.quote");
    expect(createSource).toContain("stayReservationService.createStaffGroup");
    expect(createSource).toContain("Send a secure payment link");
    expect(createSource).toContain("Pay at property");
    expect(createSource).toContain(
      "Mingla will not charge or refund the guest",
    );
    expect(createSource).toContain("sendEmail");
    expect(createSource).toContain("sendSms");
    expect(createSource).toContain("paymentMethod");
    expect(createSource).toContain('replaceAll("_", " ")');
    expect(createSource).toContain("deliveryStatusLabel(");
    expect(sharedBookingSource).toContain(
      'checkoutContext?: "guest" | "staff"',
    );
    expect(sharedBookingSource).toContain('"Confirm reservation"');
    expect(createSource).toContain("dismissDisabled={submitting}");
  });

  it("warns that property refunds happen outside Mingla", () => {
    expect(detailSource).toContain(
      "Mingla did not collect this payment, so it will not issue a refund.",
    );
    expect(detailSource).toContain(
      'group.paymentCollection === "property"',
    );
  });
});
