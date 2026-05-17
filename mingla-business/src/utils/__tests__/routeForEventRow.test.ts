/**
 * ORCH-0865 [trips-leak systemic + routeForEventRow helper] — happy-path
 * regression test for routeForEventRow.
 *
 * Pins the full routing matrix so the helper cannot silently regress.
 * Fails-on-revert: any single case removed or mis-routed causes the
 * matching assertion to fail.
 */

import { describe, expect, test } from "@jest/globals";

import {
  routeForEventRow,
  routeForEventRowDefensive,
} from "../routeForEventRow";

describe("ORCH-0865 — routeForEventRow matrix", () => {
  test("trip draft → /trip/{id}/edit", () => {
    expect(
      routeForEventRow({ id: "t1", event_type: "trip", status: "draft" }),
    ).toBe("/trip/t1/edit");
  });

  test("trip scheduled → /trip/{id}", () => {
    expect(
      routeForEventRow({ id: "t2", event_type: "trip", status: "scheduled" }),
    ).toBe("/trip/t2");
  });

  test("trip live → /trip/{id}", () => {
    expect(
      routeForEventRow({ id: "t3", event_type: "trip", status: "live" }),
    ).toBe("/trip/t3");
  });

  test("trip ended → /trip/{id}", () => {
    expect(
      routeForEventRow({ id: "t4", event_type: "trip", status: "ended" }),
    ).toBe("/trip/t4");
  });

  test("event draft → /event/{id}/edit", () => {
    expect(
      routeForEventRow({ id: "e1", event_type: "event", status: "draft" }),
    ).toBe("/event/e1/edit");
  });

  test("event scheduled → /event/{id}", () => {
    expect(
      routeForEventRow({ id: "e2", event_type: "event", status: "scheduled" }),
    ).toBe("/event/e2");
  });

  test("event live → /event/{id}", () => {
    expect(
      routeForEventRow({ id: "e3", event_type: "event", status: "live" }),
    ).toBe("/event/e3");
  });

  test("experience (any status) → /experience/coming-soon", () => {
    expect(
      routeForEventRow({ id: "x1", event_type: "experience", status: "draft" }),
    ).toBe("/experience/coming-soon");
    expect(
      routeForEventRow({
        id: "x2",
        event_type: "experience",
        status: "scheduled",
      }),
    ).toBe("/experience/coming-soon");
  });
});

describe("ORCH-0865 — routeForEventRowDefensive (missing event_type defaults to event)", () => {
  test("missing event_type → treats as event, status draft → /event/{id}/edit", () => {
    expect(routeForEventRowDefensive({ id: "e1", status: "draft" })).toBe(
      "/event/e1/edit",
    );
  });

  test("missing event_type → treats as event, status published → /event/{id}", () => {
    expect(routeForEventRowDefensive({ id: "e2", status: "scheduled" })).toBe(
      "/event/e2",
    );
  });

  test("eventType (camelCase) trip → /trip/{id}", () => {
    expect(
      routeForEventRowDefensive({
        id: "t1",
        eventType: "trip",
        status: "scheduled",
      }),
    ).toBe("/trip/t1");
  });

  test("event_type (snake_case) trip + draft → /trip/{id}/edit", () => {
    expect(
      routeForEventRowDefensive({
        id: "t2",
        event_type: "trip",
        status: "draft",
      }),
    ).toBe("/trip/t2/edit");
  });
});
