/**
 * #4607 — React Native's Blob omits arrayBuffer(), and global fetch can turn
 * local file URIs into empty bodies. Read and stream the picked file through
 * Expo's native APIs. Imports stay lazy so this Website chunk is OTA-safe.
 */
export async function readSiteMediaBytes(uri: string): Promise<Uint8Array> {
  const { File } = await import("expo-file-system");
  return new Uint8Array(await new File(uri).arrayBuffer());
}

export async function putSiteMediaFile(input: {
  uri: string;
  url: string;
  headers: Record<string, string>;
}): Promise<boolean> {
  const [{ File }, { fetch: expoFetch }] = await Promise.all([
    import("expo-file-system"),
    import("expo/fetch"),
  ]);
  const response = await expoFetch(input.url, {
    method: "PUT",
    headers: input.headers,
    body: new File(input.uri),
  });
  return response.ok;
}
