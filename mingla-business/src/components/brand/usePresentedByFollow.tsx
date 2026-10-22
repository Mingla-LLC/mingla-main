import { FollowButton } from "@mingla/brand-rendering";
import type { ThemePalette } from "@mingla/offering-rendering";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Platform } from "react-native";

import { useAuth } from "../../context/AuthContext";
import { useBrandFollow } from "../../hooks/useBrandFollow";
import { useBrandFollowerCount } from "../../hooks/useBrandFollowerCount";
import { SimpleConfirmDialog } from "../ui/SimpleConfirmDialog";
import { Toast } from "../ui/Toast";

const FollowByEmailSheet = React.lazy(() =>
  import("./FollowByEmailSheet").then((module) => ({
    default: module.FollowByEmailSheet,
  })),
);

type Input = {
  brandId: string;
  brandName: string;
  palette: ThemePalette;
};

type Result = {
  node: React.ReactNode;
  overlays: React.ReactNode;
  followerCount: number | null;
  followerCountLoading: boolean;
};

export function usePresentedByFollow({
  brandId,
  brandName,
  palette,
}: Input): Result {
  const router = useRouter();
  const { user } = useAuth();
  const brandFollow = useBrandFollow(user?.id ?? null, brandId);
  const followerCountQuery = useBrandFollowerCount(brandId);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailPending, setEmailPending] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [unfollowOpen, setUnfollowOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const node = (
    <FollowButton
      brandName={brandName}
      palette={palette}
      isFollowing={brandFollow.isFollowing}
      followPending={brandFollow.isPending || emailPending}
      state={emailPending && !brandFollow.isFollowing ? "pending" : undefined}
      size="lg"
      onPress={() => {
        if (!user?.id) {
          if (Platform.OS === "web") setEmailOpen(true);
          else setSignInOpen(true);
          return;
        }
        if (brandFollow.isFollowing) {
          setUnfollowOpen(true);
          return;
        }
        void brandFollow.follow().catch(() => {
          setErrorMessage("Couldn't follow. Try again.");
        });
      }}
      testID="presented-by-follow"
    />
  );

  const overlays = (
    <>
      {emailOpen ? (
        <React.Suspense fallback={null}>
          <FollowByEmailSheet
            visible={emailOpen}
            brandId={brandId}
            brandName={brandName}
            onClose={() => setEmailOpen(false)}
            onSent={() => setEmailPending(true)}
          />
        </React.Suspense>
      ) : null}
      <SimpleConfirmDialog
        visible={signInOpen}
        onClose={() => setSignInOpen(false)}
        onConfirm={() => {
          setSignInOpen(false);
          router.push("/auth" as never);
        }}
        title={`Sign in to follow ${brandName}`}
        description="Hear about new dates first."
        confirmLabel="Sign in"
        cancelLabel="Not now"
        testID="presented-by-follow-signin"
      />
      <SimpleConfirmDialog
        visible={unfollowOpen}
        onClose={() => setUnfollowOpen(false)}
        onConfirm={() => {
          void brandFollow
            .unfollow()
            .then(() => setUnfollowOpen(false))
            .catch(() => setErrorMessage("Couldn't update. Try again."));
        }}
        title={`Following ${brandName}`}
        description="Stop hearing about new dates from this brand."
        confirmLabel="Unfollow"
        cancelLabel="Cancel"
        destructive
        confirmLoading={brandFollow.isPending}
        testID="presented-by-unfollow"
      />
      <Toast
        visible={errorMessage !== null}
        kind="error"
        message={errorMessage ?? ""}
        onDismiss={() => setErrorMessage(null)}
      />
    </>
  );

  return {
    node,
    overlays,
    followerCount: followerCountQuery.isError
      ? null
      : (followerCountQuery.data ?? null),
    followerCountLoading:
      followerCountQuery.isPending && !followerCountQuery.isError,
  };
}
