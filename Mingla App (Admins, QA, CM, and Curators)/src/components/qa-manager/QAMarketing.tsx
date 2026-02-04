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
import { toast } from 'sonner@2.0.3';
import QAPageLayout from './QAPageLayout';

export default function QAMarketing({ userData }: any) {
  const [activeView, setActiveView] = useState<'segments' | 'insights'>('segments');
  const [selectedSegment, setSelectedSegment] = useState<any>(null);

  const segments = [
    { 
      id: 'active-explorers',
      name: 'Active Explorers',
      description: 'Explorers active in last 7 days',
      count: 1234,
      engagement: '78%'
    },
    {
      id: 'premium-curators',
      name: 'Premium Curators',
      description: 'Curators with 10+ live experiences',
      count: 45,
      engagement: '92%'
    },
    {
      id: 'high-value-users',
      name: 'High Value Users',
      description: 'Users with 5+ purchases',
      count: 289,
      engagement: '85%'
    },
    {
      id: 'inactive-users',
      name: 'Inactive Users',
      description: 'No activity in 30 days',
      count: 567,
      engagement: '12%'
    }
  ];

  const handleExportSegment = (segment: any) => {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const csvContent = users.map((u: any) => `${u.name},${u.email},${u.role}`).join('\n');
    const blob = new Blob([`Name,Email,Role\n${csvContent}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${segment.name.replace(/\s+/g, '-').toLowerCase()}-contacts.csv`;
    a.click();
    toast.success(`${segment.name} contacts exported`);
  };

  const kpiCards = [
    { label: 'Total Users', value: '2,847', icon: Users, color: 'text-blue-600', bgColor: 'bg-blue-50' },
    { label: 'Active Segments', value: '12', icon: Target, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { label: 'Avg Engagement', value: '66.8%', icon: Eye, color: 'text-green-600', bgColor: 'bg-green-50' },
    { label: 'New Users (7d)', value: '142', icon: UserPlus, color: 'text-orange-600', bgColor: 'bg-orange-50' }
  ];

  return (
    <QAPageLayout
      title="Marketing Insights"
      description="View user segments and engagement metrics"
    >
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map((kpi) => (
            <Card key={kpi.label} className="p-6 border border-gray-200">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[#6B7280] text-sm">{kpi.label}</p>
                  <p className="text-[#111827] text-2xl mt-2">{kpi.value}</p>
                </div>
                <div className={`p-3 rounded-xl ${kpi.bgColor}`}>
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
            User Segments
          </button>
          <button
            onClick={() => setActiveView('insights')}
            className={`px-4 py-2 border-b-2 transition-colors ${
              activeView === 'insights'
                ? 'border-[#eb7825] text-[#eb7825]'
                : 'border-transparent text-[#6B7280] hover:text-[#111827]'
            }`}
          >
            Engagement Insights
          </button>
        </div>

        {/* User Segments View */}
        {activeView === 'segments' && (
          <div className="space-y-4">
            <Card className="p-6 border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-[#111827]">User Segments</h2>
                  <p className="text-[#6B7280] text-sm">Pre-defined user groups for analysis</p>
                </div>
              </div>

              <div className="space-y-4">
                {segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="p-4 border border-gray-200 rounded-xl hover:border-[#eb7825] hover:shadow-md transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-[#111827]">{segment.name}</h3>
                          <Badge variant="outline" className="bg-[#eb7825]/10 text-[#eb7825]">
                            {segment.count.toLocaleString()} users
                          </Badge>
                        </div>
                        <p className="text-[#6B7280] text-sm">{segment.description}</p>
                        <div className="flex items-center gap-4 mt-3">
                          <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-[#6B7280]">
                              {segment.engagement} engagement
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => handleExportSegment(segment)}
                          size="sm"
                          variant="outline"
                        >
                          <Download className="w-4 h-4 mr-2" />
                          Export
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Engagement Insights View */}
        {activeView === 'insights' && (
          <div className="space-y-4">
            <Card className="p-6 border border-gray-200">
              <h2 className="text-[#111827] mb-6">Platform Engagement Metrics</h2>
              
              <div className="space-y-6">
                {/* User Activity */}
                <div>
                  <h3 className="text-[#111827] mb-3">User Activity (Last 30 Days)</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl">
                      <p className="text-blue-900 text-sm">Daily Active Users</p>
                      <p className="text-blue-900 text-2xl mt-1">1,247</p>
                      <p className="text-blue-700 text-xs mt-1">↑ 12% from last period</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl">
                      <p className="text-purple-900 text-sm">Experiences Viewed</p>
                      <p className="text-purple-900 text-2xl mt-1">18,453</p>
                      <p className="text-purple-700 text-xs mt-1">↑ 8% from last period</p>
                    </div>
                    <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-xl">
                      <p className="text-green-900 text-sm">Purchases Made</p>
                      <p className="text-green-900 text-2xl mt-1">342</p>
                      <p className="text-green-700 text-xs mt-1">↑ 23% from last period</p>
                    </div>
                  </div>
                </div>

                {/* Role Distribution */}
                <div>
                  <h3 className="text-[#111827] mb-3">User Role Distribution</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="p-4 border border-gray-200 rounded-xl">
                      <p className="text-[#6B7280] text-sm">Explorers</p>
                      <p className="text-[#111827] text-xl mt-1">2,340</p>
                      <p className="text-[#6B7280] text-xs mt-1">82% of users</p>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-xl">
                      <p className="text-[#6B7280] text-sm">Curators</p>
                      <p className="text-[#111827] text-xl mt-1">142</p>
                      <p className="text-[#6B7280] text-xs mt-1">5% of users</p>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-xl">
                      <p className="text-[#6B7280] text-sm">Businesses</p>
                      <p className="text-[#111827] text-xl mt-1">87</p>
                      <p className="text-[#6B7280] text-xs mt-1">3% of users</p>
                    </div>
                    <div className="p-4 border border-gray-200 rounded-xl">
                      <p className="text-[#6B7280] text-sm">Total Users</p>
                      <p className="text-[#111827] text-xl mt-1">2,847</p>
                      <p className="text-[#6B7280] text-xs mt-1">100%</p>
                    </div>
                  </div>
                </div>

                {/* Top Performing Content */}
                <div>
                  <h3 className="text-[#111827] mb-3">Top Performing Experiences</h3>
                  <div className="space-y-3">
                    {[
                      { name: 'Sunset Yoga Session', views: 1234, engagement: '89%' },
                      { name: 'Street Food Tour', views: 987, engagement: '82%' },
                      { name: 'Pottery Workshop', views: 756, engagement: '76%' },
                      { name: 'Coffee Tasting', views: 654, engagement: '71%' }
                    ].map((exp, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[#eb7825] text-white flex items-center justify-center text-sm">
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-[#111827]">{exp.name}</p>
                            <p className="text-[#6B7280] text-sm">{exp.views} views</p>
                          </div>
                        </div>
                        <Badge className="bg-green-50 text-green-700 border-green-200">
                          {exp.engagement}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </QAPageLayout>
  );
}
