import {
  LaneVideoTypeError,
  resolveLaneVideoType,
  type LaneVideoExtension,
} from "./eventCoverVideoSourceType";

export type PreparedEventCoverVideoSource = {
  uri: string; bytes: number; durationMs: number; fileName: string; mimeType: string;
  extension: LaneVideoExtension; sha256: string; fingerprint: string;
};

/**
 * #3040 B-C7 [A-7] — SHA-256 compression over every whole 64-byte block in
 * `b[offset, end)`, fully unrolled with the round constants inlined.
 *
 * Hermes has no JIT, so this runs in the bytecode interpreter, where every
 * array index and loop step costs real time. The previous implementation
 * pushed EVERY byte onto a JS array and `splice`d 64 at a time: 9.2 s for a
 * 16.8 MB clip under `node --jitless`, all of it on the JS thread, so the sheet
 * froze on "Optimizing video 100%". Locals instead of a schedule array and
 * literal constants instead of a table bring that under 3 s (perf bar T-A7),
 * and the caller yields to the UI thread after every MiB. Pure JS: no native
 * module, so it ships over the air. The body below is mechanically generated
 * from FIPS 180-4 §6.2.2 (one line per schedule word, one line per round);
 * `Ch` and `Maj` use their 3- and 4-operation forms.
 */
