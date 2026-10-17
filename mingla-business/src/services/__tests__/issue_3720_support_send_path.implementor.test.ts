/* eslint-disable import/first */
/**
 * #3720 Support send + actual-person attribution + Help Centre (implementor).
 * [TEST-MOD-APPROVED #3720] Wave 2 replaces the fictional Support identity.
 *
 * Pins:
 *   - sendSupportMessage invokes support-send with ticketId + trimmed content
 *   - SupportThreadCore uses sendSupportMessage (not postPlannerMessage)
 *   - Help & Support shows Help Centre videos → usemingla.com/help
 *   - Host-facing agent string matches the edge mirror
 *
 * Fails-on-revert: restoring postPlannerMessage in SupportThreadCore or dropping
 * the Help Centre row turns these red.
 */
import { describe, expect, jest, test, beforeEach } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

type DbResult = Promise<{ data: unknown; error: unknown }>;
const invokeMock = jest.fn<(...args: unknown[]) => DbResult>();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}));

import { sendSupportMessage } from "../supportService";
import { SUPPORT_HOST_FACING_AGENT, HELP_CENTRE_URL } from "../../constants/supportHostFacing";

const ROOT = path.resolve(__dirname, "../../..");

describe("#3720 support send path (implementor)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("sendSupportMessage invokes support-send with trimmed content", async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    await sendSupportMessage("ticket-1", "  hello team  ");
    expect(invokeMock).toHaveBeenCalledWith("support-send", {
      body: { ticketId: "ticket-1", content: "hello team" },
    });
  });

  test("sendSupportMessage rejects blank content before invoke", async () => {
    await expect(sendSupportMessage("ticket-1", "   ")).rejects.toThrow();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("SupportThreadCore routes sends through sendSupportMessage", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "src/components/support/SupportThreadCore.tsx"),
      "utf8",
    );
    expect(src).toMatch(/sendSupportMessage/);
    expect(src).not.toMatch(/postPlannerMessage/);
    expect(src).toMatch(/SUPPORT_HOST_FACING_AGENT/);
    expect(src).toMatch(/from ["']\.\.\/\.\.\/constants\/supportHostFacing["']/);
  });

  test("Help & Support Guides tab exposes Help Centre videos link", () => {
    // #3720 Slice G moved Help Centre into GuidesTabPanel (still under hub).
    const src = fs.readFileSync(
      path.join(ROOT, "src/components/support/GuidesTabPanel.tsx"),
      "utf8",
    );
    expect(src).toContain("Help Centre videos");
    expect(src).toContain("HELP_CENTRE_URL");
    expect(HELP_CENTRE_URL).toBe("https://usemingla.com/help");
  });

  test("Host and edge neutral Support fallbacks stay in lockstep", () => {
    const edge = fs.readFileSync(
      path.join(ROOT, "../supabase/functions/_shared/supportHostFacing.ts"),
      "utf8",
    );
    expect(edge).toContain(`"${SUPPORT_HOST_FACING_AGENT}"`);
  });
});
