import React, { useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import FindBusiness from "../../src/components/claim/FindBusiness";
import PlacePreview from "../../src/components/claim/PlacePreview";
import EnrichProfile from "../../src/components/claim/EnrichProfile";
import PlaceLiveConfirmation from "../../src/components/claim/PlaceLiveConfirmation";
import type { PlacePoolItem } from "../../src/services/placeService";

type ClaimStep = "search" | "preview" | "enrich" | "confirmation";

export default function ClaimScreen() {
  const router = useRouter();
  const { refreshAccountStatus } = useAuth();
  const [step, setStep] = useState<ClaimStep>("search");
  const [selectedPlace, setSelectedPlace] = useState<PlacePoolItem | null>(null);
  const [businessProfileId, setBusinessProfileId] = useState<string | null>(null);

  const goBack = (): void => {
    router.back();
  };

  switch (step) {
    case "search":
      return (
        <FindBusiness
          onSelect={(place) => {
            setSelectedPlace(place);
            setStep("preview");
          }}
          onBack={goBack}
          onCreateNew={() =>
            Alert.alert("Coming soon", "Create new place is coming in a future update.")
          }
        />
      );

    case "preview":
      if (!selectedPlace) return null;
      return (
        <PlacePreview
          place={selectedPlace}
          onClaimed={(profileId) => {
            setBusinessProfileId(profileId);
            setStep("enrich");
          }}
          onBack={() => setStep("search")}
        />
      );

    case "enrich":
      if (!selectedPlace || !businessProfileId) return null;
      return (
        <EnrichProfile
          place={selectedPlace}
          businessProfileId={businessProfileId}
          onContinue={() => setStep("confirmation")}
          onBack={() => setStep("preview")}
        />
      );

    case "confirmation":
      if (!selectedPlace) return null;
      return (
        <PlaceLiveConfirmation
          placeName={selectedPlace.name}
          onSnapMenu={() => {
            refreshAccountStatus();
            router.replace("/menu" as never);
          }}
          onCreateEvent={() =>
            Alert.alert("Coming soon", "Event creation is coming in Phase 3.")
          }
          onGoToDashboard={() => {
            refreshAccountStatus();
            router.replace("/home" as never);
          }}
        />
      );

    default:
      return null;
  }
}
