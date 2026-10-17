const signature = (bytes: Uint8Array, values: number[], offset = 0): boolean =>
  values.every((value, index) => bytes[offset + index] === value);

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  new TextDecoder().decode(bytes.slice(offset, offset + length));

/**
 * Confirm that browser-controlled MIME metadata agrees with the bytes before
 * anything reaches Drive. Office files are ZIP containers; their more precise
 * declared type remains bounded by the staging bucket allowlist.
 */
export async function verifySafeFileMime(blob: Blob, declaredMime: string): Promise<string> {
  const declared = declaredMime.toLowerCase().split(";", 1)[0].trim();
  const bytes = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  const isZip = signature(bytes, [0x50, 0x4b, 0x03, 0x04]);
  const brand = ascii(bytes, 8, 8);
  const rules: Record<string, boolean> = {
    "image/jpeg": signature(bytes, [0xff, 0xd8, 0xff]),
    "image/png": signature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    "image/gif": ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a",
    "image/webp": ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP",
    "image/heic": ascii(bytes, 4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/u.test(brand.slice(0, 4)),
    "image/heif": ascii(bytes, 4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/u.test(brand.slice(0, 4)),
    "video/mp4": ascii(bytes, 4, 4) === "ftyp",
    "video/quicktime": ascii(bytes, 4, 4) === "ftyp",
    "video/webm": signature(bytes, [0x1a, 0x45, 0xdf, 0xa3]),
    "audio/mpeg": ascii(bytes, 0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0),
    "audio/mp4": ascii(bytes, 4, 4) === "ftyp",
    "audio/x-m4a": ascii(bytes, 4, 4) === "ftyp",
    "audio/wav": ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE",
    "application/pdf": ascii(bytes, 0, 5) === "%PDF-",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": isZip,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
  };
  if (Object.hasOwn(rules, declared)) {
    if (!rules[declared]) throw new Error("FILE_BYTES_UNSAFE");
    return declared;
  }
  if (["text/plain", "text/csv", "application/csv"].includes(declared)) {
    if (bytes.includes(0)) throw new Error("FILE_BYTES_UNSAFE");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("FILE_BYTES_UNSAFE");
    }
    return declared;
  }
  throw new Error("FILE_TYPE_UNSUPPORTED");
}
