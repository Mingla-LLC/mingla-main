import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ─── Tour step definitions ───────────────────────────────────────────────
export interface TourStepDef {
  id: number;
  target: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  /** Where the bottom‑sheet card appears relative to the highlight */
  cardPosition: "bottom" | "top";
}

const TOUR_STEPS: TourStepDef[] = [
  {
    id: 1,
    target: "preferencesButton",
    icon: "locate",
    title: "Personalize Your Experience",
    description:
      "Tap the settings button to customize your vibes, dietary preferences, and more — so every recommendation feels just right.",
    cardPosition: "bottom",
  },
  {
    id: 2,
    target: "sessionPills",
    icon: "people",
    title: "Solo & Collaboration Modes",
    description:
      "Switch between Solo and Collaboration modes here! Each mode can have its own preferences (from step 1). Solo shows experiences tailored just for you, while collaboration sessions adapt to group preferences.",
    cardPosition: "bottom",
  },
  {
    id: 3,
    target: "soloButton",
    icon: "person",
    title: "Solo Mode",
    description:
      "Tap 'Solo' to browse experiences on your own. Your personal preferences will guide what you see.",
    cardPosition: "bottom",
  },
  {
    id: 4,
    target: "createSessionButton",
    icon: "sparkles",
    title: "Create Collaboration Session",
    description:
      "Tap the + button to create a new collaboration session and invite friends to swipe experiences together!",
    cardPosition: "bottom",
  },
  {
    id: 5,
    target: "swipeCard",
    icon: "sparkles",
    title: "Discover Local Experiences",
    description:
      "Swipe right to save experiences you love, left to pass.",
    cardPosition: "top",
  },
  {
    id: 6,
    target: "viewMoreButton",
    icon: "eye",
    title: "View Full Details",
    description:
      'Tap the "View More" button at the bottom of any card to see full details, photos, reviews, and booking options for the experience.',
    cardPosition: "top",
  },
  {
    id: 7,
    target: "discoverForYou",
    icon: "locate",
    title: "Personalized Feed",
    description:
      "Your curated feed shows experiences tailored to your preferences. Explore local activities, events, and parties just for you.",
    cardPosition: "bottom",
  },
  {
    id: 8,
    target: "discoverAddPerson",
    icon: "people",
    title: "Plan for Friends & Family",
    description:
      "Add people to get personalized experience recommendations for them! Perfect for planning birthdays, date nights, or special occasions.",
    cardPosition: "bottom",
  },
  {
    id: 9,
    target: "discoverNightOut",
    icon: "sparkles",
    title: "Night-Out Experiences",
    description:
      "Discover parties, events, and nightlife! From rooftop soirées to live music, find the perfect way to make your night unforgettable.",
    cardPosition: "bottom",
  },
  {
    id: 10,
    target: "connectFriendsTab",
    icon: "people",
    title: "Your Social Circle",
    description:
      "Connect with friends, send collaboration invites, and build your network. See who\u2019s online and what experiences they\u2019re exploring.",
    cardPosition: "bottom",
  },
  {
    id: 11,
    target: "connectMessagesTab",
    icon: "chatbubble-ellipses",
    title: "Direct Messaging",
    description:
      "Chat with friends about experiences, share recommendations, and coordinate plans. Keep all your conversations in one place.",
    cardPosition: "bottom",
  },
  {
    id: 12,
    target: "likesSavedTab",
    icon: "save",
    title: "Your Saved Experiences",
    description:
      "All experiences you\u2019ve liked are saved here. Browse your collection, schedule them, or purchase tickets when you\u2019re ready.",
    cardPosition: "bottom",
  },
  {
    id: 13,
    target: "likesCalendarTab",
    icon: "calendar",
    title: "Your Calendar",
    description:
      "Track all your scheduled and purchased experiences in one place. Get QR codes for entry, propose new dates, and manage your upcoming adventures.",
    cardPosition: "bottom",
  },
  {
    id: 14,
    target: "profileHub",
    icon: "person-circle",
    title: "Your Profile Hub",
    description:
      "View your stats, manage settings, track your vibes, and customize your Mingla experience. This is your personal dashboard for everything Mingla!",
    cardPosition: "bottom",
  },
];

