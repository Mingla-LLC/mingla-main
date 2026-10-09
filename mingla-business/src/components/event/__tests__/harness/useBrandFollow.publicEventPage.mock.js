/**
 * #3682 — shared Follow double for PublicEventPage mount harnesses.
 *
 * Real `useBrandFollow` pulls brandFollowsService → supabase createClient at
 * module load. Suites that mock react-query without useMutation (or without
 * env) must install this mock before importing PublicEventPage.
 *
 * Usage (top of test file, with other jest.mock calls):
 *   jest.mock(
 *     "../../../hooks/useBrandFollow",
 *     () => require("./harness/useBrandFollow.publicEventPage.mock"),
 *   );
 */

module.exports = {
  useBrandFollow: () => ({
    isFollowing: false,
    isPending: false,
    toggle: async () => false,
    follow: async () => undefined,
    unfollow: async () => undefined,
  }),
};
