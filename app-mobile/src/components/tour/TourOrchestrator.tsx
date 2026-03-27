import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { useTourTargets } from '../../contexts/TourTargetContext';
import { TourOverlay } from './TourOverlay';
import {
  seedTourData,
  clearTourData,
  ensureTourDataSeeded,
} from '../../data/mockTourData';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../services/supabase';
import { realtimeService } from '../../services/realtimeService';
import type { TourTargetLayout } from '../../contexts/TourTargetContext';

/** Coach mark IDs corresponding to each tour step */
const COACH_MARK_IDS = [
  'tour_deck',
  'tour_preferences',
  'tour_sessions',
  'tour_pairings',
  'tour_map',
  'tour_chats',
  'tour_saved',
  'tour_calendar',
  'tour_profile',
] as const;

interface TourStep {
  tab: string;
  targetId: string;
  tooltipText: string;
  onEnter?: (ctx: TourContext) => void;
}

interface TourContext {
  setCurrentPage: (page: string) => void;
  setShowPreferences: (show: boolean) => void;
  setLikesSubTab?: (tab: string) => void;
}

const TOUR_STEPS: TourStep[] = [
  {
    tab: 'home',
    targetId: 'tour-target-deck',
    tooltipText: 'This is your experience deck. Cards are personalised to your taste.',
    onEnter: (ctx) => ctx.setCurrentPage('home'),
  },
  {
    tab: 'home',
    targetId: 'tour-target-preferences',
    tooltipText: 'Refine what you see by adjusting your preferences anytime.',
    onEnter: (ctx) => ctx.setShowPreferences(true),
  },
  {
    tab: 'home',
    targetId: 'tour-target-sessions',
    tooltipText: 'Plan together! Invite friends, merge tastes, and discover as a group.',
    onEnter: (ctx) => ctx.setShowPreferences(false),
  },
  {
    tab: 'discover',
    targetId: 'tour-target-pairings',
    tooltipText: 'Your paired friends appear here — matched by shared taste.',
    onEnter: (ctx) => ctx.setCurrentPage('discover'),
  },
  {
    tab: 'discover',
    targetId: 'tour-target-map',
    tooltipText: 'Explore venues, find friends nearby, and meet new people — all on the map.',
  },
  {
    tab: 'connections',
    targetId: 'tour-target-chats',
    tooltipText: 'Your conversations and friends live here. Message anyone.',
    onEnter: (ctx) => ctx.setCurrentPage('connections'),
  },
  {
    tab: 'likes',
    targetId: 'tour-target-saved',
    tooltipText: 'Everything you save ends up here. Your personal collection.',
    onEnter: (ctx) => {
      ctx.setCurrentPage('likes');
      ctx.setLikesSubTab?.('saved');
    },
  },
  {
    tab: 'likes',
    targetId: 'tour-target-calendar',
    tooltipText: 'Your scheduled plans. Reschedule or add to your phone calendar.',
    onEnter: (ctx) => ctx.setLikesSubTab?.('calendar'),
  },
  {
    tab: 'profile',
    targetId: 'tour-target-profile',
    tooltipText: 'Your profile, taste highlights, and settings. Make it yours.',
    onEnter: (ctx) => ctx.setCurrentPage('profile'),
  },
];

interface TourOrchestratorProps {
  setCurrentPage: (page: string) => void;
  setShowPreferences: (show: boolean) => void;
  setLikesSubTab?: (tab: string) => void;
}

