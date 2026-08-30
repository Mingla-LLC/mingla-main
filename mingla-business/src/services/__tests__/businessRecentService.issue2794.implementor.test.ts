import {
  newRecentOperationId,
  recentErrorCategory,
} from "../businessRecentService";

test("#2794 operation ids are UUID-shaped and error analytics stay categorical", () => {
  expect(newRecentOperationId()).toMatch(/^[0-9a-f-]{36}$/i);
  expect(recentErrorCategory(new Error("recent_brand_forbidden"))).toBe(
    "permission",
  );
  expect(recentErrorCategory(new Error("Network request failed"))).toBe(
    "network",
  );
  expect(recentErrorCategory(new Error("secret backend detail"))).toBe(
    "unknown",
  );
});
