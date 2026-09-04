/*
 * #2830 — the explicit map from gögi's own asset files to the slots the seed
 * consumes. Written out by hand rather than inferred from filenames: a slot
 * silently binding to the wrong photo is not something a test would catch, and
 * "gallery7" pointing at a portrait is worse than a missing image.
 *
 * Source: gögi's own site, downloaded with the operator's explicit permission
 * on 2026-09-04. Their content, their brand, seeded into their Mingla site.
 */
export const MEDIA_SLOTS = Object.freeze({
  /*
   * The hero STILL is not listed here. The seed uploads it itself, under its
   * own content-addressed name, because classifySnapshot identifies the hero by
   * filename. Listing it here too would upload the same bytes a second time
   * under a second name and leave two identical rows in the media library.
   * Pass it as --hero-image instead.
   */
  heroVideo: "assets/video/hero-food.mp4",

  reelFoodHouse: "assets/video/reel-24-7-food-house.mp4",
  reelFoodHousePoster: "assets/video/reel-24-7-food-house.jpg",
  reelCoconutRice: "assets/video/reel-coconut-rice.mp4",
  reelCoconutRicePoster: "assets/video/reel-coconut-rice.jpg",
  reelPregameFriday: "assets/video/reel-pregame-friday.mp4",
  reelPregameFridayPoster: "assets/video/reel-pregame-friday.jpg",
  reelMeetTheTeam: "assets/video/reel-meet-the-team.mp4",
  reelMeetTheTeamPoster: "assets/video/reel-meet-the-team.jpg",
  reelLateNightCravings: "assets/video/reel-late-night-cravings.mp4",
  reelLateNightCravingsPoster: "assets/video/reel-late-night-cravings.jpg",
  reelOutsideGogi: "assets/video/reel-outside-gogi.mp4",
  reelOutsideGogiPoster: "assets/video/reel-outside-gogi.jpg",

  // Gallery order is the order gögi themselves show them in.
  gallery1: "assets/img/gallery/storefront.jpg",
  gallery2: "assets/img/gallery/coconut-rice-bowl.jpg",
  gallery3: "assets/img/gallery/pregame-crowd.jpg",
  gallery4: "assets/img/gallery/late-night-wings.jpg",
  gallery5: "assets/img/gallery/dj-booth.jpg",
  gallery6: "assets/img/gallery/table-of-friends.jpg",
  gallery7: "assets/img/gallery/under-the-sign.jpg",
  gallery8: "assets/img/gallery/dancing-inside.jpg",
  gallery9: "assets/img/gallery/daytime-table.jpg",
  gallery10: "assets/img/gallery/agbada-night.jpg",
  gallery11: "assets/img/gallery/outside-24-7.jpg",
  gallery12: "assets/img/gallery/rice-in-the-pan.jpg",
  gallery13: "assets/img/gallery/meet-the-team.jpg",
  gallery14: "assets/img/gallery/find-gogi-01.jpg",
  gallery15: "assets/img/gallery/find-gogi-02.jpg",
  gallery16: "assets/img/gallery/pregame-bw.jpg",

  // Keyed by the nickname gögi uses, so the portrait binds to the right person.
  "team:Madam Chief chef": "assets/img/team/madam-chief-chef.jpg",
  "team:Mr slice it all": "assets/img/team/mr-slice-it-all.jpg",
  "team:Stir fry bobo": "assets/img/team/stir-fry-bobo.jpg",
  "team:Mix engineer": "assets/img/team/mix-engineer.jpg",
  "team:Scoopy doo": "assets/img/team/scoopy-doo.jpg",
  "team:Bad boy fresh": "assets/img/team/bad-boy-fresh.jpg",
  "team:Mr cook half eat half": "assets/img/team/mr-cook-half-eat-half.jpg",
  "team:Meat police": "assets/img/team/meat-police.jpg",
  "team:Fling stone": "assets/img/team/fling-stone.jpg",
  "team:Fake chef": "assets/img/team/fake-chef.jpg",

  foodCoconutRiceBowl: "assets/img/food/coconut-rice-bowl.jpg",
  foodSqCoconutRiceBowl: "assets/img/food/sq-coconut-rice-bowl.jpg",
  foodSqWingsBoard: "assets/img/food/sq-wings-board.jpg",
  foodSqStirFryPlate: "assets/img/food/sq-stir-fry-plate.jpg",
  foodSqSmoothie: "assets/img/food/sq-smoothie.jpg",

  brandWordmark: "assets/img/brand/gogi-wordmark-white.png",
});