export function TourOrchestrator({
  setCurrentPage,
  setShowPreferences,
  setLikesSubTab,
}: TourOrchestratorProps) {
  const tourMode = useAppStore((s) => s.tourMode);
  const tourStep = useAppStore((s) => s.tourStep);
  const user = useAppStore((s) => s.user);
  const advanceTour = useAppStore((s) => s.advanceTour);
  const skipTour = useAppStore((s) => s.skipTour);
  const completeTour = useAppStore((s) => s.completeTour);
  const queryClient = useQueryClient();
  const { getTargetLayout } = useTourTargets();
  const [targetLayout, setTargetLayout] = useState<TourTargetLayout | null>(null);
  const hasSeedRef = useRef(false);

  const tourContext: TourContext = {
    setCurrentPage,
    setShowPreferences,
    setLikesSubTab,
  };

  // Seed mock data on mount (handles both fresh start and app kill recovery)
  useEffect(() => {
    if (!tourMode || !user?.id || hasSeedRef.current) return;
    hasSeedRef.current = true;
    realtimeService.unsubscribeAll();
    ensureTourDataSeeded(queryClient, user.id);
  }, [tourMode, user?.id, queryClient]);

  // On step change: switch tab + execute onEnter
  useEffect(() => {
    if (!tourMode) return;
    const step = TOUR_STEPS[tourStep];
    if (!step) return;
    step.onEnter?.(tourContext);

    // Delay target measurement to allow navigation + layout to complete
    const timer = setTimeout(() => {
      const layout = getTargetLayout(step.targetId);
      setTargetLayout(layout);
    }, 400);

    return () => clearTimeout(timer);
  }, [tourStep, tourMode]);

  // Re-poll target layout if still null (component might not have rendered yet)
  // Hard timeout after 5s — skip the step rather than freezing the app
  useEffect(() => {
    if (!tourMode || targetLayout) return;
    const step = TOUR_STEPS[tourStep];
    if (!step) return;

    let pollCount = 0;
    const MAX_POLLS = 25; // 25 × 200ms = 5 seconds

    const interval = setInterval(() => {
      pollCount++;
      const layout = getTargetLayout(step.targetId);
      if (layout) {
        setTargetLayout(layout);
        clearInterval(interval);
      } else if (pollCount >= MAX_POLLS) {
        // Target never appeared — skip this step to avoid freezing
        console.warn(`[Tour] Target "${step.targetId}" not found after 5s, skipping step ${tourStep}`);
        clearInterval(interval);
        if (tourStep >= TOUR_STEPS.length - 1) {
          skipTour();
        } else {
          setTargetLayout(null);
          advanceTour();
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [tourMode, tourStep, targetLayout, getTargetLayout]);

  // Handle "Next" / "Finish"
  const handleNext = useCallback(async () => {
    if (!user?.id) return;
    const currentMarkId = COACH_MARK_IDS[tourStep];

    // Record progress in DB (fire-and-forget)
    supabase
      .from('coach_mark_progress')
      .upsert(
        { user_id: user.id, coach_mark_id: currentMarkId },
        { onConflict: 'user_id,coach_mark_id' }
      )
      .then(() => {});

    if (tourStep >= TOUR_STEPS.length - 1) {
      // Last step — complete
      await handleComplete();
    } else {
      setTargetLayout(null); // Reset for next step measurement
      advanceTour();
    }
  }, [tourStep, user?.id, advanceTour]);

  // Handle "Skip Tour"
  const handleSkip = useCallback(async () => {
    if (!user?.id) return;

    // Record completed steps
    const completedMarks = COACH_MARK_IDS.slice(0, tourStep).map((markId) => ({
      user_id: user.id,
      coach_mark_id: markId,
    }));
    if (completedMarks.length > 0) {
      supabase
        .from('coach_mark_progress')
        .upsert(completedMarks, { onConflict: 'user_id,coach_mark_id' })
        .then(() => {});
    }

    // Update profile status
    supabase
      .from('profiles')
      .update({ coach_map_tour_status: 'skipped' })
      .eq('id', user.id)
      .then(() => {});

    clearTourData(queryClient);
    setShowPreferences(false);
    skipTour();
    setCurrentPage('home');
  }, [user?.id, tourStep, queryClient, skipTour, setCurrentPage, setShowPreferences]);

  // Handle tour completion
  const handleComplete = useCallback(async () => {
    if (!user?.id) return;

    // Record final step
    supabase
      .from('coach_mark_progress')
      .upsert(
        { user_id: user.id, coach_mark_id: 'tour_profile' },
        { onConflict: 'user_id,coach_mark_id' }
      )
      .then(() => {});

    // Update profile status
    supabase
      .from('profiles')
      .update({ coach_map_tour_status: 'completed' })
      .eq('id', user.id)
      .then(() => {});

    clearTourData(queryClient);
    setShowPreferences(false);
    completeTour();
    setCurrentPage('home');
  }, [user?.id, queryClient, completeTour, setCurrentPage, setShowPreferences]);

  // Safety cleanup on unmount
  useEffect(() => {
    return () => {
      if (hasSeedRef.current) {
        clearTourData(queryClient);
        hasSeedRef.current = false;
      }
    };
  }, [queryClient]);

  if (!tourMode) return null;

  const step = TOUR_STEPS[tourStep];
  if (!step) return null;

  return (
    <TourOverlay
      targetLayout={targetLayout}
      text={step.tooltipText}
      stepNumber={tourStep + 1}
      totalSteps={TOUR_STEPS.length}
      isLastStep={tourStep === TOUR_STEPS.length - 1}
      onNext={handleNext}
      onSkip={handleSkip}
    />
  );
}
