/**
 * N133 (#4490) — "Use {Venue}'s cover" is offered only for a cover the edge
 * will copy: the brand's own brand_covers upload (and a GIF's poster), or a
 * video. GIPHY / Pexels covers are not offered (the copy would always fail).
 *
 * Fails-on-revert: returning true for any URL fails the GIPHY / Pexels cases.
 */
jest.mock("../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: false }) }));
jest.mock("../../services/supabase", () => ({ supabase: {} }));

import { venueCoverIsCopyable } from "../useEventVenueCover";

const base = "https://x.supabase.co/storage/v1/object/public/";

describe("N133 venue cover copyable", () => {
  it("the brand's own uploaded cover is offered", () => {
    expect(venueCoverIsCopyable({ brandId: "b1", url: `${base}brand_covers/b1/v1/c.jpg`, posterUrl: null, type: "image" })).toBe(true);
    expect(venueCoverIsCopyable({ brandId: "b1", url: `${base}brand_covers/b1/v1/c.gif`, posterUrl: `${base}brand_covers/b1/v1/p.jpg`, type: "gif" })).toBe(true);
  });

  it("GIPHY and Pexels covers are not offered", () => {
    expect(venueCoverIsCopyable({ brandId: "b1", url: "https://media.giphy.com/media/abc/giphy.gif", posterUrl: "https://media.giphy.com/media/abc/giphy_s.gif", type: "gif" })).toBe(false);
    expect(venueCoverIsCopyable({ brandId: "b1", url: "https://images.pexels.com/photos/1/pexels-photo-1.jpeg", posterUrl: null, type: "image" })).toBe(false);
  });

  it("another brand's folder, a private bucket or a foreign GIF poster are not offered", () => {
    expect(venueCoverIsCopyable({ brandId: "b1", url: `${base}brand_covers/b2/v/c.jpg`, posterUrl: null, type: "image" })).toBe(false);
    expect(venueCoverIsCopyable({ brandId: "b1", url: `${base}support-attachments/x.png`, posterUrl: null, type: "image" })).toBe(false);
    expect(venueCoverIsCopyable({ brandId: "b1", url: `${base}brand_covers/b1/v/c.gif`, posterUrl: "https://media.giphy.com/x.gif", type: "gif" })).toBe(false);
  });

  it("a video cover is offered; no cover is not", () => {
    expect(venueCoverIsCopyable({ brandId: "b1", url: "https://vz.example/v.mp4", posterUrl: "https://vz.example/p.jpg", type: "video" })).toBe(true);
    expect(venueCoverIsCopyable({ brandId: "b1", url: null, posterUrl: null, type: null })).toBe(false);
  });
});
