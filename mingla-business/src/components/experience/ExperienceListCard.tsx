/**
 * ExperienceListCard — Hub > "Your experiences" row.
 *
 * META-ORCH-1059 Pass 1: now a thin adapter over the shared OfferingListCard
 * (kind="experience"). Experience data is mapped to the normalized
 * OfferingListCardModel via `experienceToOfferingModel`, so experiences render
 * with identical structure to events + trips (cover thumb + status pill + title
 * + subline + spots-sold metric + revenue strip + 3-dot manage trigger).
 *
 * Tapping the card opens the experience DASHBOARD (`/experience/{id}`) via the
 * caller's `onOpen`; the dashboard owns the edit action. The 3-dot opens the
 * shared manage sheet via `onManageOpen`.
 */

import React, { useMemo } from "react";

import type { VenueExperience } from "../../services/experiencesService";
import {
  OfferingListCard,
  type OfferingListCardModel,
} from "../offering/OfferingListCard";
import { experienceToOfferingModel } from "../offering/offeringCardModels";

export interface ExperienceListCardProps {
  experience: VenueExperience;
  /** Tap card → open the experience dashboard. */
  onOpen: () => void;
  /** Optional 3-dot manage trigger. Only rendered when provided. */
  onManageOpen?: () => void;
  // ORCH-1116 [Hub multi-select draft delete] — pass-through selection props.
  selectionMode?: boolean;
  selected?: boolean;
  onLongPress?: () => void;
  selectable?: boolean;
}

export const ExperienceListCard: React.FC<ExperienceListCardProps> = ({
  experience,
  onOpen,
  onManageOpen,
  selectionMode,
  selected,
  onLongPress,
  selectable,
}) => {
  const model = useMemo<OfferingListCardModel>(
    () => experienceToOfferingModel(experience),
    [experience],
  );
  return (
    <OfferingListCard
      kind="experience"
      model={model}
      onOpen={onOpen}
      onManageOpen={onManageOpen}
      selectionMode={selectionMode}
      selected={selected}
      onLongPress={onLongPress}
      selectable={selectable}
    />
  );
};

export default ExperienceListCard;
