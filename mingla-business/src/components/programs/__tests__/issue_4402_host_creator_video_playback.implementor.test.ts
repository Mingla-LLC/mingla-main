// #4402 live finding (Host web, production): tapping a creator showcase fed
// Bunny's signed EMBED page (player.mediadelivery.net/embed/...) to a raw
// <video> element: readyState 0, MediaError 4, a frozen 0:00 player with no
// message. Hosts could never watch a creator's video.
//
// The fix plays it the way Explorer (CreatorMediaPlayerModal, WebView) and
// Admin (iframe) do: an iframe on web, a WebView on native, and a visible
// error when it can't play. Fails on 0f4e29393c: ShowcaseStrip and the gig
// contract screen played the embed URL through FullScreenVideoViewer
// (expo-video VideoView).
import fs from "fs";
import path from "path";

import {
  CREATOR_VIDEO_ERROR,
  creatorVideoSurface,
  isCreatorEmbedUrl,
} from "../../../utils/creatorProgramFormat";

const EMBED = "https://player.mediadelivery.net/embed/793805/0b1c2d3e-aaaa-bbbb-cccc-123456789abc?token=t&expires=1";
const read = (rel: string): string => fs.readFileSync(path.join(__dirname, rel), "utf8");
const strip = read("../ShowcaseStrip.tsx");
const contract = read("../../creators/screens/HostGigContractScreen.tsx");

describe("#4402 Host plays creator videos through the embed, never a raw video element", () => {
  it("an embed link plays in an iframe on web and a WebView on native", () => {
    expect(isCreatorEmbedUrl(EMBED)).toBe(true);
    expect(creatorVideoSurface(EMBED, "web")).toBe("iframe");
    expect(creatorVideoSurface(EMBED, "ios")).toBe("webview");
    expect(creatorVideoSurface(EMBED, "android")).toBe("webview");
  });

  it("anything that is not a Bunny embed link is an error state, not a silent player", () => {
    for (const bad of [null, "", "http://player.mediadelivery.net/embed/1/2", "https://evil.example/embed/1/2", "https://vz-1.b-cdn.net/x/playlist.m3u8"]) {
      expect(creatorVideoSurface(bad, "web")).toBe("error");
    }
    expect(CREATOR_VIDEO_ERROR).toMatch(/couldn't play/);
  });

  it("the showcase and the delivered gig video both use the embed player", () => {
    for (const source of [strip, contract]) {
      expect(source).not.toMatch(/FullScreenVideoViewer/);
      expect(source).not.toMatch(/VideoView|useVideoPlayer|expo-video/);
    }
    expect(contract).toMatch(/<CreatorVideoPlayer\s+url=\{videoUri\}/);
    expect(strip).toMatch(/<CreatorVideoPlayer\s+url=\{uri\}/);
  });

  it("the player renders an iframe / WebView for the embed and shows the error when loading fails", () => {
    const player = strip.slice(strip.indexOf("export function CreatorVideoPlayer"));
    expect(player).toMatch(/creatorVideoSurface\(url, Platform\.OS\)/);
    expect(player).toMatch(/React\.createElement\("iframe", \{[\s\S]*src: url,[\s\S]*onError: \(\) => setFailed\(true\)/);
    expect(player).toMatch(/<WebView[\s\S]*source=\{\{ uri: url \}\}[\s\S]*onError=\{\(\) => setFailed\(true\)\}[\s\S]*onHttpError=\{\(\) => setFailed\(true\)\}/);
    expect(player).toMatch(/accessibilityRole="alert"[\s\S]*\{CREATOR_VIDEO_ERROR\}/);
    expect(player).not.toMatch(/<video/);
  });
});
