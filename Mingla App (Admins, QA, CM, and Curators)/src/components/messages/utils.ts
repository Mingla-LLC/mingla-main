// Messages Page Utility Functions

import { Collaboration } from './types';

export const formatTime = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const getInitials = (name: string): string => {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

export const filterCollaborations = (
  collaborations: Collaboration[],
  searchQuery: string,
  currentUserType: 'curator' | 'business'
): Collaboration[] => {
  const searchLower = searchQuery.toLowerCase();
  return collaborations.filter(collab => {
    return (
      collab.experienceName.toLowerCase().includes(searchLower) ||
      (currentUserType === 'curator' 
        ? collab.businessName.toLowerCase().includes(searchLower)
        : collab.curatorName.toLowerCase().includes(searchLower)
      )
    );
  });
};

export const getOtherPartyName = (
  collaboration: Collaboration | null,
  currentUserType: 'curator' | 'business'
): string => {
  if (!collaboration) return '';
  return currentUserType === 'curator' 
    ? collaboration.businessName 
    : collaboration.curatorName;
};

export const loadCollaborationsFromStorage = (
  currentUserId: string,
  currentUserType: 'curator' | 'business'
): Collaboration[] => {
  const allCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');
  const experienceCards = JSON.parse(localStorage.getItem('experienceCards') || '[]');
  
  // Filter collaborations for current user
  const userCollaborations = allCollaborations.filter((collab: Collaboration) => {
    if (currentUserType === 'curator') {
      return collab.curatorId === currentUserId;
    } else {
      return collab.businessId === currentUserId;
    }
  });

  // Enrich collaborations with experience details
  const enrichedCollaborations = userCollaborations.map((collab: Collaboration) => {
    const experienceCard = experienceCards.find((card: any) => card.id === collab.experienceId);
    
    if (experienceCard) {
      return {
        ...collab,
        commission: experienceCard.commission || collab.commission || 12,
        experiencePrice: experienceCard.price,
        experienceLocation: experienceCard.location,
        experienceCategory: experienceCard.category,
        experienceDuration: experienceCard.duration,
      };
    }
    
    return collab;
  });

  return enrichedCollaborations;
};

export const loadSharedExperiences = (collaboration: Collaboration | null): any[] => {
  if (!collaboration) return [];

  const experienceCards = JSON.parse(localStorage.getItem('experienceCards') || '[]');
  const allCollaborations = JSON.parse(localStorage.getItem('collaborations') || '[]');

  const curatorId = collaboration.curatorId;
  const businessId = collaboration.businessId;

  // Get all experiences created by this curator for this business
  const shared = experienceCards.filter((card: any) => {
    return (card.businessId === businessId || card.createdBy === businessId) && 
           (card.createdBy === curatorId || card.curatorId === curatorId);
  });

  // Also get experiences from active collaborations between these two parties
  const collaborationExperienceIds = allCollaborations
    .filter((collab: any) => 
      collab.curatorId === curatorId && collab.businessId === businessId
    )
    .map((collab: any) => collab.experienceId);

  const collabExperiences = experienceCards.filter((card: any) => 
    collaborationExperienceIds.includes(card.id)
  );

  // Combine and deduplicate
  const allShared = [...shared, ...collabExperiences];
  const uniqueExperiences = Array.from(
    new Map(allShared.map(exp => [exp.id, exp])).values()
  );

  return uniqueExperiences;
};
