export function sitesJsonResponse(
  data: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store, private");

  return Response.json(data, {
    status,
    headers: responseHeaders,
  });
}
