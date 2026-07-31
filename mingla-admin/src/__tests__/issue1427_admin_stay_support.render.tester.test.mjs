import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("tester runtime: Stay venue renders stale state, Rooms, Places, NGN money, photos, and safe actions", async () => {
  const vite = await createServer({
    root: adminRoot,
    appType: "custom",
    server: { middlewareMode: true },
    logLevel: "silent",
  });
  try {
    const [{ buildStayVenueSections }, { EntityDetailView }] = await Promise.all([
      vite.ssrLoadModule("/src/components/stay/StayVenueSections.jsx"),
      vite.ssrLoadModule("/src/components/entity/EntityDetailView.jsx"),
    ]);
    const oldSnapshot = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const sections = buildStayVenueSections({
      snapshotAt: oldSnapshot,
      venue: { name: "Tester Stay", claimStatus: "verified" },
      brand: {
        name: "Tester Brand",
        bankReady: true,
        paymentProvider: "paystack",
        currencyCode: "NGN",
        provisionalCurrencyCode: "NGN",
        currencyReconciliationPending: false,
      },
      settings: {
        propertyKind: "resort",
        bookingState: "active",
        bookingMode: "instant",
        checkInTime: "15:00",
        checkOutTime: "11:00",
        timezone: "Africa/Lagos",
        version: 7,
      },
      flags: { STAY_DISCOVERY: false, STAY_RESERVATIONS: false },
      offerings: [
        {
          id: "room-1",
          kind: "room",
          name: "Ocean Suite",
          summary: "One room",
          status: "live",
          version: 3,
          confirmationMode: "instant",
          inventoryBasis: "pooled",
          quantity: 4,
          minGuests: 1,
          maxGuests: 2,
          price: { amountMinor: "850000", currencyCode: "NGN", pricingUnit: "per_night", versionNumber: 2 },
          fees: [],
          media: [{ isCover: true, status: "ready", publicUrl: "https://images.example.test/ocean.jpg", altText: "Ocean Suite", sortOrder: 0 }],
          amenities: ["Wi-Fi"],
          availability: { roomNightCount: 60, roomNightStopSellCount: 2 },
        },
        {
          id: "place-1",
          kind: "place",
          name: "Spa Pavilion",
          summary: "Reservable spa",
          status: "paused",
          version: 2,
          confirmationMode: "request",
          inventoryBasis: "capacity",
          capacity: 12,
          minGuests: 1,
          maxGuests: 12,
          price: { amountMinor: "250000", currencyCode: "NGN", pricingUnit: "per_booking", versionNumber: 1 },
          fees: [],
          media: [],
          amenities: ["Massage"],
          availability: { placeWindowCount: 10, placeWindowStopSellCount: 1 },
        },
      ],
      bulkFailures: [],
    }, { onPause: () => undefined });

    const html = renderToStaticMarkup(React.createElement(EntityDetailView, {
      header: { title: "Tester Stay", badges: [] },
      sections,
    }));
    assert.match(html, /Stale — reload before acting/);
    assert.match(html, /Room · Ocean Suite/);
    assert.match(html, /Place · Spa Pavilion/);
    assert.match(html, /NGN/);
    assert.doesNotMatch(html, /\$8,500/);
    assert.match(html, /Ocean Suite/);
    assert.match(html, /Pause this offering/);
    assert.doesNotMatch(html, /storage_object|checksum|guest_snapshot/);
  } finally {
    await vite.close();
  }
});
