/**
 * The append-only #2983 runtime test describes the pre-#3000 city release:
 * non-Lagos guides showed the audience fork and `/cities` did not yet exist.
 * The required build lane renders that historical fixture once, runs its old
 * assertions, then rebuilds the actual #3176 release with this flag absent.
 * The immutable #2990 postbuild tests run afterward with npm's `postbuild`
 * lifecycle marker, so they receive the same explicit compatibility fixture.
 * Production and the final CI artifact have the current `/cities` directory
 * and top-50-overall catalogues because neither marker exists there.
 */
export function historicalCityBuildEnabled(): boolean {
  return process.env.MINGLA_HISTORICAL_2983_BUILD === '1' ||
    process.env.npm_lifecycle_event === 'postbuild'
}
