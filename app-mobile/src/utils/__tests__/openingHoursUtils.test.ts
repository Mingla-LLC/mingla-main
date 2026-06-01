// @ts-nocheck
import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isPlaceOpenAt } from "../openingHoursUtils.ts";

const saturdayAt = (hour: number, minute = 30) => new Date(2026, 4, 30, hour, minute, 0);

Deno.test("ORCH-1021: 9:00 - 12:00 PM closes at noon, not overnight", () => {
  const hours = ["Saturday: 9:00 - 12:00 PM"];

  assertEquals(isPlaceOpenAt(hours, saturdayAt(8)), false);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(9)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(11)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(12, 0)), false);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(23)), false);
});

Deno.test("ORCH-1021: 11:00 - 12:00 PM is a late-morning window", () => {
  const hours = ["Saturday: 11:00 - 12:00 PM"];

  assertEquals(isPlaceOpenAt(hours, saturdayAt(11)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(12, 1)), false);
});

Deno.test("ORCH-1021: 10:00 - 5:00 PM remains daytime", () => {
  const hours = ["Saturday: 10:00 - 5:00 PM"];

  assertEquals(isPlaceOpenAt(hours, saturdayAt(16, 59)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(17, 1)), false);
});

Deno.test("ORCH-1021: 5:00 - 10:00 PM remains evening", () => {
  const hours = ["Saturday: 5:00 - 10:00 PM"];

  assertEquals(isPlaceOpenAt(hours, saturdayAt(16, 59)), false);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(18, 0)), true);
});

Deno.test("ORCH-1021: 12:00 - 5:00 PM remains noon-to-five", () => {
  const hours = ["Saturday: 12:00 - 5:00 PM"];

  assertEquals(isPlaceOpenAt(hours, saturdayAt(11, 59)), false);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(12, 0)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(16, 59)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(17, 0)), false);
});

Deno.test("ORCH-1021: overnight AM-close shorthand still crosses midnight", () => {
  const hours = ["Saturday: 9:00 - 1:00 AM"];

  assertEquals(isPlaceOpenAt(hours, saturdayAt(20, 59)), false);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(21, 0)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(0, 30)), true);
  assertEquals(isPlaceOpenAt(hours, saturdayAt(1, 0)), false);
});
