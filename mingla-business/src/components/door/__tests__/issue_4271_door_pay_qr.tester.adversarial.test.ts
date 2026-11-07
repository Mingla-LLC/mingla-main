/**
 * #4271 — TESTER adversarial suite for the door pay QR (a door code is not a
 * ticket). Different angle from the implementor's guard test: the COMPONENT
 * itself is called with values a careless caller (or a cast) could hand it —
 * real ticket QR payloads from this codebase (`door:<uuid>`, signed ticket
 * tokens), look-alike pay links (query strings, path traversal, a different
 * host via `@`, http downgrade, lowercase or ambiguous letters, trailing
 * whitespace, a homoglyph) — and must throw before anything reaches the QR
 * encoder. A real pay link must reach the encoder byte-for-byte.
 *
 * fails-on-revert (verified by the tester): removing the
 * `assertDoorPayUrl(url)` call in DoorPayQr.tsx (passing `url` straight to
 * the encoder) fails "refuses every non pay-link value".
 */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("../../../constants/publicUrls", () => ({
  BUSINESS_PUBLIC_ORIGIN: "https://host.usemingla.com",
}));
jest.mock("react-native", () => ({
  StyleSheet: { create: <T,>(s: T): T => s },
  View: "View",
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
}));
jest.mock("../../../constants/designSystem", () => ({ radius: { lg: 16 } }));
jest.mock("react-native-qrcode-svg", () => ({ __esModule: true, default: () => null }));

import { DoorPayQr } from "../DoorPayQr";
import { makeDoorPayUrl, type DoorPayUrl } from "../doorPayUrl";

/** Walks a rendered element tree and returns every QR `value` prop. */
const qrValues = (node: unknown, out: string[] = []): string[] => {
  if (node === null || typeof node !== "object") return out;
  const el = node as { props?: Record<string, unknown> };
  const props = el.props ?? {};
  if (typeof props.value === "string" && typeof props.size === "number") out.push(props.value);
  const children = props.children;
  if (Array.isArray(children)) children.forEach((c) => qrValues(c, out));
  else qrValues(children, out);
  return out;
};

const render = (url: unknown) =>
  DoorPayQr({ url: url as DoorPayUrl, size: 200 }) as React.ReactElement;

describe("#4271 tester: DoorPayQr", () => {
  test("refuses every non pay-link value before the encoder sees it", () => {
    const hostile: unknown[] = [
      // Ticket credentials this codebase mints or scans.
      "door:6f1c2d0e-1a2b-4c3d-8e9f-001122334455",
      "mingla:ticket:6f1c2d0e-1a2b-4c3d-8e9f-001122334455",
      "MTK1.eyJ0IjoiNmYxYyJ9.c2lnbmF0dXJl",
      "6f1c2d0e-1a2b-4c3d-8e9f-001122334455",
      // Look-alike pay links.
      "https://host.usemingla.com/pay/door/ABCD2345?ticket=door:6f1c2d0e",
      "https://host.usemingla.com/pay/door/ABCD2345#t=door:6f1c2d0e",
      "https://host.usemingla.com/pay/door/ABCD2345/../../t/6f1c2d0e",
      "https://host.usemingla.com/pay/door/ABCD2345/",
      "https://host.usemingla.com@evil.example/pay/door/ABCD2345",
      "https://host.usemingla.com.evil.example/pay/door/ABCD2345",
      "http://host.usemingla.com/pay/door/ABCD2345",
      "https://host.usemingla.com/pay/door/abcd2345",
      "https://host.usemingla.com/pay/door/ABCD0O1I",
      "https://host.usemingla.com/pay/door/ABCD2345 ",
      "https://host.usemingla.com/pay/door/ABCD2345\n",
      "https://host.usemingla.com/pay/door/ABCD234",
      "https://host.usemingla.com/pay/door/ABCD23456",
      "https://host.usemingla.com/pay/door/АBCD2345", // Cyrillic А
      "https://host.usemingla.com/t/ABCD2345",
      "",
      null,
      undefined,
      42,
      { toString: () => "https://host.usemingla.com/pay/door/ABCD2345" },
    ];
    for (const value of hostile) {
      expect(() => render(value)).toThrow(/pay\/door|door pay code/i);
    }
  });

  test("a real pay link reaches the encoder unchanged", () => {
    const url = makeDoorPayUrl("K7Q2M9XA");
    const values = qrValues(render(url));
    expect(values).toEqual(["https://host.usemingla.com/pay/door/K7Q2M9XA"]);
  });

  test("the pay link can only be minted from the server's code alphabet", () => {
    for (const code of ["K7Q2-M9XA", "k7q2m9xa", "K7Q2M9X", "K7Q2M9XAA", "O0I1L000", "door:abc"]) {
      expect(() => makeDoorPayUrl(code)).toThrow();
    }
  });
});
