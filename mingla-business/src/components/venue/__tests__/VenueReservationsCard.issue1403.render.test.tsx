import React from "react";

interface RenderNode {
  props: { children?: unknown };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
jest.mock("../../../services/supabase", () => ({ supabase: {} }));
import { VenueReservationsCard } from "../VenueReservationsCard";

describe("issue #1403 venue Reservations card", () => {
  const allText = (tree: RenderTree): string =>
    tree.root
      .findAll((node) => typeof node.props.children === "string")
      .map((node) => String(node.props.children))
      .join(" ");

  it("renders exact venue metrics, source order and separate currencies", async () => {
    const query = {
      data: {
        brandId: "brand",
        venueId: "venue-a",
        authorized: true,
        resolvedTimezone: "America/New_York",
        timezoneConfidence: "iana",
        covers30d: 4,
        coversLifetime: 7,
        averagePartySize: 2.5,
        noShowRate: 0.125,
        bySource: [
          { source: "mingla", reservations: 3, covers: 4 },
          { source: "phone", reservations: 1, covers: 3 },
        ],
        valueCents30d: { GBP: 1200 },
        valueCentsLifetime: { GBP: 1200, NGN: 250000 },
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    };
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueReservationsCard query={query as never} onRetry={jest.fn()} />,
      );
    });
    const output = allText(tree!);
    expect(output).toContain("Reservations");
    expect(output).toContain("4 covers");
    expect(output).toContain("7 covers");
    expect(output).toContain("12.5%");
    expect(output).toContain("£12.00 paid fees");
    expect(output).toContain("₦2,500.00 paid fees");
    expect(output).toContain("Mingla");
    expect(output).toContain("Phone");
  });

  it("shows future reservations without fabricating a zero no-show rate", async () => {
    const query = {
      data: {
        brandId: "brand",
        venueId: "venue-b",
        authorized: true,
        resolvedTimezone: "Europe/London",
        timezoneConfidence: "iana",
        covers30d: 0,
        coversLifetime: 0,
        averagePartySize: 3,
        noShowRate: 0,
        bySource: [{ source: "website", reservations: 1, covers: 0 }],
        valueCents30d: {},
        valueCentsLifetime: {},
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch: jest.fn(),
    };
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <VenueReservationsCard query={query as never} onRetry={jest.fn()} />,
      );
    });
    const output = allText(tree!);
    expect(output).toContain("Not enough completed visits yet");
    expect(output).toContain("1 reservation · 0 covers");
    expect(output).not.toContain("0%");
    expect(output).not.toContain("No reservation performance yet");
  });
});
