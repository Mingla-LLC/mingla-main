/**
 * #4334 — Google Maps attribution under every list of Google place results
 * (the growth tools' city and destination pickers). Google's own White logo,
 * unmodified (from Google_Maps_Attribution_Assets.zip, approved 2026-11-08),
 * for the dark dropdown surface; drawn at 98×18 px — its native aspect ratio,
 * inside Google's 16–19 px height rule — with the required clear space:
 * 10 px left, right and top, 5 px bottom.
 * https://developers.google.com/maps/documentation/places/web-service/policies
 */
export function GoogleMapsAttribution() {
  return (
    <div className="flex justify-end px-[10px] pt-[10px] pb-[5px]" data-testid="google-maps-attribution">
      <img
        src="/brand/google-maps-logo-white.png"
        srcSet="/brand/google-maps-logo-white.png 1x, /brand/google-maps-logo-white@2x.png 2x, /brand/google-maps-logo-white@4x.png 4x"
        width={98}
        height={18}
        alt="Google Maps"
        className="h-[18px] w-[98px] select-none"
        draggable={false}
      />
    </div>
  )
}
