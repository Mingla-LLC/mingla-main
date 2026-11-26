export async function readSiteMediaBytes(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  return new Uint8Array(await response.arrayBuffer());
}

export async function putSiteMediaFile(input: {
  uri: string;
  url: string;
  headers: Record<string, string>;
}): Promise<boolean> {
  const body = await (await fetch(input.uri)).blob();
  const response = await fetch(input.url, {
    method: "PUT",
    headers: input.headers,
    body,
  });
  return response.ok;
}
