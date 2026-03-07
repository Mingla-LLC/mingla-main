import React from 'react';
import { View } from 'react-native';

export type CoachMarkGroup =
  | 'explore' | 'discover' | 'chats' | 'likes'
  | 'profile' | 'board' | 'action';

export type SpotlightShape = 'circle' | 'rounded-rect';

export type TooltipPosition = 'above' | 'below' | 'center';

export type GestureType =
  | 'swipe-right' | 'swipe-left' | 'tap' | 'long-press'
  | 'pull-down' | 'swipe-card-left';

export type FeatureIconType =
  | 'heart' | 'calendar' | 'compass' | 'chat' | 'profile'
  | 'bell' | 'qr' | 'gift' | 'link' | 'vote' | 'mention'
  | 'pin' | 'share' | 'board' | 'settings' | 'people' | 'filter';

export type WelcomeScene =
  | 'explore' | 'discover' | 'chats' | 'likes' | 'profile' | 'board';

export type MilestoneType =
  | 'explorer' | 'discoverer' | 'connector'
  | 'planner' | 'pro' | 'team-player' | 'master';

export type IllustrationConfig =
  | { type: 'gesture'; gesture: GestureType }
  | { type: 'feature'; icon: FeatureIconType }
  | { type: 'welcome'; scene: WelcomeScene }
  | { type: 'none' };

export interface CoachMarkTrigger {
  type: 'tab_first_visit' | 'action' | 'element_first_visible';
  /** For tab_first_visit: the currentPage value. For action: the action name. */
  value: string;
}

export interface CoachMarkDefinition {
  id: string;
  group: CoachMarkGroup;
  priority: number;
  prerequisites: string[];
  trigger: CoachMarkTrigger;
  targetElementId: string;
  spotlight: {
    shape: SpotlightShape;
    padding: number;
    borderRadius?: number;
  };
  tooltip: {
    position: TooltipPosition;
    offsetY?: number;
  };
  content: {
    title: string;
    body: string;
    illustration: IllustrationConfig;
  };
  delay: number;
}

export interface TargetLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TargetRegistration {
  layout: TargetLayout;
  ref: React.RefObject<View>;
}

export interface MilestoneDefinition {
  id: MilestoneType;
  group: CoachMarkGroup | 'all';
  title: string;
  body: string;
  requiredIds: string[];
}

export type TutorialPage =
  | 'home' | 'discover' | 'connections' | 'likes'
  | 'profile' | 'board-view';

export interface TutorialStep {
  markId: string;
  page: TutorialPage;
}
