import { FollowButton } from "@mingla/brand-rendering";
import type { ThemePalette } from "@mingla/offering-rendering/themePalette";
import React from "react";
import { Alert } from "react-native";

import { useBrandFollow } from "../../hooks/useBrandFollow";
import { useAppStore } from "../../store/appStore";
import { HapticFeedback } from "../../utils/hapticFeedback";

type Props = {
  brandId: string;
  brandName: string;
  palette: ThemePalette;
};

export const PresentedByFollowButton: React.FC<Props> = ({
  brandId,
  brandName,
  palette,
}) => {
  const user = useAppStore((state) => state.user);
  const brandFollow = useBrandFollow(user?.id ?? null, brandId);

  return (
    <FollowButton
      brandName={brandName}
      palette={palette}
      isFollowing={brandFollow.isFollowing}
      followPending={brandFollow.isPending}
      size="lg"
      onPress={() => {
        if (!user?.id) {
          Alert.alert(
            `Sign in to follow ${brandName}`,
            "Hear about new dates first.",
          );
          return;
        }
        if (brandFollow.isFollowing) {
          Alert.alert(`Following ${brandName}`, undefined, [
            {
              text: "Unfollow",
              style: "destructive",
              onPress: () => {
                void brandFollow.unfollow().catch(() => {
                  // The Presented-by control intentionally keeps failures quiet.
                });
              },
            },
            { text: "Cancel", style: "cancel" },
          ]);
          return;
        }
        void brandFollow
          .follow()
          .then(() => {
            HapticFeedback.light();
          })
          .catch(() => {
            // The Presented-by control intentionally keeps failures quiet.
          });
      }}
    />
  );
};
