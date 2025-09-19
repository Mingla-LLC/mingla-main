import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Shield, Users, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface UserRole {
  id: string;
  user_id: string;
  role: 'admin' | 'content_manager' | 'user';
  created_at: string;
  profiles?: {
    username: string;
    first_name?: string;
    last_name?: string;
  };
}

interface Profile {
  id: string;
  username: string;
  first_name?: string;
  last_name?: string;
}

export const AdminPanel: React.FC = () => {
  const [userRoles, setUserRoles] = useState<UserRole[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<'admin' | 'content_manager' | 'user'>('user');
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAdminStatus();
    fetchUserRoles();
    fetchProfiles();
  }, []);

  const checkAdminStatus = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!error && data) {
      setIsAdmin(true);
    }
    setLoading(false);
  };

  const fetchUserRoles = async () => {
    const { data, error } = await supabase
      .from('user_roles')
      .select(`
        id,
        user_id,
        role,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (error) {
      toast({
        title: "Error fetching user roles",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    // Fetch profile data separately and merge
    if (data && data.length > 0) {
      const userIds = data.map(role => role.user_id);
      const { data: profilesData } = await supabase
        .from('profiles')
        .select('id, username, first_name, last_name')
        .in('id', userIds);

      const enrichedRoles = data.map(role => ({
        ...role,
        profiles: profilesData?.find(profile => profile.id === role.user_id)
      }));

      setUserRoles(enrichedRoles);
    } else {
      setUserRoles([]);
    }
  };

  const fetchProfiles = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, first_name, last_name')
      .order('username');

    if (error) {
      toast({
        title: "Error fetching profiles",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    setProfiles(data || []);
  };

  const assignRole = async () => {
    if (!selectedUserId || !selectedRole) {
      toast({
        title: "Missing information",
        description: "Please select both a user and a role",
        variant: "destructive"
      });
      return;
    }

    const { error } = await supabase
      .from('user_roles')
      .insert({
        user_id: selectedUserId,
        role: selectedRole
      });

    if (error) {
      toast({
        title: "Error assigning role",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Role assigned successfully",
      description: `User now has ${selectedRole} role`
    });

    setSelectedUserId('');
    setSelectedRole('user');
    fetchUserRoles();
  };

  const removeRole = async (roleId: string) => {
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('id', roleId);

    if (error) {
      toast({
        title: "Error removing role",
        description: error.message,
        variant: "destructive"
      });
      return;
    }

    toast({
      title: "Role removed successfully"
    });

    fetchUserRoles();
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin':
        return 'destructive';
      case 'content_manager':
        return 'default';
      default:
        return 'secondary';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <Shield className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p>Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <Card className="max-w-md mx-auto">
        <CardContent className="flex flex-col items-center p-8">
          <Shield className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground text-center">
            You need admin privileges to access this panel.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Admin Panel - Role Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Select User</label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose user..." />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.username}
                      {profile.first_name && ` (${profile.first_name})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Assign Role</label>
              <Select value={selectedRole} onValueChange={(value: 'admin' | 'content_manager' | 'user') => setSelectedRole(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User (Read Only)</SelectItem>
                  <SelectItem value="content_manager">Content Manager</SelectItem>
                  <SelectItem value="admin">Admin (Full Access)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button onClick={assignRole} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Assign Role
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Current User Roles
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {userRoles.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No user roles assigned yet.
              </p>
            ) : (
              userRoles.map((userRole) => (
                <div
                  key={userRole.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium">
                        {userRole.profiles?.username || 'Unknown User'}
                      </p>
                      {userRole.profiles?.first_name && (
                        <p className="text-sm text-muted-foreground">
                          {userRole.profiles.first_name} {userRole.profiles.last_name}
                        </p>
                      )}
                    </div>
                    <Badge variant={getRoleBadgeVariant(userRole.role)}>
                      {userRole.role.replace('_', ' ').toUpperCase()}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRole(userRole.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};