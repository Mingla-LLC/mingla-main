import confetti from "./lottie/confetti.json";
import fireworks from "./lottie/fireworks.json";
import balloons from "./lottie/balloons.json";
import sparkles from "./lottie/sparkles.json";
import glitterShower from "./lottie/glitter_shower.json";
import snowfall from "./lottie/snowfall.json";
import fallingPetals from "./lottie/falling_petals.json";
import hearts from "./lottie/hearts.json";
import shimmerReveal from "./lottie/shimmer_reveal.json";

import type { ThemeAnimationSlug } from "@mingla/event-rendering";

export const LOTTIE_BY_SLUG: Record<
  Exclude<ThemeAnimationSlug, "none">,
  object
> = {
  confetti,
  fireworks,
  balloons,
  sparkles,
  glitter_shower: glitterShower,
  snowfall,
  falling_petals: fallingPetals,
  hearts,
  shimmer_reveal: shimmerReveal,
};