const compress = (H: Int32Array, b: Uint8Array, offset: number, end: number): void => {
  let h0 = H[0], h1 = H[1], h2 = H[2], h3 = H[3], h4 = H[4], h5 = H[5], h6 = H[6], h7 = H[7];
    let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0, w6 = 0, w7 = 0, w8 = 0, w9 = 0, w10 = 0, w11 = 0, w12 = 0, w13 = 0, w14 = 0, w15 = 0;
    let w16 = 0, w17 = 0, w18 = 0, w19 = 0, w20 = 0, w21 = 0, w22 = 0, w23 = 0, w24 = 0, w25 = 0, w26 = 0, w27 = 0, w28 = 0, w29 = 0, w30 = 0, w31 = 0, w32 = 0, w33 = 0, w34 = 0, w35 = 0, w36 = 0, w37 = 0, w38 = 0, w39 = 0, w40 = 0, w41 = 0, w42 = 0, w43 = 0, w44 = 0, w45 = 0, w46 = 0, w47 = 0, w48 = 0, w49 = 0, w50 = 0, w51 = 0, w52 = 0, w53 = 0, w54 = 0, w55 = 0, w56 = 0, w57 = 0, w58 = 0, w59 = 0, w60 = 0, w61 = 0, w62 = 0, w63 = 0;
    let x = 0, y = 0, t1 = 0;
    for (let o = offset; o < end; o += 64) {
      w0 = (b[o + 0] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
      w1 = (b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7];
      w2 = (b[o + 8] << 24) | (b[o + 9] << 16) | (b[o + 10] << 8) | b[o + 11];
      w3 = (b[o + 12] << 24) | (b[o + 13] << 16) | (b[o + 14] << 8) | b[o + 15];
      w4 = (b[o + 16] << 24) | (b[o + 17] << 16) | (b[o + 18] << 8) | b[o + 19];
      w5 = (b[o + 20] << 24) | (b[o + 21] << 16) | (b[o + 22] << 8) | b[o + 23];
      w6 = (b[o + 24] << 24) | (b[o + 25] << 16) | (b[o + 26] << 8) | b[o + 27];
      w7 = (b[o + 28] << 24) | (b[o + 29] << 16) | (b[o + 30] << 8) | b[o + 31];
      w8 = (b[o + 32] << 24) | (b[o + 33] << 16) | (b[o + 34] << 8) | b[o + 35];
      w9 = (b[o + 36] << 24) | (b[o + 37] << 16) | (b[o + 38] << 8) | b[o + 39];
      w10 = (b[o + 40] << 24) | (b[o + 41] << 16) | (b[o + 42] << 8) | b[o + 43];
      w11 = (b[o + 44] << 24) | (b[o + 45] << 16) | (b[o + 46] << 8) | b[o + 47];
      w12 = (b[o + 48] << 24) | (b[o + 49] << 16) | (b[o + 50] << 8) | b[o + 51];
      w13 = (b[o + 52] << 24) | (b[o + 53] << 16) | (b[o + 54] << 8) | b[o + 55];
      w14 = (b[o + 56] << 24) | (b[o + 57] << 16) | (b[o + 58] << 8) | b[o + 59];
      w15 = (b[o + 60] << 24) | (b[o + 61] << 16) | (b[o + 62] << 8) | b[o + 63];
      x = w1; y = w14; w16 = (w0 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w9 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w2; y = w15; w17 = (w1 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w10 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w3; y = w16; w18 = (w2 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w11 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w4; y = w17; w19 = (w3 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w12 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w5; y = w18; w20 = (w4 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w13 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w6; y = w19; w21 = (w5 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w14 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w7; y = w20; w22 = (w6 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w15 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w8; y = w21; w23 = (w7 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w16 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w9; y = w22; w24 = (w8 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w17 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w10; y = w23; w25 = (w9 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w18 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w11; y = w24; w26 = (w10 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w19 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w12; y = w25; w27 = (w11 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w20 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w13; y = w26; w28 = (w12 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w21 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w14; y = w27; w29 = (w13 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w22 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w15; y = w28; w30 = (w14 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w23 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w16; y = w29; w31 = (w15 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w24 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w17; y = w30; w32 = (w16 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w25 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w18; y = w31; w33 = (w17 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w26 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w19; y = w32; w34 = (w18 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w27 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w20; y = w33; w35 = (w19 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w28 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w21; y = w34; w36 = (w20 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w29 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w22; y = w35; w37 = (w21 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w30 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w23; y = w36; w38 = (w22 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w31 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w24; y = w37; w39 = (w23 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w32 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w25; y = w38; w40 = (w24 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w33 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w26; y = w39; w41 = (w25 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w34 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w27; y = w40; w42 = (w26 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w35 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w28; y = w41; w43 = (w27 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w36 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w29; y = w42; w44 = (w28 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w37 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w30; y = w43; w45 = (w29 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w38 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w31; y = w44; w46 = (w30 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w39 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w32; y = w45; w47 = (w31 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w40 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w33; y = w46; w48 = (w32 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w41 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w34; y = w47; w49 = (w33 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w42 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w35; y = w48; w50 = (w34 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w43 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w36; y = w49; w51 = (w35 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w44 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w37; y = w50; w52 = (w36 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w45 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w38; y = w51; w53 = (w37 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w46 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w39; y = w52; w54 = (w38 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w47 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w40; y = w53; w55 = (w39 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w48 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w41; y = w54; w56 = (w40 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w49 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w42; y = w55; w57 = (w41 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w50 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w43; y = w56; w58 = (w42 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w51 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w44; y = w57; w59 = (w43 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w52 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w45; y = w58; w60 = (w44 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w53 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w46; y = w59; w61 = (w45 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w54 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w47; y = w60; w62 = (w46 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w55 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      x = w48; y = w61; w63 = (w47 + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + w56 + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10))) | 0;
      let a = h0, b1 = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0x428a2f98 + w0) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0x71374491 + w1) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0xb5c0fbcf + w2) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0xe9b5dba5 + w3) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0x3956c25b + w4) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0x59f111f1 + w5) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0x923f82a4 + w6) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0xab1c5ed5 + w7) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0xd807aa98 + w8) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0x12835b01 + w9) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0x243185be + w10) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0x550c7dc3 + w11) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0x72be5d74 + w12) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0x80deb1fe + w13) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0x9bdc06a7 + w14) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0xc19bf174 + w15) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0xe49b69c1 + w16) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0xefbe4786 + w17) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0x0fc19dc6 + w18) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0x240ca1cc + w19) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0x2de92c6f + w20) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0x4a7484aa + w21) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0x5cb0a9dc + w22) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0x76f988da + w23) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0x983e5152 + w24) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0xa831c66d + w25) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0xb00327c8 + w26) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0xbf597fc7 + w27) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0xc6e00bf3 + w28) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0xd5a79147 + w29) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0x06ca6351 + w30) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0x14292967 + w31) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0x27b70a85 + w32) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0x2e1b2138 + w33) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0x4d2c6dfc + w34) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0x53380d13 + w35) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0x650a7354 + w36) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0x766a0abb + w37) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0x81c2c92e + w38) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0x92722c85 + w39) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0xa2bfe8a1 + w40) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0xa81a664b + w41) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0xc24b8b70 + w42) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0xc76c51a3 + w43) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0xd192e819 + w44) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0xd6990624 + w45) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0xf40e3585 + w46) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0x106aa070 + w47) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0x19a4c116 + w48) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0x1e376c08 + w49) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0x2748774c + w50) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0x34b0bcb5 + w51) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0x391c0cb3 + w52) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0x4ed8aa4a + w53) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0x5b9cca4f + w54) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0x682e6ff3 + w55) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + (g ^ (e & (f ^ g))) + 0x748f82ee + w56) | 0; d = (d + t1) | 0; h = (t1 + ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b1) | (c & (a | b1))))) | 0;
      t1 = (g + (((d >>> 6) | (d << 26)) ^ ((d >>> 11) | (d << 21)) ^ ((d >>> 25) | (d << 7))) + (f ^ (d & (e ^ f))) + 0x78a5636f + w57) | 0; c = (c + t1) | 0; g = (t1 + ((((h >>> 2) | (h << 30)) ^ ((h >>> 13) | (h << 19)) ^ ((h >>> 22) | (h << 10))) + ((h & a) | (b1 & (h | a))))) | 0;
      t1 = (f + (((c >>> 6) | (c << 26)) ^ ((c >>> 11) | (c << 21)) ^ ((c >>> 25) | (c << 7))) + (e ^ (c & (d ^ e))) + 0x84c87814 + w58) | 0; b1 = (b1 + t1) | 0; f = (t1 + ((((g >>> 2) | (g << 30)) ^ ((g >>> 13) | (g << 19)) ^ ((g >>> 22) | (g << 10))) + ((g & h) | (a & (g | h))))) | 0;
      t1 = (e + (((b1 >>> 6) | (b1 << 26)) ^ ((b1 >>> 11) | (b1 << 21)) ^ ((b1 >>> 25) | (b1 << 7))) + (d ^ (b1 & (c ^ d))) + 0x8cc70208 + w59) | 0; a = (a + t1) | 0; e = (t1 + ((((f >>> 2) | (f << 30)) ^ ((f >>> 13) | (f << 19)) ^ ((f >>> 22) | (f << 10))) + ((f & g) | (h & (f | g))))) | 0;
      t1 = (d + (((a >>> 6) | (a << 26)) ^ ((a >>> 11) | (a << 21)) ^ ((a >>> 25) | (a << 7))) + (c ^ (a & (b1 ^ c))) + 0x90befffa + w60) | 0; h = (h + t1) | 0; d = (t1 + ((((e >>> 2) | (e << 30)) ^ ((e >>> 13) | (e << 19)) ^ ((e >>> 22) | (e << 10))) + ((e & f) | (g & (e | f))))) | 0;
      t1 = (c + (((h >>> 6) | (h << 26)) ^ ((h >>> 11) | (h << 21)) ^ ((h >>> 25) | (h << 7))) + (b1 ^ (h & (a ^ b1))) + 0xa4506ceb + w61) | 0; g = (g + t1) | 0; c = (t1 + ((((d >>> 2) | (d << 30)) ^ ((d >>> 13) | (d << 19)) ^ ((d >>> 22) | (d << 10))) + ((d & e) | (f & (d | e))))) | 0;
      t1 = (b1 + (((g >>> 6) | (g << 26)) ^ ((g >>> 11) | (g << 21)) ^ ((g >>> 25) | (g << 7))) + (a ^ (g & (h ^ a))) + 0xbef9a3f7 + w62) | 0; f = (f + t1) | 0; b1 = (t1 + ((((c >>> 2) | (c << 30)) ^ ((c >>> 13) | (c << 19)) ^ ((c >>> 22) | (c << 10))) + ((c & d) | (e & (c | d))))) | 0;
      t1 = (a + (((f >>> 6) | (f << 26)) ^ ((f >>> 11) | (f << 21)) ^ ((f >>> 25) | (f << 7))) + (h ^ (f & (g ^ h))) + 0xc67178f2 + w63) | 0; e = (e + t1) | 0; a = (t1 + ((((b1 >>> 2) | (b1 << 30)) ^ ((b1 >>> 13) | (b1 << 19)) ^ ((b1 >>> 22) | (b1 << 10))) + ((b1 & c) | (d & (b1 | c))))) | 0;
      h0 = (h0 + a) | 0; h1 = (h1 + b1) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
  H[0] = h0; H[1] = h1; H[2] = h2; H[3] = h3; H[4] = h4; H[5] = h5; H[6] = h6; H[7] = h7;
};

