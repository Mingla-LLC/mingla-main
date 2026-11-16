/**
 * #4420 native run: the Host address field was padding-derived (~38pt) next to
 * 48pt inputs on the trip Basics step. The Host wrapper now hands the shared
 * field a height floor equal to the Host input size.
 *
 * [TEST-MOD-APPROVED #4420] — was a source-text pin (I-PROPOSED-1047-NO-SOLE-
 * SOURCE-PIN); now mounts the real Host AddressInput and reads the token
 * bundle it passes to the shared field. The shared field's own use of the
 * optional floor is pinned by the I-4420-HOST-WIRING strict-grep gate.
 *
 * FAILS ON REVERT: the Host bundle drops the floor, or it stops matching
 * size.input.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

import { size } from "../../../constants/designSystem";

let mockTokens: { field: { minHeight?: number } } | undefined;

jest.mock("../sharedAddressField", () => ({
  SharedAddressInput: (props: { tokens: { field: { minHeight?: number } } }) => {
    mockTokens = props.tokens;
    return null;
  },
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => unknown;
  act: (work: () => void) => void;
};
const { AddressInput } = require("../AddressInput") as typeof import("../AddressInput");

describe("#4420 Host address field height", () => {
  test("the Host token bundle floors the field at the 48pt input size", () => {
    TestRenderer.act(() => {
      TestRenderer.create(
        <AddressInput value="" onChangeText={() => undefined} onPick={() => undefined} onClear={() => undefined} />,
      );
    });
    expect(size.input).toBe(48);
    expect(mockTokens?.field.minHeight).toBe(size.input);
  });
});
