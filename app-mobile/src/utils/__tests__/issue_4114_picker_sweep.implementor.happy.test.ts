// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator run 4, item 3c: on iPhone, expo-image-picker 17.0.11
// copies the original .mov into Caches/ImagePicker before transcoding and
// never deletes it; only the .mp4 comes back. After each picker step the
// folder is swept: every file goes unless a still-pending tray item or an
// in-flight or failed upload holds it. Nothing outside the folder is touched.
//
// FAILS-ON-REVERT: remove selectPickerSweepTargets, stop it skipping held
// uris, or let it return a path outside the folder, and a case fails.

import { selectPickerSweepTargets } from "../chatMedia.ts";

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}: expected ${e}, got ${a}`);
}

const FOLDER = "file:///var/mobile/Containers/Data/Application/X/Library/Caches/ImagePicker/";
const MOV = "4720F21D-29D1-41B2-BECC-BE89287E1B60.mov"; // the leaked original (run 4, 03f)
const MP4 = "D3EF6CC9-0491-4BA6-A67F-283A51714B90.mp4"; // the export the picker returned

Deno.test("sim run 4: after a confirmed send, the leaked .mov and the sent .mp4 both go", () => {
  assertEquals(selectPickerSweepTargets(FOLDER, [MOV, MP4], []), [FOLDER + MOV, FOLDER + MP4], "nothing held");
});

Deno.test("sim run 4: a pending tray item or an in-flight / failed upload keeps its file; the .mov still goes", () => {
  assertEquals(selectPickerSweepTargets(FOLDER, [MOV, MP4], [FOLDER + MP4]), [FOLDER + MOV], "held export is kept");
  assertEquals(
    selectPickerSweepTargets(FOLDER, [MOV, MP4, "B.jpg"], [FOLDER + MP4, FOLDER + "B.jpg", null, undefined]),
    [FOLDER + MOV],
    "two holders, nulls ignored",
  );
});

Deno.test("sim run 4: a 208 MB refused pick leaves nothing behind", () => {
  const big = "D9BF79EB-1085-4650-B687-94BD5C818485.mov";
  assertEquals(selectPickerSweepTargets(FOLDER, [MOV, big], []), [FOLDER + MOV, FOLDER + big], "refusal");
});

Deno.test("sim run 4: never deletes outside Caches/ImagePicker", () => {
  assertEquals(selectPickerSweepTargets("file:///x/Library/Caches/", [MOV], []), [], "the Caches root is not the folder");
  assertEquals(selectPickerSweepTargets("file:///x/Library/Caches/DocumentPicker/", ["a.pdf"], []), [], "another folder");
  assertEquals(selectPickerSweepTargets("file:///x/Documents/ImagePicker/", [MOV], []), [], "not under Caches");
  assertEquals(
    selectPickerSweepTargets(FOLDER, ["..", ".", "", "sub/E.mp4", "..\\x", "%2e%2e"], []),
    [],
    "no escape, no sub-folder path",
  );
});

Deno.test("sim run 4: a held uri from somewhere else never protects or targets a folder file by accident", () => {
  // Held uris that are not picker temp files are ignored (a Photos asset, a document copy).
  assertEquals(
    selectPickerSweepTargets(FOLDER, [MOV], ["ph://ABC", "file:///x/Library/Caches/DocumentPicker/" + MOV]),
    [FOLDER + MOV],
    "only picker copies hold",
  );
});
