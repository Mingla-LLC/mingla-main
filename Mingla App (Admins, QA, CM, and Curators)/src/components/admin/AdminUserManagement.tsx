import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, Search, Plus, Edit2, Trash2, UserCheck, Ban, 
  Shield, Building2, Sparkles, Eye, Mail, Calendar, Filter
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner@2.0.3';
import { createInvitation, sendInvitationEmail, resendInvitation } from '../utils/invitationSystem';
import AdminPageLayout from './AdminPageLayout';

interface AdminUserManagementProps {
  userData?: any;
  triggerAddUser?: boolean;
}

export default function AdminUserManagement({ userData, triggerAddUser }: AdminUserManagementProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [showEditUserModal, setShowEditUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  
  const [newUser, setNewUser] = useState({
    name: '',
    email: '',
    role: 'explorer',
    status: 'active',
    welcomeMessage: ''
  });

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    if (triggerAddUser) {
      setShowAddUserModal(true);
    }
  }, [triggerAddUser]);

  const loadUsers = () => {
    const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
    setUsers(allUsers);
  };

  const filteredUsers = useMemo(() => {
    let filtered = users;

    if (searchQuery) {
      filtered = filtered.filter(user =>
        user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => user.role === roleFilter);
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter(user => user.status === statusFilter);
    }

    return filtered;
  }, [users, searchQuery, roleFilter, statusFilter]);

  const handleAddUser = () => {
    if (!newUser.name || !newUser.email) {
      toast.error('Please fill in all fields');
      return;
    }

    // Check if email already exists
    const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
    if (allUsers.some((u: any) => u.email === newUser.email)) {
      toast.error('A user with this email already exists');
      return;
    }

    const user = {
      id: `user-${Date.now()}`,
      username: newUser.email.split('@')[0],
      name: newUser.name,
      email: newUser.email,
      role: newUser.role,
      status: 'pending', // User is pending until they set their password
      createdAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
      invitationSent: true
    };

    allUsers.push(user);
    localStorage.setItem('users', JSON.stringify(allUsers));

    // Create invitation and send email
    const invitation = createInvitation(user.id, user.email, newUser.welcomeMessage);
    sendInvitationEmail(invitation, user.name);

    loadUsers();
    setShowAddUserModal(false);
    setNewUser({ name: '', email: '', role: 'explorer', status: 'active', welcomeMessage: '' });
    
    toast.success(
      <div className="flex flex-col gap-1">
        <p className="font-medium">User added successfully!</p>
        <p className="text-sm text-gray-600">Invitation email sent to {user.email}</p>
      </div>
    );
  };

  const handleEditUser = () => {
    const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const updated = allUsers.map((u: any) =>
      u.id === selectedUser.id ? selectedUser : u
    );
    localStorage.setItem('users', JSON.stringify(updated));
    loadUsers();
    setShowEditUserModal(false);
    setSelectedUser(null);
    toast.success('User updated successfully');
  };

  const handleDeleteUser = (userId: string) => {
    if (confirm('Are you sure you want to delete this user?')) {
      const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
      const updated = allUsers.filter((u: any) => u.id !== userId);
      localStorage.setItem('users', JSON.stringify(updated));
      loadUsers();
      toast.success('User deleted successfully');
    }
  };

  const handleToggleStatus = (user: any) => {
    const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    const updated = allUsers.map((u: any) =>
      u.id === user.id ? { ...u, status: newStatus } : u
    );
    localStorage.setItem('users', JSON.stringify(updated));
    loadUsers();
    toast.success(`User ${newStatus === 'active' ? 'activated' : 'suspended'}`);
  };

  const handleResendInvitation = (user: any) => {
    const success = resendInvitation(user.id, user.name);
    
    if (success) {
      toast.success(
        <div className="flex flex-col gap-1">
          <p className="font-medium">Invitation resent!</p>
          <p className="text-sm text-gray-600">New email sent to {user.email}</p>
        </div>
      );
    } else {
      toast.error('Failed to resend invitation');
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'curator': return Sparkles;
      case 'business': return Building2;
      case 'qa': return Shield;
      case 'admin': return Shield;
      default: return Users;
    }
  };

  const getRoleBadge = (role: string) => {
    const config: any = {
      explorer: { label: 'Explorer', className: 'bg-blue-100 text-blue-700' },
      curator: { label: 'Curator', className: 'bg-purple-100 text-purple-700' },
      business: { label: 'Business', className: 'bg-green-100 text-green-700' },
      qa: { label: 'QA Manager', className: 'bg-orange-100 text-orange-700' },
      admin: { label: 'Admin', className: 'bg-red-100 text-red-700' }
    };
    return config[role] || config.explorer;
  };

  const stats = [
    { label: 'Total Users', value: users.length, color: 'text-blue-600' },
    { label: 'Explorers', value: users.filter(u => u.role === 'explorer').length, color: 'text-green-600' },
    { label: 'Curators', value: users.filter(u => u.role === 'curator').length, color: 'text-purple-600' },
    { label: 'Businesses', value: users.filter(u => u.role === 'business').length, color: 'text-orange-600' }
  ];

  return (
    <AdminPageLayout
      title="User Management"
      description="Manage all users, roles, and permissions"
      actions={
        <Button 
          onClick={() => setShowAddUserModal(true)}
          className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {stats.map((stat, index) => (
          <Card key={index} className="p-4 border border-gray-200">
            <p className="text-[#6B7280] text-sm">{stat.label}</p>
            <p className={`text-2xl mt-1 ${stat.color}`}>{stat.value}</p>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-4 border border-gray-200">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="explorer">Explorer</SelectItem>
              <SelectItem value="curator">Curator</SelectItem>
              <SelectItem value="business">Business</SelectItem>
              <SelectItem value="qa">QA Manager</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Users Table */}
      <Card className="border border-gray-200">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">
                  Role
                </th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase tracking-wider">
                  Joined
                </th>
                <th className="px-6 py-3 text-right text-xs text-[#6B7280] uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <AnimatePresence>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-[#6B7280]">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const RoleIcon = getRoleIcon(user.role);
                    const roleBadge = getRoleBadge(user.role);
                    
                    return (
                      <motion.tr
                        key={user.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="hover:bg-gray-50"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center text-white">
                              {user.name?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <p className="text-[#111827]">{user.name}</p>
                              <p className="text-[#6B7280] text-sm">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <Badge className={roleBadge.className}>
                            <RoleIcon className="w-3 h-3 mr-1" />
                            {roleBadge.label}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Badge 
                              variant={user.status === 'active' ? 'default' : user.status === 'pending' ? 'outline' : 'destructive'}
                              className={
                                user.status === 'active' ? 'bg-green-500' : 
                                user.status === 'pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-300' : 
                                ''
                              }
                            >
                              {user.status || 'active'}
                            </Badge>
                            {user.status === 'pending' && user.invitationSent && (
                              <Mail className="w-3 h-3 text-yellow-600" title="Invitation sent" />
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[#6B7280] text-sm">
                          {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            {user.status === 'pending' && user.invitationSent && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleResendInvitation(user)}
                                title="Resend invitation email"
                              >
                                <Mail className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedUser(user);
                                setShowEditUserModal(true);
                              }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            {user.status !== 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleToggleStatus(user)}
                              >
                                {user.status === 'active' ? (
                                  <Ban className="w-4 h-4" />
                                ) : (
                                  <UserCheck className="w-4 h-4" />
                                )}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeleteUser(user.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-lg"
          >
            <Card className="p-8 max-h-[90vh] overflow-y-auto">
              <div className="mb-6">
                <h2 className="text-[#111827]">Add New User</h2>
                <p className="text-[#6B7280] text-sm mt-1">
                  Create a new user account and send an invitation email
                </p>
              </div>
            <div className="space-y-6">
              {/* Name Field */}
              <div className="space-y-2">
                <Label htmlFor="user-name" className="text-[#111827]">
                  Full Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="user-name"
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  placeholder="Enter full name"
                  className="h-11"
                />
              </div>

              {/* Email Field */}
              <div className="space-y-2">
                <Label htmlFor="user-email" className="text-[#111827]">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="user-email"
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="user@example.com"
                  className="h-11"
                />
                <p className="text-xs text-[#6B7280] mt-1">
                  User will receive an invitation email to set their password
                </p>
              </div>

              {/* Role Field */}
              <div className="space-y-2">
                <Label htmlFor="user-role" className="text-[#111827]">
                  User Role <span className="text-red-500">*</span>
                </Label>
                <Select value={newUser.role} onValueChange={(value) => setNewUser({ ...newUser, role: value })}>
                  <SelectTrigger id="user-role" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="explorer">
                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        <span>Explorer</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="curator">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        <span>Curator</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="business">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4" />
                        <span>Business</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="qa">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        <span>QA Manager</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="admin">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-red-600" />
                        <span>Admin</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Welcome Message Field */}
              <div className="space-y-2">
                <Label htmlFor="welcome-message" className="text-[#111827]">
                  Welcome Message <span className="text-[#6B7280] text-xs">(Optional)</span>
                </Label>
                <Textarea
                  id="welcome-message"
                  value={newUser.welcomeMessage}
                  onChange={(e) => setNewUser({ ...newUser, welcomeMessage: e.target.value })}
                  placeholder="Add a personalized welcome message for the new user..."
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-[#6B7280]">
                  This message will be included in the invitation email
                </p>
              </div>

              {/* Info Banner */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
                <Mail className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm text-[#111827]">Email Invitation</p>
                  <p className="text-xs text-[#6B7280]">
                    An invitation email will be sent to the user with a secure link to set their password. 
                    The link will expire in 7 days.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-8 pt-6 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddUserModal(false);
                  setNewUser({ name: '', email: '', role: 'explorer', status: 'active', welcomeMessage: '' });
                }}
                className="min-w-[100px]"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddUser}
                className="bg-[#eb7825] hover:bg-[#d6691f] text-white min-w-[140px]"
              >
                <Mail className="w-4 h-4 mr-2" />
                Send Invitation
              </Button>
            </div>
            </Card>
          </motion.div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditUserModal && selectedUser && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md p-6">
            <h2 className="text-[#111827] mb-4">Edit User</h2>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={selectedUser.name}
                  onChange={(e) => setSelectedUser({ ...selectedUser, name: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={selectedUser.email}
                  onChange={(e) => setSelectedUser({ ...selectedUser, email: e.target.value })}
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select 
                  value={selectedUser.role} 
                  onValueChange={(value) => setSelectedUser({ ...selectedUser, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="explorer">Explorer</SelectItem>
                    <SelectItem value="curator">Curator</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="qa">QA Manager</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowEditUserModal(false);
                  setSelectedUser(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleEditUser}
                className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
              >
                Save Changes
              </Button>
            </div>
          </Card>
        </div>
      )}
      </div>
    </AdminPageLayout>
  );
}
