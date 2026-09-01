import { describe, expect, it } from "vitest";
import { sitesJsonResponse } from "./http";

describe("sitesJsonResponse issue #2919 regression", () => {
  it("preserves both secure Studio cookies and response headers", () => {
    const headers = new Headers();
    headers.append(
      "set-cookie",
      "mingla_studio_session=session-token; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax",
    );
    headers.append(
      "set-cookie",
      "mingla_studio_csrf=csrf-token; Path=/; Max-Age=1800; Secure; SameSite=Lax",
    );
    headers.set("x-mingla-response", "editor-exchange");

    const response = sitesJsonResponse({ ok: true }, 200, headers);
    const cookies = response.headers.getSetCookie();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("x-mingla-response")).toBe("editor-exchange");
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toBe(
      "mingla_studio_session=session-token; Path=/; Max-Age=28800; Secure; HttpOnly; SameSite=Lax",
    );
    expect(cookies[1]).toBe(
      "mingla_studio_csrf=csrf-token; Path=/; Max-Age=1800; Secure; SameSite=Lax",
    );
  });
});
