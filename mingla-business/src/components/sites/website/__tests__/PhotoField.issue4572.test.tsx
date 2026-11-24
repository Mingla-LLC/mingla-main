/*
 * #4572 items 3 and 12 — "Choose a photo".
 *  - item 3: an empty library brings the brand's own pictures in ONCE by itself
 *    (per site); while it runs it says "Bringing in your brand photos…"; a
 *    failure says so with Try again; nothing found offers the button again;
 *  - item 12: Upload is its own block, apart from the thumbnails, under the
 *    divider "Your photos (n)"; an upload in progress is a tile at the start
 *    of the grid ("Uploading…"); this session's uploads come first.
 * FAILS-ON-REVERT: the old chooser had no import, no divider and no tile.
 */
import React from "react";

let mockLibrary: { data?: Array<{ id: string; filename: string; width: null; height: null; thumb_url: string | null }>; isLoading: boolean; isError: boolean; isSuccess: boolean };
const mockMutate = jest.fn();
const mockToast = jest.fn();
let mockUpload: () => Promise<{ assets: Array<{ uri: string; mimeType: string; fileSize: number }>; canceled: boolean }>;
let mockUploadSitePhoto: (input: { onStatus: (status: "uploading" | "checking") => void }) => Promise<{ mediaId: string; thumbUrl: string | null }>;

jest.mock("../WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../WebsiteContext", () => ({
  useWebsite: () => ({ controller: { siteId: "site-1" }, brandId: "brand-1", toast: mockToast }),
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: () => mockUpload() }));
jest.mock("../../../../sites/contentApi", () => ({
  useMediaLibrary: () => mockLibrary,
  uploadSitePhoto: (input: { onStatus: (status: "uploading" | "checking") => void }) => mockUploadSitePhoto(input),
}));
jest.mock("../../../../sites/brandLibraryApi", () => ({ useImportBrandSiteLibrary: () => ({ mutate: mockMutate, isPending: false }) }));

import { PhotoChooser, photosNewestFirst, resetBrandPhotoAutoImport } from "../PhotoField";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void | Promise<void>) => void | Promise<void>;
  create: (node: React.ReactElement) => { root: Root; unmount: () => void; update: (node: React.ReactElement) => void };
};
type Node = { props: Record<string, unknown>; children: (Node | string)[]; type: unknown };
type Root = { findAll: (predicate: (node: Node) => boolean) => Node[] };
const textOf = (root: Root): string =>
  root.findAll((node) => typeof node.type === "string" && node.children.some((child) => typeof child === "string"))
    .map((node) => node.children.filter((child) => typeof child === "string").join("")).join(" | ");
const has = (root: Root, id: string) => root.findAll((node) => node.props.testID === id).length > 0;
const press = (root: Root, id: string) => {
  const node = root.findAll((candidate) => candidate.props.testID === id && typeof candidate.props.onPress === "function")[0];
  if (!node) throw new Error(`no pressable ${id}`);
  return act(() => { (node.props.onPress as () => void)(); });
};
const photo = (id: string) => ({ id, filename: `${id}.jpg`, width: null, height: null, thumb_url: null });
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) act(() => mounted.pop()!.unmount()); });
beforeEach(() => {
  resetBrandPhotoAutoImport();
  mockMutate.mockReset();
  mockToast.mockReset();
  mockLibrary = { data: [], isLoading: false, isError: false, isSuccess: true };
});

function open(onPick = jest.fn()) {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<PhotoChooser visible onClose={jest.fn()} onPick={onPick} />); });
  mounted.push(tree);
  return tree;
}

describe("#4572 item 3 — the brand's own photos", () => {
  it("an empty library brings them in once by itself, and says so while it runs", () => {
    const tree = open();
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(textOf(tree.root)).toContain("Bringing in your brand photos…");
    expect(has(tree.root, "photo-importing")).toBe(true);
    // Opening again (same site) does not import again by itself.
    act(() => tree.unmount());
    mounted.pop();
    open();
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("a failed import says what happened and offers Try again, which runs it again", () => {
    mockMutate.mockImplementation((_input: unknown, options: { onError: () => void }) => options.onError());
    const tree = open();
    expect(textOf(tree.root)).toContain("We couldn’t bring in your brand photos. Try again, or upload one from this device.");
    expect(textOf(tree.root)).toContain("Try again");
    press(tree.root, "photo-bring-in");
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it("nothing found leaves the button, and a successful run says how many came in", () => {
    mockMutate.mockImplementationOnce((_input: unknown, options: { onSuccess: (result: { imported: number; offered: number }) => void }) => options.onSuccess({ imported: 0, offered: 0 }));
    const tree = open();
    expect(textOf(tree.root)).toContain("We didn’t find any brand photos to bring in.");
    mockMutate.mockImplementationOnce((_input: unknown, options: { onSuccess: (result: { imported: number; offered: number }) => void }) => options.onSuccess({ imported: 8, offered: 8 }));
    press(tree.root, "photo-bring-in");
    expect(mockToast).toHaveBeenCalledWith("8 brand photos added", "success");
  });
});

describe("#4572 item 12 — the chooser's layout", () => {
  it("Upload is its own block; the thumbnails sit under the divider with the count", () => {
    mockLibrary = { data: [photo("a"), photo("b"), photo("c")], isLoading: false, isError: false, isSuccess: true };
    const tree = open();
    expect(mockMutate).not.toHaveBeenCalled();
    expect(has(tree.root, "photo-upload")).toBe(true);
    expect(textOf(tree.root)).toContain("Upload from this device");
    expect(textOf(tree.root)).toContain("Pick a photo from your computer");
    expect(textOf(tree.root)).toContain("Your photos (3)");
    expect(has(tree.root, "photo-library-a")).toBe(true);
  });

  it("an upload shows its tile first while it runs, then is picked", async () => {
    mockLibrary = { data: [photo("a")], isLoading: false, isError: false, isSuccess: true };
    let finish!: () => void;
    mockUpload = async () => ({ canceled: false, assets: [{ uri: "file:///x.jpg", mimeType: "image/jpeg", fileSize: 10 }] });
    mockUploadSitePhoto = (input) => new Promise((resolve) => {
      input.onStatus("uploading");
      finish = () => resolve({ mediaId: "new", thumbUrl: null });
    });
    const onPick = jest.fn();
    const tree = open(onPick);
    await act(async () => {
      (tree.root.findAll((node) => node.props.testID === "photo-upload" && typeof node.props.onPress === "function")[0]!.props.onPress as () => void)();
    });
    expect(has(tree.root, "photo-uploading-tile")).toBe(true);
    expect(textOf(tree.root)).toContain("Uploading…");
    await act(async () => { finish(); });
    expect(onPick).toHaveBeenCalledWith({ id: "new", thumb_url: null });
    expect(has(tree.root, "photo-uploading-tile")).toBe(false);
  });

  it("this session's uploads come first", () => {
    expect(photosNewestFirst([photo("a"), photo("b"), photo("new")], ["new"]).map((item) => item.id)).toEqual(["new", "a", "b"]);
    expect(photosNewestFirst([photo("a"), photo("b")], []).map((item) => item.id)).toEqual(["a", "b"]);
  });
});