const TOTAL_STEPS = 14; // final planned count

// ─── Highlight geometry (matches existing hard‑coded pixel math) ─────────
function getHighlightForTarget(target: string) {
  switch (target) {
    case "preferencesButton": {
      const safeAreaTop = 44;
      const headerPaddingTop = 8;
      const buttonLeft = 16;
      const buttonSize = 60;
      const pad = 10;
      const s = buttonSize + pad * 2;
      return {
        top: safeAreaTop + headerPaddingTop - pad,
        left: buttonLeft - pad,
        width: s,
        height: s,
        borderRadius: s / 2,
      };
    }
    case "sessionPills": {
      const safeAreaTop = 44;
      const headerHeight = 56;
      const marginTop = 10;
      const marginH = 17;
      const pad = 10;
      const barTop = safeAreaTop + headerHeight + marginTop;
      const barHeight = 52; // paddingVertical(10*2) + pill(32)
      return {
        top: barTop - pad,
        left: marginH - pad,
        width: SCREEN_WIDTH - marginH * 2 + pad * 2,
        height: barHeight + pad * 2,
        borderRadius: 24,
      };
    }
    case "soloButton": {
      const safeAreaTop = 44;
      const headerHeight = 56;
      const marginTop = 10;
      const containerPadH = 4;
      const scrollPadH = 12;
      const scrollPadV = 10;
      const pillHeight = 32;
      const pillWidth = 62; // "Solo" text + paddingHorizontal(14*2)
      const pad = 8;
      const barTop = safeAreaTop + headerHeight + marginTop;
      const pillLeft = 17 + containerPadH + scrollPadH;
      return {
        top: barTop + scrollPadV - pad,
        left: pillLeft - pad,
        width: pillWidth + pad * 2,
        height: pillHeight + pad * 2,
        borderRadius: (pillHeight + pad * 2) / 2,
      };
    }
    case "createSessionButton": {
      const safeAreaTop = 44;
      const headerHeight = 56;
      const marginTop = 10;
      const containerPadH = 4;
      const scrollPadH = 12;
      const scrollPadV = 10;
      const pillHeight = 32;
      const soloPillWidth = 62;
      const gap = 6;
      const createSize = 32; // width & height of + pill
      const pad = 10;
      const barTop = safeAreaTop + headerHeight + marginTop;
      const btnLeft = 17 + containerPadH + scrollPadH + soloPillWidth + gap;
      return {
        top: barTop + scrollPadV - pad,
        left: btnLeft - pad,
        width: createSize + pad * 2,
        height: pillHeight + pad * 2,
        borderRadius: (pillHeight + pad * 2) / 2,
      };
    }
    case "swipeCard": {
      const cardWidth = SCREEN_WIDTH - 40;
      const cardHeight = SCREEN_HEIGHT * 0.52;
      return {
        top: SCREEN_HEIGHT - cardHeight - 90,
        left: 20,
        width: cardWidth,
        height: cardHeight,
        borderRadius: 24,
      };
    }
    case "viewMoreButton": {
      // "View More" badge sits near the bottom of the card image
      const badgeWidth = 120;
      const badgeHeight = 34;
      const pad = 12;
      const badgeTop = SCREEN_HEIGHT - 90 - 50 - badgeHeight - 10;
      const badgeLeft = SCREEN_WIDTH / 2 - badgeWidth / 2 - badgeWidth;
      return {
        top: badgeTop - pad,
        left: badgeLeft - pad,
        width: badgeWidth + pad * 2,
        height: badgeHeight + pad * 2,
        borderRadius: 20,
      };
    }
    case "discoverForYou": {
      // "For You" tab: first of 2 flex:1 tabs at top of Discover screen
      const safeAreaTop = 44;
      const tabHeight = 56; // paddingVertical(12*2) + icon(18) + gap(4) + text(14) ≈ 56
      const pad = 8;
      return {
        top: safeAreaTop - pad,
        left: -pad,
        width: SCREEN_WIDTH / 2 + pad * 2,
        height: tabHeight + pad * 2,
        borderRadius: 16,
      };
    }
    case "discoverAddPerson": {
      // Add Person button: 40x40 circle after "For You" pill in the pills row
      const safeAreaTop = 44;
      const tabsHeight = 56; // For You / Night Out tabs
      const contentPad = 16;
      const forYouPillWidth = 72; // "For You" text + paddingHorizontal(12*2)
      const gap = 12;
      const btnSize = 40;
      const pad = 10;
      const btnTop = safeAreaTop + tabsHeight + contentPad + 6;
      const btnLeft = contentPad + forYouPillWidth + gap + 8;
      return {
        top: btnTop - pad,
        left: btnLeft - pad,
        width: btnSize + pad * 2,
        height: btnSize + pad * 2,
        borderRadius: (btnSize + pad * 2) / 2,
      };
    }
    case "discoverNightOut": {
      // "Night Out" tab: second of 2 flex:1 tabs at top of Discover screen
      const safeAreaTop = 44;
      const tabHeight = 56;
      const pad = 8;
      return {
        top: safeAreaTop - pad,
        left: SCREEN_WIDTH / 2 - pad,
        width: SCREEN_WIDTH / 2 + pad * 2,
        height: tabHeight + pad * 2,
        borderRadius: 16,
      };
    }
    case "connectFriendsTab": {
      // Friends tab: first of 2 flex:1 tabs at top of Connect page
      const safeAreaTop = 44;
      const tabHeight = 62; // paddingVertical(12*2) + icon(20) + gap(4) + text(14)
      const pad = 8;
      return {
        top: safeAreaTop - pad,
        left: -pad,
        width: SCREEN_WIDTH / 2 + pad * 2,
        height: tabHeight + pad * 2,
        borderRadius: 16,
      };
    }
    case "connectMessagesTab": {
      // Messages tab: second of 2 flex:1 tabs at top of Connect page
      const safeAreaTop = 44;
      const tabHeight = 62;
      const pad = 8;
      return {
        top: safeAreaTop - pad,
        left: SCREEN_WIDTH / 2 - pad,
        width: SCREEN_WIDTH / 2 + pad * 2,
        height: tabHeight + pad * 2,
        borderRadius: 16,
      };
    }
    case "likesSavedTab": {
      // Saved tab: first of 2 flex:1 tabs at top of Likes page
      const safeAreaTop = 44;
      const tabHeight = 62; // paddingVertical(12*2) + icon(20) + gap(4) + text(14)
      const pad = 8;
      return {
        top: safeAreaTop - pad,
        left: -pad,
        width: SCREEN_WIDTH / 2 + pad * 2,
        height: tabHeight + pad * 2,
        borderRadius: 16,
      };
    }
    case "likesCalendarTab": {
      // Calendar tab: second of 2 flex:1 tabs at top of Likes page
      const safeAreaTop = 44;
      const tabHeight = 62;
      const pad = 8;
      return {
        top: safeAreaTop - pad,
        left: SCREEN_WIDTH / 2 - pad,
        width: SCREEN_WIDTH / 2 + pad * 2,
        height: tabHeight + pad * 2,
        borderRadius: 16,
      };
    }
    case "profileHub":
      // No highlight — card-only step
      return null;
    default:
      return { top: 0, left: 0, width: 60, height: 60, borderRadius: 30 };
  }
}

