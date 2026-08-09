const {
  buildBrandOgCardProps,
  fetchPublicVenueBySlug,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");
const { businessRowSnapshot, renderCardIdentityPng, useDirectionC } = require("../server/cardIdentityRenderer");

module.exports = async function venueOgHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);
  const venueSlug = firstQueryValue(req.query.venueSlug);
  try {
    const input = typeof brandSlug === "string" && typeof venueSlug === "string"
      ? await fetchPublicVenueBySlug(brandSlug, venueSlug)
      : null;
    const props = buildBrandOgCardProps(input);
    if (!props.coverUrl) { res.statusCode = 404; return res.end(); }
    const buffer = useDirectionC(req)
      ? await renderCardIdentityPng(businessRowSnapshot(props), "s5Og")
      : await renderOgPng(props);
    sendPng(res, buffer);
  } catch { res.statusCode = 500; res.end(); }
};
