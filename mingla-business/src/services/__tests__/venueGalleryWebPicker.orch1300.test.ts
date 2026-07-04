/**
 * ORCH-1300 [web-gallery-picker] — happy-path regression test.
 *
 * Proves the venue gallery "Add photos" picker WORKS on business WEB: it opens a
 * real `<input type=file multiple accept="image/*">` (via the CI-guarded
 * `pickBrowserFiles`), returns the selected files as real assets, hard-caps the
 * selection at the remaining gallery slots, and feeds the handler's add path so
 * photos are actually added — replacing the pre-ORCH-1300 permanent-cancel STUB
 * that made the button a silent dead tap.
 *
 * It also proves the failure contract (Constitution #3): a genuine empty
 * selection is a SILENT cancel (`[]`), while an unavailable picker THROWS a
 * VenueGalleryError the handler surfaces on screen — never silent.
 *
 * Under jest's node env, `../venueGalleryDeviceMedia` resolves to the WEB `.ts`
 * variant (native uses the `.native.ts` split, which is untouched by ORCH-1300).
 *
 * Fails-on-revert: reverting the web split to the stub (`{ canceled: true }`) or
 * routing venueGalleryService back through the platformImagePicker stub makes
 * `pickGalleryPhotos` return `[]`, and every "real assets" / "adds them"
 * assertion below fails.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

import * as gallery from "../venueGalleryService";
import { launchGalleryImagePicker } from "../venueGalleryDeviceMedia";

type TestFile = File & { size: number; type: string; name: string };

const makeFile = (name: string, type: string, size: number): TestFile =>
  ({ name, size, type } as TestFile);

// The venue gallery hard cap (VenueDeckReadinessSetup GALLERY_MAX /
// ClaimStepPhotos CLAIM_GALLERY_MAX are both 20).
const GALLERY_MAX = 20;

type FakeInput = {
  accept: string;
  multiple: boolean;
  type: string;
  files: TestFile[];
  attributes: Record<string, string>;
  onchange: null | (() => void);
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
  style: Record<string, string>;
  click: () => void;
};

/** Install a fake browser `<input type=file>` so pickBrowserFiles can run. */
const withFakeFileInput = (
  files: TestFile[],
  options: { triggerChange?: boolean } = {},
): FakeInput => {
  const input: FakeInput = {
    accept: "",
    attributes: {},
    files,
    multiple: false,
    onchange: null,
    remove: jest.fn(),
    setAttribute: jest.fn((name: string, value: string) => {
      input.attributes[name] = value;
    }),
    style: {},
    type: "",
    click: jest.fn(() => {
      if (options.triggerChange !== false) input.onchange?.();
    }),
  };
  (global as { document?: unknown }).document = {
    body: { appendChild: jest.fn() },
    createElement: jest.fn(() => input),
  };
  return input;
};

beforeEach(() => {
  // pickBrowserFiles mints an object URL per picked file for the returned `uri`.
  (URL as unknown as { createObjectURL: (f: TestFile) => string }).createObjectURL =
    jest.fn((f: TestFile) => `blob:${f.name}`);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (global as { document?: unknown }).document;
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
});

describe("ORCH-1300 venue gallery web picker", () => {
  test("opens a real <input type=file multiple accept=image/*> via pickBrowserFiles", async () => {
    const input = withFakeFileInput([makeFile("x.jpg", "image/jpeg", 50)]);
    const result = await launchGalleryImagePicker(4);
    expect(input.type).toBe("file");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/*");
    expect(result.canceled).toBe(false);
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].uri).toBe("blob:x.jpg");
  });

  test("pickGalleryPhotos returns real assets from the web file input", async () => {
    withFakeFileInput([
      makeFile("a.jpg", "image/jpeg", 100),
      makeFile("b.png", "image/png", 200),
    ]);
    const picked = await gallery.pickGalleryPhotos(5);
    expect(picked).toHaveLength(2);
    expect(picked.map((p) => p.fileName)).toEqual(["a.jpg", "b.png"]);
    expect(picked.map((p) => p.uri)).toEqual(["blob:a.jpg", "blob:b.png"]);
    expect(picked[0].mimeType).toBe("image/jpeg");
  });

  test("hard-caps the multi-selection at the remaining slots", async () => {
    withFakeFileInput([
      makeFile("a.jpg", "image/jpeg", 100),
      makeFile("b.png", "image/png", 200),
      makeFile("c.webp", "image/webp", 300),
    ]);
    // Only 2 slots left → never accept more than 2, even if 3 are chosen.
    const picked = await gallery.pickGalleryPhotos(2);
    expect(picked).toHaveLength(2);
    expect(picked.map((p) => p.fileName)).toEqual(["a.jpg", "b.png"]);
  });

  test("a genuine empty selection is a SILENT cancel (returns [])", async () => {
    withFakeFileInput([]); // onchange fires with no files chosen
    const picked = await gallery.pickGalleryPhotos(3);
    expect(picked).toEqual([]);
  });

  test("an unavailable picker THROWS a non-silent VenueGalleryError (not silent)", async () => {
    delete (global as { document?: unknown }).document; // no browser document
    await expect(gallery.pickGalleryPhotos(3)).rejects.toBeInstanceOf(
      gallery.VenueGalleryError,
    );
  });

  test("the handler add path adds the web-picked, uploaded photos to the gallery", async () => {
    withFakeFileInput([
      makeFile("a.jpg", "image/jpeg", 100),
      makeFile("b.png", "image/png", 200),
    ]);
    // Mirror VenueDeckReadinessSetup.handleAddPhotos / VenuePhotosStep.handleAdd:
    const existing: string[] = [];
    const remaining = GALLERY_MAX - existing.length;
    const picked = await gallery.pickGalleryPhotos(remaining);
    // The web pick is no longer a dead tap.
    expect(picked.length).toBeGreaterThan(0);
    // Upload each (stand-in for uploadGalleryPhoto, which hits Supabase storage),
    // then run the exact merge+cap the handlers use.
    const uploadStub = async (asset: { fileName?: string | null }): Promise<string> =>
      `https://cdn.test/${asset.fileName}`;
    const uploaded: string[] = [];
    for (const asset of picked) uploaded.push(await uploadStub(asset));
    const next = Array.from(new Set([...existing, ...uploaded])).slice(0, GALLERY_MAX);
    expect(next).toEqual([
      "https://cdn.test/a.jpg",
      "https://cdn.test/b.png",
    ]);
  });
});
