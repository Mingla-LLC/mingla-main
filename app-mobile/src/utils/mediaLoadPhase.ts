// Issue #4114 (simulator QA run 2, evidence 02j): the view-once photo spinner
// never cleared. The modal's onShow set loading=true AFTER the image's
// onLoadEnd had already fired (a cached or fast image loads before the fade-in
// finishes), so nothing ever set it false again.
//
// The phase is derived from WHICH url has settled, never from a flag that an
// open/show event resets: a new url is loading until its own load end or
// error, and a url that settled before the modal finished showing stays
// settled.

export type MediaLoadPhase = "idle" | "loading" | "loaded" | "failed";

export interface MediaLoadState {
  /** The url whose load ended successfully. */
  loadedUrl: string | null;
  /** The url whose load failed. */
  failedUrl: string | null;
}

export const EMPTY_MEDIA_LOAD_STATE: MediaLoadState = { loadedUrl: null, failedUrl: null };

export function mediaLoadPhase(url: string | null, state: MediaLoadState): MediaLoadPhase {
  if (!url) return "idle";
  if (state.failedUrl === url) return "failed";
  if (state.loadedUrl === url) return "loaded";
  return "loading";
}

/** A load end for `url`. An error that already landed for the same url wins. */
export function markMediaLoaded(state: MediaLoadState, url: string): MediaLoadState {
  if (state.failedUrl === url) return state;
  return { ...state, loadedUrl: url };
}

export function markMediaFailed(state: MediaLoadState, url: string): MediaLoadState {
  return { loadedUrl: state.loadedUrl === url ? null : state.loadedUrl, failedUrl: url };
}
