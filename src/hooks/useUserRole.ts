import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

type UserRole = 'admin' | 'content_manager' | 'user' | null;

export const useUserRole = () => {
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUserRole();
  }, []);

  const checkUserRole = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setRole(null);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error checking user role:', error);
      setRole('user'); // Default to user role
    } else {
      setRole(data?.role || 'user');
    }

    setLoading(false);
  };

  const isAdmin = role === 'admin';
  const isContentManager = role === 'content_manager' || role === 'admin';

  return {
    role,
    loading,
    isAdmin,
    isContentManager,
    checkUserRole
  };
};