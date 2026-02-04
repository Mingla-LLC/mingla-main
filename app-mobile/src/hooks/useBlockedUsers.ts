/**
 * useBlockedUsers Hook
 * 
 * React hook for managing blocked users state and actions.
 */

import { useState, useEffect, useCallback } from "react";
import { blockService, BlockedUser, BlockReason } from "../services/blockService";
import { useAuth } from "../contexts/AuthContext";

interface UseBlockedUsersReturn {
  blockedUsers: BlockedUser[];
  loading: boolean;
  error: string | null;
  blockUser: (userId: string, reason?: BlockReason) => Promise<boolean>;
  unblockUser: (userId: string) => Promise<boolean>;
  isUserBlocked: (userId: string) => boolean;
  checkIsBlocked: (userId: string) => Promise<boolean>;
  checkHasBlockBetween: (userId: string) => Promise<boolean>;
  refreshBlockedUsers: () => Promise<void>;
}

export function useBlockedUsers(): UseBlockedUsersReturn {
  const { user } = useAuth();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch blocked users on mount and when user changes
  const fetchBlockedUsers = useCallback(async () => {
    if (!user) {
      setBlockedUsers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await blockService.getBlockedUsers();
    
    if (result.error) {
      setError(result.error);
    } else {
      setBlockedUsers(result.data);
    }
    
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  // Block a user
  const blockUser = useCallback(async (userId: string, reason?: BlockReason): Promise<boolean> => {
    const result = await blockService.blockUser(userId, reason);
    
    if (result.success) {
      // Refresh the blocked users list
      await fetchBlockedUsers();
      return true;
    }
    
    setError(result.error || "Failed to block user");
    return false;
  }, [fetchBlockedUsers]);

  // Unblock a user
  const unblockUser = useCallback(async (userId: string): Promise<boolean> => {
    const result = await blockService.unblockUser(userId);
    
    if (result.success) {
      // Remove from local state immediately for responsive UI
      setBlockedUsers(prev => prev.filter(b => b.blocked_id !== userId));
      return true;
    }
    
    setError(result.error || "Failed to unblock user");
    return false;
  }, []);

  // Check if user is blocked (from local state - synchronous)
  const isUserBlocked = useCallback((userId: string): boolean => {
    return blockedUsers.some(b => b.blocked_id === userId);
  }, [blockedUsers]);

  // Check if user is blocked (from server - async)
  const checkIsBlocked = useCallback(async (userId: string): Promise<boolean> => {
    return blockService.isUserBlocked(userId);
  }, []);

  // Check if there's any block between users
  const checkHasBlockBetween = useCallback(async (userId: string): Promise<boolean> => {
    return blockService.hasBlockBetween(userId);
  }, []);

  return {
    blockedUsers,
    loading,
    error,
    blockUser,
    unblockUser,
    isUserBlocked,
    checkIsBlocked,
    checkHasBlockBetween,
    refreshBlockedUsers: fetchBlockedUsers,
  };
}

export default useBlockedUsers;
