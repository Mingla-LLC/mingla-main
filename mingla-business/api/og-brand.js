const {
  fetchPublicBrandBySlug,
  firstQueryValue,
  renderOgPng,
  sendPng,
} = require("../server/socialPreview");

module.exports = async function brandOgHandler(req, res) {
  const brandSlug = firstQueryValue(req.query.brandSlug);

  try {
    const rows =
      typeof brandSlug === "string" ? await fetchPublicBrandBySlug(brandSlug) : [];
    const brand = rows[0] ?? null;
    const buffer = await renderOgPng({
      title: brand?.brand_name || "Mingla Business",
      subtitle:
        brand?.brand_description ||
        (brand
          ? `Discover events from ${brand.brand_name} on Mingla.`
          : "Create and share events on Mingla."),
      kicker: brand?.brand_slug ? `@${brand.brand_slug}` : "Mingla Business",
      coverUrl: brand?.brand_profile_photo_url || null,
    });
    sendPng(res, buffer);
  } catch {
    const buffer = await renderOgPng({
      title: "Mingla Business",
      subtitle: "Create and share events on Mingla.",
      kicker: "Mingla Business",
      coverUrl: null,
    });
    sendPng(res, buffer);
  }
};
