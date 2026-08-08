const { fetchContentShare, firstQueryValue, setSharedNoStore } = require("../server/socialPreview");
const { hasValidSharedCardProxySecret } = require("../server/sharedCardProxyAuth");
const send = (res, body, status) => { setSharedNoStore(res); res.statusCode = status; res.setHeader("content-type", "application/json; charset=utf-8"); return res.end(JSON.stringify(body)); };
const createContentShareDataHandler = (fetchShare = fetchContentShare) => async function handler(req, res) {
  if (!hasValidSharedCardProxySecret(req)) return send(res, { error: "not_found" }, 404);
  const code = firstQueryValue(req.query.code);
  if (typeof code !== "string" || !/^[0-9A-Za-z]{16}$/.test(code)) return send(res, { error: "not_found" }, 404);
  try {
    const result = await fetchShare(code);
    if (result.status === 410) return send(res, { error: "gone" }, 410);
    if (!result.contentShare) return send(res, { error: result.status === 404 ? "not_found" : "unavailable" }, [429,500,503].includes(result.status) ? result.status : 404);
    return send(res, { contentShare: result.contentShare }, 200);
  } catch { return send(res, { error: "not_found" }, 404); }
};
module.exports = createContentShareDataHandler();
module.exports.createContentShareDataHandler = createContentShareDataHandler;
