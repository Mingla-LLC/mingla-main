import React from "react";
import {
  checkServerCoverOnce,
  SERVER_COVER_READ_TIMEOUT_MS,
  SERVER_COVER_WATCH_LIMIT_MS,
  useServerCoverAdoption,
} from "../useServerCoverAdoption";
import { forgetServerCoverBase, recordServerCoverBase, type ServerDraftCover } from "../../utils/draftCoverBase";

jest.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) } }));
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
type Tree = { unmount: () => void };
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (action: () => void | Promise<void>) => Promise<void>;
};
const ID = "3439-reconciliation";
const video: ServerDraftCover = {
  coverMediaUrl: "https://example.invalid/applied.mp4", coverMediaType: "video",
  coverMediaPosterUrl: "https://example.invalid/poster.jpg", coverMediaProvider: null,
  coverMediaSourceUrl: null, coverMediaCredit: null, coverMediaCreditUrl: null, coverMediaAlt: null,
};
const empty = { ...video, coverMediaUrl: null, coverMediaType: null, coverMediaPosterUrl: null };
const roots: Tree[] = [];
beforeEach(() => { jest.useFakeTimers(); forgetServerCoverBase(); });
afterEach(async () => {
  await renderer.act(async () => { roots.splice(0).forEach(root => root.unmount()); });
  jest.useRealTimers();
});

test("an accepted equal-URL echo reconciles completion and metadata without creating a user edit", async () => {
  recordServerCoverBase(ID, video.coverMediaUrl);
  const onAdopt = jest.fn();
  const onReconciled = jest.fn();
  for (let repeat = 0; repeat < 2; repeat++) {
    expect(await checkServerCoverOnce({ draftId: ID, fetchServerCover: async () => video,
      getLocalCoverUrl: () => video.coverMediaUrl, onAdopt, onReconciled })).toBe(false);
  }
  expect(onReconciled).toHaveBeenCalledTimes(2);
  expect(onReconciled).toHaveBeenCalledWith(video);
  expect(onAdopt).not.toHaveBeenCalled();
});

test("a response invalidated by a newer host choice or upload cannot complete or adopt", async () => {
  const onAdopt = jest.fn();
  const onReconciled = jest.fn();
  await checkServerCoverOnce({ draftId: ID, fetchServerCover: async () => video,
    getLocalCoverUrl: () => null, isCurrent: () => false, onAdopt, onReconciled });
  expect(onAdopt).not.toHaveBeenCalled();
  expect(onReconciled).not.toHaveBeenCalled();
});

test("explicit removal survives reconciliation and resolves authority without adopting", async () => {
  recordServerCoverBase(ID, video.coverMediaUrl);
  const onAdopt = jest.fn();
  const onReconciled = jest.fn();
  await checkServerCoverOnce({ draftId: ID, fetchServerCover: async () => video,
    getLocalCoverUrl: () => null, onAdopt, onReconciled });
  expect(onAdopt).not.toHaveBeenCalled();
  expect(onReconciled).toHaveBeenCalledWith(null);
});

test("initial authority remains pending, then a genuine coverless read permits publishing", async () => {
  let resolve: (cover: ServerDraftCover) => void = () => { throw new Error("uninitialised read"); };
  const read = new Promise<ServerDraftCover>(done => { resolve = done; });
  const fetchServerCover = () => read;
  let ready = true;
  function Harness(): null {
    ready = useServerCoverAdoption({ draftId: ID, fetchServerCover, localCoverUrl: null,
      watching: false, pulse: 0, onAdopt: () => undefined }).isReady;
    return null;
  }
  await renderer.act(async () => { roots.push(renderer.create(<Harness />)); });
  expect(ready).toBe(false);
  await renderer.act(async () => { resolve(empty); await read; });
  expect(ready).toBe(true);
});

test("a failed initial read retries even when no processing callback occurred", async () => {
  const read = jest.fn<Promise<ServerDraftCover>, []>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(empty);
  const onReadError = jest.fn();
  let ready = true;
  function Harness(): null {
    ready = useServerCoverAdoption({ draftId: ID, fetchServerCover: read, localCoverUrl: null,
      watching: false, pulse: 0, onAdopt: () => undefined, onReadError }).isReady;
    return null;
  }
  await renderer.act(async () => { roots.push(renderer.create(<Harness />)); });
  expect(ready).toBe(false);
  expect(onReadError).toHaveBeenCalledTimes(1);
  await renderer.act(async () => { jest.advanceTimersByTime(5_000); });
  expect(ready).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
});

test("a hung read times out instead of owning the in-flight slot forever", async () => {
  const onReadError = jest.fn();
  const pending = checkServerCoverOnce({ draftId: ID,
    fetchServerCover: () => new Promise<ServerDraftCover>(() => undefined),
    getLocalCoverUrl: () => null, onAdopt: jest.fn(), onReadError });
  jest.advanceTimersByTime(SERVER_COVER_READ_TIMEOUT_MS);
  expect(await pending).toBe(false);
  expect(onReadError).toHaveBeenCalledTimes(1);
});

test("unresolved initial authority still retries after the processing watch deadline", async () => {
  const read = jest.fn<Promise<ServerDraftCover>, []>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(empty);
  let ready = true;
  function Harness(): null {
    ready = useServerCoverAdoption({ draftId: ID, fetchServerCover: read,
      localCoverUrl: null, watching: false, pulse: 0, onAdopt: () => undefined }).isReady;
    return null;
  }
  await renderer.act(async () => { roots.push(renderer.create(<Harness />)); });
  expect(ready).toBe(false);
  jest.setSystemTime(Date.now() + SERVER_COVER_WATCH_LIMIT_MS + 1);
  await renderer.act(async () => { jest.advanceTimersByTime(5_000); });
  expect(ready).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
});
