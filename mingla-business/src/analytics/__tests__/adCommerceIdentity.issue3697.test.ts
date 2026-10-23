import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const businessRoot = resolve(__dirname, "../../..");

function read(path: string): string {
  return readFileSync(resolve(businessRoot, path), "utf8");
}

test("#3697 every production checkout create supplies offering and brand identity", () => {
  const callSites = [
    {
      path: "app/checkout/[eventId]/payment.tsx",
      event: "eventId,",
      brand: "brandId: event?.brandId ?? brand?.id",
    },
    {
      path: "app/checkout/[eventId]/buyer.tsx",
      event: "eventId,",
      brand: "brandId: event?.brandId ?? brand?.id",
    },
    {
      path: "app/checkout-trip/[tripEventId]/payment.tsx",
      event: "eventId: tripEventId",
      brand: "brandId: trip?.brandId",
    },
    {
      path: "app/checkout-trip/[tripEventId]/buyer.tsx",
      event: "eventId: tripEventId",
      brand: "brandId: trip?.brandId",
    },
    {
      path: "app/checkout-experience/[experienceEventId]/payment.tsx",
      event: "eventId: experienceEventId",
      brand: "brandId: experience?.brandId",
    },
    {
      path: "app/checkout-experience/[experienceEventId]/buyer.tsx",
      event: "eventId: experienceEventId",
      brand: "brandId: experience?.brandId",
    },
  ];

  for (const callSite of callSites) {
    const source = read(callSite.path);
    const callStart = source.indexOf("await createTicketCheckout({");
    expect(callStart).toBeGreaterThan(-1);
    const create = source.slice(
      callStart,
      callStart + 700,
    );
    expect(create).toContain(callSite.event);
    expect(create).toContain(callSite.brand);
  }

  const service = read("src/services/ticketCheckoutService.ts");
  expect(service).toContain("contentId: input.eventId");
  expect(service).toContain("brandId: input.brandId");
});

test("#3697 every checkout confirmation waits for and sends offering plus brand identity", () => {
  const confirmations = [
    {
      path: "app/checkout/[eventId]/confirm.tsx",
      content: "contentId: eventId",
    },
    {
      path: "app/checkout-trip/[tripEventId]/confirm.tsx",
      content: "contentId: tripEventId",
    },
    {
      path: "app/checkout-experience/[experienceEventId]/confirm.tsx",
      content: "contentId: experienceEventId",
    },
  ];

  for (const confirmation of confirmations) {
    const source = read(confirmation.path);
    expect(source).toContain("const purchaseBrandId =");
    expect(source).toContain(confirmation.content);
    expect(source).toContain("brandId: purchaseBrandId");
    expect(source).toMatch(/result === null[\s\S]{0,100}purchaseBrandId === null/);
  }
});
