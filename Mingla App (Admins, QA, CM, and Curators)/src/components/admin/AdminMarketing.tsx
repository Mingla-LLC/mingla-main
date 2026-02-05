import React, { useState } from 'react';
import { 
  Megaphone, Users, Mail, Send, Download, Plus, Filter, Target,
  TrendingUp, Eye, MousePointerClick, UserPlus, Zap
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { toast } from 'sonner@2.0.3';
import AdminPageLayout from './AdminPageLayout';

export default function AdminMarketing({ userData }: any) {
  const [activeView, setActiveView] = useState<'campaigns' | 'segments' | 'contacts'>('segments');
  const [selectedSegment, setSelectedSegment] = useState<any>(null);
  const [showCreateSegment, setShowCreateSegment] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Segment Builder State
  const [segmentName, setSegmentName] = useState('');
  const [segmentFilters, setSegmentFilters] = useState({
    role: 'all',
    status: 'all',
    lastActive: 'all',
    hasPurchases: false,
    hasExperiences: false,
    location: ''
  });

  const segments = [
    { 
      id: 'active-explorers',
      name: 'Active Explorers',
      description: 'Explorers active in last 7 days',
      count: 1234,
      filters: { role: 'explorer', lastActive: '7d' }
    },
    {
      id: 'premium-curators',
      name: 'Premium Curators',
      description: 'Curators with 10+ live experiences',
      count: 45,
      filters: { role: 'curator', hasExperiences: true }
    },
    {
      id: 'high-value-users',
      name: 'High Value Users',
      description: 'Users with 5+ purchases',
      count: 289,
      filters: { hasPurchases: true }
    },
    {
      id: 'inactive-users',
      name: 'Inactive Users',
      description: 'No activity in 30 days',
      count: 567,
      filters: { lastActive: '30d' }
    }
  ];

  const handleCreateSegment = () => {
    if (!segmentName) {
      toast.error('Please enter a segment name');
      return;
    }

    // Calculate segment size based on filters
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    let filtered = users;

    if (segmentFilters.role !== 'all') {
      filtered = filtered.filter((u: any) => u.role === segmentFilters.role);
    }

    toast.success(`Segment "${segmentName}" created with ${filtered.length} users`);
    setShowCreateSegment(false);
    setSegmentName('');
  };

  const handleExportContacts = (segment: any) => {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const csvContent = users.map((u: any) => `${u.name},${u.email},${u.role}`).join('\n');
    const blob = new Blob([`Name,Email,Role\n${csvContent}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${segment.name.replace(/\s+/g, '-').toLowerCase()}-contacts.csv`;
    a.click();
    toast.success('Contacts exported successfully');
  };

  const kpiCards = [
    { label: 'Total Contacts', value: '2,847', icon: Users, color: 'text-blue-600' },
    { label: 'Active Segments', value: '12', icon: Target, color: 'text-purple-600' },
    { label: 'Email Open Rate', value: '42.3%', icon: Eye, color: 'text-green-600' },
    { label: 'Click Rate', value: '18.5%', icon: MousePointerClick, color: 'text-orange-600' }
  ];

  return (
    <AdminPageLayout
      title="Marketing"
      description="Audience segmentation and campaign management"
      actions={
        <Button 
          onClick={() => setShowCreateSegment(true)}
          className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Segment
        </Button>
      }
    >
      <div className="space-y-6">
        {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi, index) => (
          <Card key={index} className="p-6 border border-gray-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-[#6B7280] text-sm">{kpi.label}</p>
                <p className="text-[#111827] text-2xl mt-2">{kpi.value}</p>
              </div>
              <div className="p-3 rounded-xl bg-gray-50">
                <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* View Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setActiveView('segments')}
          className={`px-4 py-2 border-b-2 transition-colors ${
            activeView === 'segments'
              ? 'border-[#eb7825] text-[#eb7825]'
              : 'border-transparent text-[#6B7280] hover:text-[#111827]'
          }`}
        >
          <Target className="w-4 h-4 inline mr-2" />
          Segments
        </button>
        <button
          onClick={() => setActiveView('campaigns')}
          className={`px-4 py-2 border-b-2 transition-colors ${
            activeView === 'campaigns'
              ? 'border-[#eb7825] text-[#eb7825]'
              : 'border-transparent text-[#6B7280] hover:text-[#111827]'
          }`}
        >
          <Megaphone className="w-4 h-4 inline mr-2" />
          Campaigns
        </button>
        <button
          onClick={() => setActiveView('contacts')}
          className={`px-4 py-2 border-b-2 transition-colors ${
            activeView === 'contacts'
              ? 'border-[#eb7825] text-[#eb7825]'
              : 'border-transparent text-[#6B7280] hover:text-[#111827]'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" />
          Contacts
        </button>
      </div>

      {/* Segments View */}
      {activeView === 'segments' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {segments.map((segment) => (
            <Card key={segment.id} className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-[#111827]">{segment.name}</h3>
                  <p className="text-[#6B7280] text-sm mt-1">{segment.description}</p>
                </div>
                <Badge variant="outline" className="bg-[#eb7825]/10 text-[#eb7825] border-[#eb7825]/20">
                  {segment.count.toLocaleString()}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => handleExportContacts(segment)}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <Button 
                  variant="outline"
                  className="flex-1"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Campaign
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Campaigns View */}
      {activeView === 'campaigns' && (
        <Card className="p-12 border border-gray-200 text-center">
          <Megaphone className="w-12 h-12 text-[#6B7280] mx-auto mb-4" />
          <h3 className="text-[#111827] mb-2">Campaign Manager</h3>
          <p className="text-[#6B7280] mb-4">
            Create and manage marketing campaigns
          </p>
          <Button className="bg-[#eb7825] hover:bg-[#d6691f] text-white">
            <Plus className="w-4 h-4 mr-2" />
            Create Campaign
          </Button>
        </Card>
      )}

      {/* Contacts View */}
      {activeView === 'contacts' && (
        <Card className="p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">All Contacts</h2>
            <Button 
              variant="outline"
              onClick={() => {
                const users = JSON.parse(localStorage.getItem('users') || '[]');
                const csv = users.map((u: any) => `${u.name},${u.email},${u.role}`).join('\n');
                const blob = new Blob([`Name,Email,Role\n${csv}`], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'all-contacts.csv';
                a.click();
                toast.success('All contacts exported');
              }}
            >
              <Download className="w-4 h-4 mr-2" />
              Export All
            </Button>
          </div>
          <p className="text-[#6B7280]">
            Total contacts: {JSON.parse(localStorage.getItem('users') || '[]').length}
          </p>
        </Card>
      )}

      {/* Integration Section */}
      <Card className="p-6 border border-gray-200">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-purple-50">
            <Zap className="w-6 h-6 text-purple-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-[#111827]">Platform Integrations</h3>
            <p className="text-[#6B7280] text-sm mt-1">
              Connect with Customer.io, Mailchimp, or other marketing platforms via webhook or API
            </p>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" size="sm">
                Setup Webhook
              </Button>
              <Button variant="outline" size="sm">
                API Documentation
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* Create Segment Modal */}
      {showCreateSegment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[#111827] mb-4">Create New Segment</h2>
            <div className="space-y-4">
              <div>
                <Label>Segment Name</Label>
                <Input
                  value={segmentName}
                  onChange={(e) => setSegmentName(e.target.value)}
                  placeholder="e.g., Active San Francisco Explorers"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>User Role</Label>
                  <Select 
                    value={segmentFilters.role} 
                    onValueChange={(v) => setSegmentFilters({ ...segmentFilters, role: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Roles</SelectItem>
                      <SelectItem value="explorer">Explorer</SelectItem>
                      <SelectItem value="curator">Curator</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Last Active</Label>
                  <Select 
                    value={segmentFilters.lastActive} 
                    onValueChange={(v) => setSegmentFilters({ ...segmentFilters, lastActive: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any Time</SelectItem>
                      <SelectItem value="24h">Last 24 Hours</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox 
                    checked={segmentFilters.hasPurchases}
                    onCheckedChange={(checked) => 
                      setSegmentFilters({ ...segmentFilters, hasPurchases: !!checked })
                    }
                  />
                  <Label>Has made purchases</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox 
                    checked={segmentFilters.hasExperiences}
                    onCheckedChange={(checked) => 
                      setSegmentFilters({ ...segmentFilters, hasExperiences: !!checked })
                    }
                  />
                  <Label>Has created experiences</Label>
                </div>
              </div>
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCreateSegment(false);
                  setSegmentName('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateSegment}
                className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
              >
                Create Segment
              </Button>
            </div>
          </Card>
        </div>
      )}
      </div>
    </AdminPageLayout>
  );
}
