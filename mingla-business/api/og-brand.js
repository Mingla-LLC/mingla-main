const {
  buildBrandOgCardProps,
  fetchPublicBrandBySlug,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");
const { businessRowSnapshot, renderCardIdentityPng, useDirectionC } = require("../server/cardIdentityRenderer");

module.exports = async function brandOgHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);

  try {
    const publicBrand =
      typeof brandSlug === "string" ? await fetchPublicBrandBySlug(brandSlug) : null;
    const props = buildBrandOgCardProps(publicBrand);
    if (!props.coverUrl) { res.statusCode = 404; return res.end(); }
    const buffer = useDirectionC(req) ? await renderCardIdentityPng(businessRowSnapshot(props), "s5Og") : await renderOgPng(props);
    sendPng(res, buffer);
  } catch { res.statusCode = 500; res.end(); }
};
