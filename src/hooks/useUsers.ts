import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface PublicUser {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  avatar_url?: string;
}

export const useUsers = () => {
  const [loading, setLoading] = useState(false);

  // Check if username is available
  const checkUsernameAvailability = useCallback(async (username: string): Promise<boolean> => {
    if (!username.trim()) return false;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', username.trim())
        .maybeSingle();

      if (error) {
        console.error('Error checking username availability:', error);
        return false;
      }

      return !data; // Available if no user found
    } catch (error) {
      console.error('Error checking username availability:', error);
      return false;
    }
  }, []);

  // Search users by username, name, or email
  const searchUsers = useCallback(async (query: string): Promise<PublicUser[]> => {
    if (!query.trim()) return [];

    setLoading(true);
    try {
      // Search by username, first_name, last_name, or email (from auth.users via id lookup)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, first_name, last_name, avatar_url')
        .or(`username.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
        .limit(10);

      if (error) {
        console.error('Error searching users:', error);
        toast({
          title: "Search Error",
          description: "Failed to search users. Please try again.",
          variant: "destructive"
        });
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error searching users:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Get all users except current user (for friends lists)
  const getAllUsers = useCallback(async (excludeCurrentUser: boolean = true): Promise<PublicUser[]> => {
    setLoading(true);
    try {
      let query = supabase
        .from('profiles')
        .select('id, username, first_name, last_name, avatar_url');

      if (excludeCurrentUser) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          query = query.neq('id', user.id);
        }
      }

      const { data, error } = await query.limit(50);

      if (error) {
        console.error('Error fetching users:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching users:', error);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Get user by username
  const getUserByUsername = useCallback(async (username: string): Promise<PublicUser | null> => {
    if (!username.trim()) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, first_name, last_name, avatar_url')
        .eq('username', username.trim())
        .maybeSingle();

      if (error) {
        console.error('Error fetching user by username:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error fetching user by username:', error);
      return null;
    }
  }, []);

  // Format user display name
  const getDisplayName = useCallback((user: PublicUser): string => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`;
    } else if (user.first_name) {
      return user.first_name;
    } else if (user.last_name) {
      return user.last_name;
    }
    return user.username;
  }, []);

  // Get user initials
  const getUserInitials = useCallback((user: PublicUser): string => {
    const displayName = getDisplayName(user);
    return displayName
      .split(' ')
      .map(name => name[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [getDisplayName]);

  return {
    loading,
    checkUsernameAvailability,
    searchUsers,
    getAllUsers,
    getUserByUsername,
    getDisplayName,
    getUserInitials
  };
};