/** #3040 B-C7 — streaming SHA-256 (hex digest), at most 63 bytes of carry. */
export class Sha256 {
  private readonly h = new Int32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly carry = new Uint8Array(64);
  private carryLength = 0;
  private total = 0;

  update(bytes: Uint8Array): void {
    const length = bytes.length;
    this.total += length;
    let index = 0;
    if (this.carryLength > 0) {
      const take = Math.min(64 - this.carryLength, length);
      this.carry.set(bytes.subarray(0, take), this.carryLength);
      this.carryLength += take;
      index = take;
      if (this.carryLength < 64) return;
      compress(this.h, this.carry, 0, 64);
      this.carryLength = 0;
    }
    const whole = index + Math.floor((length - index) / 64) * 64;
    if (whole > index) compress(this.h, bytes, index, whole);
    if (whole < length) {
      this.carry.set(bytes.subarray(whole), 0);
      this.carryLength = length - whole;
    }
  }

  digest(): string {
    const bits = this.total * 8;
    const tailLength = this.carryLength < 56 ? 64 : 128;
    const tail = new Uint8Array(tailLength);
    tail.set(this.carry.subarray(0, this.carryLength), 0);
    tail[this.carryLength] = 0x80;
    for (let i = 0; i < 8; i++) tail[tailLength - 1 - i] = Math.floor(bits / 2 ** (i * 8)) & 255;
    compress(this.h, tail, 0, tailLength);
    let out = "";
    for (let i = 0; i < 8; i++) out += (this.h[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }
}

/** #3040 B-C7 — one JS-thread yield; the UI (spinner, taps) runs in between. */
export const yieldToUiThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export const PREPARE_READ_CHUNK_BYTES = 1024 * 1024;

// Issue #3073 — a "cover video" with no picture must never reach the provider.
//
// The trim editor can hand back an MP4 that carries ONLY an audio track. It is
// a well-formed file — `moov` at the front, correct duration, correct byte
// count — so every size and hash check upstream passes, and the first thing
// that notices is Bunny, which cannot probe it (`length: 0`, `storageSize: 0`,
// no resolution ladder) and answers with an `originalHash` over something other
// than what we sent. The webhook then fails the job `source_identity_mismatch`,
// which is a true statement about the hashes and a useless one about the cause.
// Observed on the iOS Simulator 2026-09-03: three consecutive trims produced
// 15s/161KB files whose ffprobe stream list was one AAC track and nothing else.
//
// CORRECTION (2026-09-17): the trim editor was not the source. Those 161 KB
// files were `react-native-compressor` output (their job rows carry the
// `<operationId>.mp4` name only a compressed file gets): on the Simulator its
// H.264 writer input is refused, it drops the video track and still resolves.
// The hook now falls back to the original when that happens; this guard stays
// as the last line of defence for any other picture-less file.
//
// This scans the ISO-BMFF handler boxes while the file is already being read
// for its hash, so it costs no extra I/O.
//
// `hdlr` layout (ISO/IEC 14496-12 §8.4.3), offsets from the start of the type
// field: [type 'hdlr' :4][version+flags :4][pre_defined :4][handler_type :4].
// So the handler type sits 12 bytes past the tag — 'vide' for a video track,
// 'soun' for audio.
//
// DELIBERATELY BIASED TOWARDS LETTING THE UPLOAD THROUGH: a false negative
// blocks a host's perfectly good video, which is worse than the status quo. We
// only report "no video" when we positively parsed at least one handler and
// none of them was a video handler. An unparseable container reports `null` and
// the upload proceeds exactly as it does today.
const HDLR_TAG = [0x68, 0x64, 0x6c, 0x72]; // 'hdlr'
const VIDEO_HANDLER = [0x76, 0x69, 0x64, 0x65]; // 'vide'
// A handler_type ends 16 bytes past the tag start, so a 15-byte tail is the
// most that can be needed to finish a match that straddles two chunks.
const HDLR_CARRY_BYTES = 15;

const matchesAt = (bytes: Uint8Array, index: number, pattern: number[]): boolean => {
  if (index < 0 || index + pattern.length > bytes.length) return false;
  for (let offset = 0; offset < pattern.length; offset += 1) {
    if (bytes[index + offset] !== pattern[offset]) return false;
  }
  return true;
};

export class VideoTrackScan {
  private carry: Uint8Array = new Uint8Array(0);
  private handlersSeen = 0;
  private videoHandlersSeen = 0;

  update(chunk: Uint8Array): void {
    const window = new Uint8Array(this.carry.length + chunk.length);
    window.set(this.carry, 0);
    window.set(chunk, this.carry.length);
    for (let index = 0; index + 16 <= window.length; index += 1) {
      if (!matchesAt(window, index, HDLR_TAG)) continue;
      this.handlersSeen += 1;
      if (matchesAt(window, index + 12, VIDEO_HANDLER)) this.videoHandlersSeen += 1;
    }
    this.carry = window.length <= HDLR_CARRY_BYTES
      ? window
      : window.slice(window.length - HDLR_CARRY_BYTES);
  }

  // null = could not tell (no handler box parsed); true/false = confident.
  hasVideoTrack(): boolean | null {
    if (this.handlersSeen === 0) return null;
    return this.videoHandlersSeen > 0;
  }
}

export class EventCoverVideoSourceHasNoVideoTrackError extends Error {
  constructor() {
    super("The trimmed clip has no video track.");
    this.name = "EventCoverVideoSourceHasNoVideoTrackError";
  }
}

// A NAME check, not `instanceof`. Several suites mock this module partially, so
// the class can be `undefined` at runtime in a test — and `x instanceof
// undefined` THROWS, taking down the whole suite rather than failing one
// assertion. Same shape the repo already uses for PostgREST errors, which
// arrive as plain objects.
export const isEventCoverVideoSourceHasNoVideoTrackError = (
  error: unknown,
): boolean =>
  error !== null && typeof error === "object" &&
  (error as { name?: unknown }).name === "EventCoverVideoSourceHasNoVideoTrackError";

export type PrepareProgress = { phase: "preparing"; percent: number };

export const prepareEventCoverVideoSource = async (input: {
  uri:string; bytes:number; durationMs:number; fileName?:string|null; mimeType?:string|null; operationId:string;
  /**
   * #3040 B-C7 — the source is a cache file this flow already owns (the
   * compressor's output). It is RENAMED into place, never copied; only a raw
   * pick (the user's own library file) is copied.
   */
  ownedTemporary?: boolean;
  onProgress?: (progress: PrepareProgress) => void;
}):Promise<PreparedEventCoverVideoSource> => {
  const FileSystem=await import("expo-file-system/legacy"); const base=FileSystem.cacheDirectory;
  if(typeof base!=="string")throw new Error("video_storage_unavailable");
  const {File}=await import("expo-file-system");
  // #3040 B-C19 — MIME, then extension, then the first 12 bytes.
  let head: Uint8Array | null = null;
  const knownByMetadata = (() => {
    try { resolveLaneVideoType({ mimeType: input.mimeType, fileName: input.fileName }); return true; } catch { return false; }
  })();
  if (!knownByMetadata) {
    const sniff = new File(input.uri).open();
    try { head = sniff.readBytes(12); } finally { sniff.close(); }
  }
  let resolved: ReturnType<typeof resolveLaneVideoType>;
  try {
    resolved = resolveLaneVideoType({ mimeType: input.mimeType, fileName: input.fileName, head });
  } catch (error) {
    throw new Error(error instanceof LaneVideoTypeError ? error.code : "video_source_type_unknown");
  }
  const { extension, mimeType } = resolved;
  const destination=`${base}event-cover-${input.operationId}.${extension}`;
  if(input.uri!==destination){
    try{await FileSystem.deleteAsync(destination,{idempotent:true});}catch{/* nothing to replace */}
    if (input.ownedTemporary === true) await FileSystem.moveAsync({from:input.uri,to:destination});
    else await FileSystem.copyAsync({from:input.uri,to:destination});
  }
  const file=new File(destination); const handle=file.open(); const sha=new Sha256(); const trackScan=new VideoTrackScan(); let size=0;
  try {
    while(true){
      const chunk=handle.readBytes(PREPARE_READ_CHUNK_BYTES);
      if(chunk.length===0)break;
      sha.update(chunk);trackScan.update(chunk);size+=chunk.length;
      input.onProgress?.({ phase: "preparing", percent: input.bytes > 0 ? Math.min(99, Math.floor((size / input.bytes) * 100)) : 0 });
      // #3040 B-C7 — let the UI breathe after every MiB.
      await yieldToUiThread();
    }
  } finally { handle.close(); }
  if(size<=0||size!==input.bytes)throw new Error("video_source_size_changed");
  // issue #3073 — refuse a picture-less "video" here rather than discovering it
  // three round trips later as an identity mismatch.
  if(trackScan.hasVideoTrack()===false)throw new EventCoverVideoSourceHasNoVideoTrackError();
  const sha256=sha.digest();
  return {uri:destination,bytes:size,durationMs:input.durationMs,fileName:resolved.fileName,mimeType,extension,sha256,fingerprint:`${sha256}:${size}`};
};

export const deletePreparedEventCoverVideoSource = async (uri:string):Promise<void> => {
  const FileSystem=await import("expo-file-system/legacy");
  const base=FileSystem.cacheDirectory;
  if(typeof base!=="string"||!uri.startsWith(`${base}event-cover-`))return;
  await FileSystem.deleteAsync(uri,{idempotent:true});
};
