const { fetchContentShareVersion, firstQueryValue, setSharedNoStore, contentSharePosterUrl } = require("../server/socialPreview");
const { MAX_CONTENT_SHARE_JPEG_BYTES, renderContentSharePortraitJpeg } = require("../server/cardIdentityRenderer");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const setImmutableJpegHeaders = (res, etag) => {
  res.setHeader("content-type", "image/jpeg");
  res.setHeader("etag", etag);
  res.setHeader("cache-control", IMMUTABLE_CACHE);
  res.setHeader("cdn-cache-control", IMMUTABLE_CACHE);
  res.setHeader("vercel-cdn-cache-control", IMMUTABLE_CACHE);
};
const failClosed = (res, statusCode) => {
  setSharedNoStore(res);
  res.statusCode = statusCode;
  return res.end();
};
const isBoundedJpeg = (value) => Buffer.isBuffer(value) && value.length > 3
  && value.length <= MAX_CONTENT_SHARE_JPEG_BYTES
  && value[0] === 0xff && value[1] === 0xd8
  && value[value.length - 2] === 0xff && value[value.length - 1] === 0xd9;
const createContentShareImageHandler = (fetchShare = fetchContentShareVersion, renderJpeg = renderContentSharePortraitJpeg) => async function contentShareImage(req, res) {
  const code = firstQueryValue(req.query.code);
  const version = firstQueryValue(req.query.version);
  if (!hasValidSharedCardProxySecret(req) || typeof code !== "string" || !/^[0-9A-Za-z]{16}$/.test(code)
    || typeof version !== "string" || !/^[1-9][0-9]*$/.test(version)) return failClosed(res, 404);
  try {
    const result = await fetchShare(code, Number(version));
    if (result.status === 410) return failClosed(res, 410);
    const share = result.contentShare;
    if (!share || Number(share.version) !== Number(version) || !contentSharePosterUrl(share)) return failClosed(res, 404);
    const etag = `"content-share-${code}-v${version}-r2-jpeg"`;
    if (req.headers?.["if-none-match"] === etag) {
      res.statusCode = 304;
      setImmutableJpegHeaders(res, etag);
      return res.end();
    }
    const jpeg = await renderJpeg(share);
    if (!isBoundedJpeg(jpeg)) return failClosed(res, 502);
    res.statusCode = 200;
    setImmutableJpegHeaders(res, etag);
    return res.end(jpeg);
  } catch { return failClosed(res, 404); }
};
module.exports = createContentShareImageHandler();
module.exports.createContentShareImageHandler = createContentShareImageHandler;
