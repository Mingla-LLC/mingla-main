// @vitest-environment jsdom
/*
 * #2829 W6 (AD-9) — hero background video and brand film rules.
 *
 * Hero: poster first (server renders no <video>); muted loop playsinline
 * autoplay preload=metadata with the poster; an always-visible pause/play
 * button (44×44 in CSS, labelled) whose choice lasts the visit; NO video for
 * reduced motion or Save-Data (the header or navigator.connection.saveData).
 * Film: still + labelled play button over a complete native player, nothing
 * fetched before play, inline playback after; no button when nothing plays.
 * Which URL plays: the publication's own file video, or a stream video only
 * on an allowed CDN host.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HERO_VIDEO_PAUSED_KEY, HeroBackgroundVideo } from "./HeroBackgroundVideo";
import { BrandFilm } from "./BrandFilm";
import { playableVideoUrl, streamVideoHosts, wantsLessData } from "../../lib/siteVideo";
import { buildCsp, mediaSrcFor } from "../../lib/csp";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let reducedMotion = false;
let saveData: boolean | undefined;
let playing = false;
const play = vi.fn(() => {
  playing = true;
  return Promise.resolve();
});
const pause = vi.fn();

beforeEach(() => {
  reducedMotion = false;
  saveData = undefined;
  window.sessionStorage.clear();
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("reduce") ? reducedMotion : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    get: () => (saveData === undefined ? undefined : { saveData, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  playing = true; // an autoplaying hero is playing until paused
  play.mockClear();
  pause.mockClear();
  Object.defineProperty(HTMLMediaElement.prototype, "paused", { configurable: true, get: () => !playing });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: function (this: HTMLMediaElement) {
      playing = false;
      pause();
      this.dispatchEvent(new Event("pause"));
    },
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (element: React.ReactElement) => act(() => root.render(element));
const hero = (props: Partial<{ saveData: boolean }> = {}) =>
  mount(<HeroBackgroundVideo src="/media/v/video.mp4" poster="/media/p/1440.webp" {...props} />);

describe("#2829 hero background video", () => {
  it("renders no <video> on the server (the poster is the first paint)", () => {
    expect(renderToStaticMarkup(<HeroBackgroundVideo src="/media/v/video.mp4" poster="/p.webp" />)).toBe("");
  });

  it("plays muted, looped, inline and automatically, poster first, metadata only", () => {
    hero();
    const video = container.querySelector("video")!;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("muted")).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.getAttribute("poster")).toBe("/media/p/1440.webp");
    expect(video.getAttribute("aria-hidden")).toBe("true");
  });

  it("always shows a labelled pause control; pausing holds for the visit, playing resumes", async () => {
    hero();
    const button = container.querySelector("button.hero-video-toggle")!;
    expect(button.getAttribute("aria-label")).toBe("Pause background video");
    act(() => (button as HTMLButtonElement).click());
    expect(pause).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Play background video");
    expect(window.sessionStorage.getItem(HERO_VIDEO_PAUSED_KEY)).toBe("1");
    await act(async () => (button as HTMLButtonElement).click());
    expect(play).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-label")).toBe("Pause background video");
    expect(window.sessionStorage.getItem(HERO_VIDEO_PAUSED_KEY)).toBeNull();
  });

  it("starts the muted video explicitly (WebKit decides autoplay before React mutes it)", async () => {
    playing = false;
    await act(async () => root.render(<HeroBackgroundVideo src="/media/v/video.mp4" poster="/p.webp" />));
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Pause background video");
  });

  it("an autoplay the browser declines leaves the button offering Play, never a false Pause", async () => {
    playing = false;
    play.mockImplementationOnce(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    await act(async () => root.render(<HeroBackgroundVideo src="/media/v/video.mp4" poster="/p.webp" />));
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Play background video");
  });

  it("a play refused while hydrating is retried once the video can play (WebKit)", async () => {
    playing = false;
    play.mockImplementationOnce(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    await act(async () => root.render(<HeroBackgroundVideo src="/media/v/video.mp4" poster="/p.webp" />));
    await act(async () => {
      container.querySelector("video")!.dispatchEvent(new Event("canplay"));
    });
    expect(play).toHaveBeenCalledTimes(2);
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Pause background video");
  });

  it("a re-render after the visitor pauses never restarts the video", async () => {
    hero();
    act(() => (container.querySelector("button") as HTMLButtonElement).click());
    play.mockClear();
    await act(async () => root.render(<HeroBackgroundVideo src="/media/v/video.mp4" poster="/media/p/1440.webp" />));
    expect(play).not.toHaveBeenCalled();
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Play background video");
  });

  it("a hero paused earlier this visit does not start again on the next page", () => {
    window.sessionStorage.setItem(HERO_VIDEO_PAUSED_KEY, "1");
    hero();
    expect(container.querySelector("video")!.autoplay).toBe(false);
    expect(container.querySelector("button")!.getAttribute("aria-label")).toBe("Play background video");
  });

  it("mounts NO video and no control for reduced motion", () => {
    reducedMotion = true;
    hero();
    expect(container.innerHTML).toBe("");
  });

  it("mounts NO video for Save-Data (navigator) or the Save-Data header", () => {
    saveData = true;
    hero();
    expect(container.innerHTML).toBe("");
    saveData = undefined;
    hero({ saveData: true });
    expect(container.innerHTML).toBe("");
    expect(wantsLessData(new Headers({ "save-data": "on" }))).toBe(true);
    expect(wantsLessData(new Headers({ "save-data": "off" }))).toBe(false);
    expect(wantsLessData(new Headers())).toBe(false);
  });

  it("the stylesheet gives the control 44×44 and the hero the full visible screen", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "public/designs/atelier/1.css"), "utf8");
    const rule = css.slice(css.indexOf('[data-design="atelier"] .hero-video-toggle {'));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/min-width: 44px;[\s\S]*min-height: 44px;/);
    expect(css).toContain('[data-design="atelier"] .hero.has-video { min-height: 100vh; min-height: 100svh; }');
    expect(css).toMatch(/\.hero-video \{[^}]*object-fit: cover;[^}]*object-position: 50% 50%;/);
  });
});

describe("#2829 brand film", () => {
  it("a complete native player behind a labelled cover; nothing fetched before play", () => {
    mount(<BrandFilm src="/media/f/video.mp4" poster="/media/p/1440.webp" label="Our film" />);
    const video = container.querySelector("video")!;
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.autoplay).toBe(false);
    const cover = container.querySelector("button.brand-film-cover")!;
    expect(cover.textContent).toContain("Play: Our film");
    act(() => (cover as HTMLButtonElement).click());
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector("button")).toBeNull();
    expect(document.activeElement).toBe(video);
  });

  it("works without JavaScript: the server render is the player itself", () => {
    const html = renderToStaticMarkup(<BrandFilm src="/media/f/video.mp4" poster="/p.webp" label="Our film" />);
    expect(html).toContain("<video");
    expect(html).toContain("controls");
    expect(html).not.toContain("<button");
  });

  it("shows only the still when there is nothing it may play", () => {
    mount(<BrandFilm src={null} poster="/p.webp" label="Our film" />);
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("Our film");
  });
});

describe("#2829 which video may play, and the policy that allows it", () => {
  const artifact = {
    media: [
      { url: "/media/f/video.mp4", object_key: "approved/s/f/x/master.mp4" },
      { url: "/media/p/1440.webp", object_key: "approved/s/p/x/1440.webp" },
    ],
    stream_videos: [
      { id: "1", url: "https://vz-ok.b-cdn.net/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4", host: "vz-ok.b-cdn.net", width: 1280, height: 720, duration_ms: 9000 },
      { id: "2", url: "https://evil.example/aaaaaaaa-1111-4111-8111-111111111111/play_720p.mp4", host: "evil.example", width: 1280, height: 720, duration_ms: 9000 },
    ],
  };

  it("plays this publication's file video; never a picture or an unknown address", () => {
    expect(playableVideoUrl(artifact, "/media/f/video.mp4", [])).toBe("/media/f/video.mp4");
    expect(playableVideoUrl(artifact, "/media/p/1440.webp", [])).toBeNull();
    expect(playableVideoUrl(artifact, "/media/other/video.mp4", [])).toBeNull();
    expect(playableVideoUrl(artifact, "https://anywhere.example/v.mp4", ["anywhere.example"])).toBeNull();
  });

  it("plays a stream video only from an allowed CDN host", () => {
    expect(playableVideoUrl(artifact, artifact.stream_videos[0]!.url, ["vz-ok.b-cdn.net"])).toBe(artifact.stream_videos[0]!.url);
    expect(playableVideoUrl(artifact, artifact.stream_videos[0]!.url, [])).toBeNull();
    expect(playableVideoUrl(artifact, artifact.stream_videos[1]!.url, ["vz-ok.b-cdn.net"])).toBeNull();
    expect(streamVideoHosts(artifact, ["vz-ok.b-cdn.net"])).toEqual(["vz-ok.b-cdn.net"]);
    expect(streamVideoHosts(artifact, [])).toEqual([]);
  });

  it("media-src is the site's own origin, plus an allowed stream host only when one plays", () => {
    expect(buildCsp({ nonce: "n", pathname: "/" })).toContain("media-src 'self';");
    expect(buildCsp({ nonce: "n", pathname: "/", streamHosts: ["vz-ok.b-cdn.net"] })).toContain("media-src 'self' https://vz-ok.b-cdn.net;");
    expect(mediaSrcFor(["bad host", "x;script-src *"])).toBe("media-src 'self'");
  });

  it("keeps upgrade-insecure-requests in production; only local mode (plain http) drops it", () => {
    expect(buildCsp({ nonce: "n", pathname: "/" })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce: "n", pathname: "/", localMode: false })).toContain("upgrade-insecure-requests");
    const local = buildCsp({ nonce: "n", pathname: "/", localMode: true });
    expect(local).not.toContain("upgrade-insecure-requests");
    // Everything else is identical.
    expect(local).toBe(buildCsp({ nonce: "n", pathname: "/" }).replace("; upgrade-insecure-requests", ""));
  });
});