// ─── Component ───────────────────────────────────────────────────────────
interface CoachMarkTourProps {
  visible: boolean;
  onComplete: () => void;
  onSkip: () => void;
  onStepChange?: (stepIndex: number, target: string) => void;
}

export default function CoachMarkTour({
  visible,
  onComplete,
  onSkip,
  onStepChange,
}: CoachMarkTourProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const step = TOUR_STEPS[currentIndex] ?? TOUR_STEPS[0];

  // ─── Animations ──────────────────────────────────────────────────────
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const cardSlide = useRef(new Animated.Value(300)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  // Pulsing ring
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(1)).current;

  // Pulsing white dot
  const dotScale = useRef(new Animated.Value(1)).current;
  const dotOpacity = useRef(new Animated.Value(1)).current;

  // Next button shimmer
  const shimmerAnim = useRef(new Animated.Value(-1)).current;

  // Next button arrow bounce
  const arrowBounce = useRef(new Animated.Value(0)).current;

  // Swipe card: pass arrow bounce (left), like arrow bounce (right), hand pulse
  const passArrowBounce = useRef(new Animated.Value(0)).current;
  const likeArrowBounce = useRef(new Animated.Value(0)).current;
  const handScale = useRef(new Animated.Value(1)).current;
  const handOpacity = useRef(new Animated.Value(1)).current;

  // ─── Enter / transition ──────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;

    // Reset
    overlayAnim.setValue(0);
    cardSlide.setValue(300);
    cardOpacity.setValue(0);
    shimmerAnim.setValue(-1);
    arrowBounce.setValue(0);

    // Notify parent of first step
    onStepChange?.(0, TOUR_STEPS[0].target);

    // Entrance
    Animated.parallel([
      Animated.timing(overlayAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.spring(cardSlide, {
        toValue: 0,
        friction: 9,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();

    // Pulse ring loop
    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1.25,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.3,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    ringLoop.start();

    // Pulse white dot loop
    const dotLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(dotScale, {
            toValue: 1.5,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dotOpacity, {
            toValue: 0.4,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(dotScale, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dotOpacity, {
            toValue: 1,
            duration: 700,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    dotLoop.start();

    // Shimmer loop on Next button
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 2,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(800),
        Animated.timing(shimmerAnim, {
          toValue: -1,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    shimmerLoop.start();

    // Arrow bounce (side‑to‑side poke)
    const arrowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrowBounce, {
          toValue: 5,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(arrowBounce, {
          toValue: -2,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(arrowBounce, {
          toValue: 4,
          duration: 250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(arrowBounce, {
          toValue: 0,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(600),
      ])
    );
    arrowLoop.start();

    // Pass arrow bounce (points left)
    const passLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(passArrowBounce, {
          toValue: -5,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(passArrowBounce, {
          toValue: 2,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(passArrowBounce, {
          toValue: -4,
          duration: 250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(passArrowBounce, {
          toValue: 0,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(600),
      ])
    );
    passLoop.start();

    // Like arrow bounce (points right)
    const likeLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(likeArrowBounce, {
          toValue: 5,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(likeArrowBounce, {
          toValue: -2,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(likeArrowBounce, {
          toValue: 4,
          duration: 250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(likeArrowBounce, {
          toValue: 0,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(600),
      ])
    );
    likeLoop.start();

    // Hand icon pulse
    const handLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(handScale, {
            toValue: 1.2,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(handOpacity, {
            toValue: 0.7,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(handScale, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(handOpacity, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    handLoop.start();

    return () => {
      ringLoop.stop();
      dotLoop.stop();
      shimmerLoop.stop();
      arrowLoop.stop();
      passLoop.stop();
      likeLoop.stop();
      handLoop.stop();
    };
  }, [visible]);

  // ─── Navigation ──────────────────────────────────────────────────────
  const animateTransition = (nextIndex: number) => {
    // Slide card out
    Animated.parallel([
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(cardSlide, {
        toValue: 100,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentIndex(nextIndex);
      onStepChange?.(nextIndex, TOUR_STEPS[nextIndex].target);

      // Slide card in
      cardSlide.setValue(-60);
      Animated.parallel([
        Animated.spring(cardSlide, {
          toValue: 0,
          friction: 9,
          tension: 40,
          useNativeDriver: true,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    });
  };

  const handleNext = () => {
    if (currentIndex < TOUR_STEPS.length - 1) {
      animateTransition(currentIndex + 1);
    } else {
      // Last step → complete
      handleComplete();
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      animateTransition(currentIndex - 1);
    }
  };

  const handleComplete = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(cardSlide, {
        toValue: 300,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentIndex(0);
      onComplete();
    });
  };

  const handleSkip = () => {
    Animated.parallel([
      Animated.timing(overlayAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(cardSlide, {
        toValue: 300,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setCurrentIndex(0);
      onSkip();
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────
  if (!visible) return null;

  const hl = getHighlightForTarget(step.target);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === TOTAL_STEPS - 1;
  const hasHighlight = hl !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* ── Dark overlay with cutout ────────────────────────────── */}
        {hasHighlight ? (
          <Animated.View
            style={[
              styles.overlayCutout,
              {
                top: hl.top - 2000,
                left: hl.left - 2000,
                width: hl.width + 4000,
                height: hl.height + 4000,
                borderRadius: hl.borderRadius + 2000,
                borderWidth: 2000,
                opacity: overlayAnim,
              },
            ]}
            pointerEvents="none"
          />
        ) : (
          <Animated.View
            style={[
              styles.overlayFull,
              { opacity: overlayAnim },
            ]}
            pointerEvents="none"
          />
        )}

        {/* ── Pulsing orange ring ─────────────────────────────────── */}
        {hasHighlight && (
          <Animated.View
            style={[
              styles.ringOuter,
              {
                top: hl.top,
                left: hl.left,
                width: hl.width,
                height: hl.height,
                borderRadius: hl.borderRadius,
                transform: [{ scale: ringScale }],
                opacity: ringOpacity,
              },
            ]}
            pointerEvents="none"
          />
        )}

        {/* Light orange tint fill inside the ring */}
        {hasHighlight && (
          <View
            style={[
              styles.ringFill,
              {
                top: hl.top,
                left: hl.left,
                width: hl.width,
                height: hl.height,
                borderRadius: hl.borderRadius,
              },
            ]}
            pointerEvents="none"
          />
        )}

        {/* Static inner ring (always visible border) */}
        {hasHighlight && (
          <View
            style={[
              styles.ringInner,
              {
                top: hl.top,
                left: hl.left,
                width: hl.width,
                height: hl.height,
                borderRadius: hl.borderRadius,
              },
            ]}
            pointerEvents="none"
          />
        )}

        {/* ── White corner brackets (target look) ─────────────────── */}
        {hasHighlight && (() => {
          const cornerSize = 24;
          const bw = 3.5;
          const offset = -4; // slight outset from highlight edge
          return (
            <>
              {/* Top-left */}
              <View
                style={[
                  styles.cornerBracket,
                  {
                    top: hl.top + offset,
                    left: hl.left + offset,
                    width: cornerSize,
                    height: cornerSize,
                    borderTopWidth: bw,
                    borderLeftWidth: bw,
                    borderTopLeftRadius: 12,
                  },
                ]}
                pointerEvents="none"
              />
              {/* Top-right */}
              <View
                style={[
                  styles.cornerBracket,
                  {
                    top: hl.top + offset,
                    left: hl.left + hl.width - cornerSize - offset,
                    width: cornerSize,
                    height: cornerSize,
                    borderTopWidth: bw,
                    borderRightWidth: bw,
                    borderTopRightRadius: 12,
                  },
                ]}
                pointerEvents="none"
              />
              {/* Bottom-left */}
              <View
                style={[
                  styles.cornerBracket,
                  {
                    top: hl.top + hl.height - cornerSize - offset,
                    left: hl.left + offset,
                    width: cornerSize,
                    height: cornerSize,
                    borderBottomWidth: bw,
                    borderLeftWidth: bw,
                    borderBottomLeftRadius: 12,
                  },
                ]}
                pointerEvents="none"
              />
              {/* Bottom-right */}
              <View
                style={[
                  styles.cornerBracket,
                  {
                    top: hl.top + hl.height - cornerSize - offset,
                    left: hl.left + hl.width - cornerSize - offset,
                    width: cornerSize,
                    height: cornerSize,
                    borderBottomWidth: bw,
                    borderRightWidth: bw,
                    borderBottomRightRadius: 12,
                  },
                ]}
                pointerEvents="none"
              />
            </>
          );
        })()}

        {/* ── Pulsing white dot ───────────────────────────────────── */}
        {hasHighlight && (
          <Animated.View
            style={[
              styles.whiteDot,
              {
                top: hl.top - 14,
                left: hl.left + hl.width / 2 - 6,
                transform: [{ scale: dotScale }],
                opacity: dotOpacity,
              },
            ]}
            pointerEvents="none"
          />
        )}

        {/* ── Swipe card overlays (Pass / Like / Hand) ────────────── */}
        {hasHighlight && step.target === "swipeCard" && (
          <>
            {/* Pass label + arrow (left side) */}
            <Animated.View
              style={[
                styles.swipeLabel,
                {
                  top: hl.top + hl.height / 2 - 20,
                  left: hl.left + 14,
                },
                { opacity: overlayAnim },
              ]}
              pointerEvents="none"
            >
              <Animated.View style={{ transform: [{ translateX: passArrowBounce }] }}>
                <Ionicons name="arrow-back" size={18} color="#eb7825" />
              </Animated.View>
              <Text style={styles.swipeLabelText}>Pass</Text>
            </Animated.View>

            {/* Like label + arrow (right side) */}
            <Animated.View
              style={[
                styles.swipeLabel,
                {
                  top: hl.top + hl.height / 2 - 20,
                  right: SCREEN_WIDTH - (hl.left + hl.width) + 14,
                },
                { opacity: overlayAnim },
              ]}
              pointerEvents="none"
            >
              <Text style={styles.swipeLabelText}>Like</Text>
              <Animated.View style={{ transform: [{ translateX: likeArrowBounce }] }}>
                <Ionicons name="arrow-forward" size={18} color="#eb7825" />
              </Animated.View>
            </Animated.View>

            {/* Center hand icon */}
            <Animated.View
              style={[
                styles.handIcon,
                {
                  top: hl.top + hl.height / 2 - 28,
                  left: hl.left + hl.width / 2 - 28,
                  transform: [{ scale: handScale }],
                  opacity: handOpacity,
                },
              ]}
              pointerEvents="none"
            >
              <Ionicons name="hand-right" size={30} color="white" />
            </Animated.View>
          </>
        )}

        {/* ── Card (top or bottom) ────────────────────────────────── */}
        <Animated.View
          style={[
            step.cardPosition === "top" ? styles.cardTop : styles.card,
            {
              opacity: cardOpacity,
              transform: [{ translateY: step.cardPosition === "top" ? Animated.multiply(cardSlide, -1) : cardSlide }],
            },
          ]}
        >
          {/* Icon */}
          <View style={styles.iconCircle}>
            <Ionicons name={step.icon as any} size={28} color="#eb7825" />
          </View>

          {/* Title & description */}
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.description}>{step.description}</Text>

          {/* ── Progress dots ─────────────────────────────────────── */}
          <View style={styles.progressRow}>
            <View style={styles.dots}>
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i <= currentIndex ? styles.dotActive : styles.dotInactive,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.stepCounter}>
              ✨ Step {currentIndex + 1} of {TOTAL_STEPS}
            </Text>
          </View>

          {/* ── Footer buttons ────────────────────────────────────── */}
          <View style={styles.footer}>
            {/* Previous */}
            <TouchableOpacity
              onPress={handlePrevious}
              disabled={isFirst}
              style={[styles.prevBtn, isFirst && styles.prevBtnDisabled]}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.prevText,
                  isFirst && styles.prevTextDisabled,
                ]}
              >
                Previous
              </Text>
            </TouchableOpacity>

            {/* Skip */}
            <TouchableOpacity
              onPress={handleSkip}
              style={styles.skipBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.skipText}>Skip</Text>
            </TouchableOpacity>

            {/* Next */}
            <TouchableOpacity
              onPress={handleNext}
              style={styles.nextBtn}
              activeOpacity={0.85}
            >
              <View style={styles.nextContent}>
                <Text style={styles.nextText}>
                  {isLast ? "Finish" : "Next"}
                </Text>
                <Animated.View
                  style={{ transform: [{ translateX: arrowBounce }] }}
                >
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color="white"
                  />
                </Animated.View>
              </View>

              {/* Shimmer */}
              <Animated.View
                style={[
                  styles.shimmer,
                  {
                    transform: [
                      {
                        translateX: shimmerAnim.interpolate({
                          inputRange: [-1, 2],
                          outputRange: [-160, 300],
                        }),
                      },
                    ],
                  },
                ]}
                pointerEvents="none"
              />
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  /* Full overlay (no cutout) for card-only steps */
  overlayFull: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
  },

  /* Overlay with cutout */
  overlayCutout: {
    position: "absolute",
    backgroundColor: "transparent",
    borderColor: "rgba(0, 0, 0, 0.72)",
  },

  /* ─── Highlight ring ───────────────────────────────────────────────── */
  ringOuter: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#eb7825",
    backgroundColor: "transparent",
  },
  ringInner: {
    position: "absolute",
    borderWidth: 2.5,
    borderColor: "#eb7825",
    backgroundColor: "transparent",
  },
  ringFill: {
    position: "absolute",
    backgroundColor: "rgba(235, 120, 37, 0.15)",
  },

  /* ─── Corner brackets ──────────────────────────────────────────────── */
  cornerBracket: {
    position: "absolute",
    borderColor: "white",
    backgroundColor: "transparent",
  },

  /* ─── White dot ────────────────────────────────────────────────────── */
  whiteDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "white",
    shadowColor: "white",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 6,
  },

  /* ─── Bottom card ──────────────────────────────────────────────────── */
  cardTop: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    backgroundColor: "white",
    borderRadius: 28,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 24,
  },
  card: {
    position: "absolute",
    bottom: 140,
    left: 20,
    right: 20,
    backgroundColor: "white",
    borderRadius: 28,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 24,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fef3e2",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    textAlign: "left",
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "left",
    lineHeight: 22,
    marginBottom: 20,
    paddingHorizontal: 0,
  },

  /* ─── Progress dots ────────────────────────────────────────────────── */
  progressRow: {
    alignItems: "center",
    marginBottom: 20,
    gap: 8,
  },
  dots: {
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: "#eb7825",
  },
  dotInactive: {
    backgroundColor: "#d1d5db",
  },
  stepCounter: {
    fontSize: 13,
    fontWeight: "600",
    color: "#9ca3af",
  },

  /* ─── Footer buttons ───────────────────────────────────────────────── */
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  prevBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "#f3f4f6",
  },
  prevBtnDisabled: {
    opacity: 0.45,
  },
  prevText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6b7280",
  },
  prevTextDisabled: {
    color: "#9ca3af",
  },
  skipBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#9ca3af",
  },
  nextBtn: {
    backgroundColor: "#eb7825",
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 22,
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
    overflow: "hidden",
  },
  nextContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nextText: {
    fontSize: 16,
    fontWeight: "700",
    color: "white",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 100,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    borderRadius: 16,
    opacity: 0.7,
  },

  /* ─── Swipe card overlays ──────────────────────────────────────────── */
  swipeLabel: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  swipeLabelText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  handIcon: {
    position: "absolute",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 10,
  },
});
