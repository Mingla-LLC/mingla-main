import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, Users, Eye, DollarSign, ShoppingCart, Star,
  Download, Calendar, Filter, BarChart3, PieChart, LineChart
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import {
  BarChart, Bar, LineChart as RechartsLineChart, Line, PieChart as RechartsPieChart, 
  Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import AdminPageLayout from './AdminPageLayout';

interface AdminAnalyticsProps {
  userData?: any;
}

export default function AdminAnalytics({ userData }: AdminAnalyticsProps) {
  const [timeRange, setTimeRange] = useState('7d');
  const [selectedMetric, setSelectedMetric] = useState('all');

  const [analyticsData, setAnalyticsData] = useState({
    userGrowth: [] as any[],
    categoryDistribution: [] as any[],
    revenueData: [] as any[],
    userEngagement: [] as any[]
  });

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const loadAnalytics = () => {
    // Generate mock analytics data
    const userGrowth = [
      { date: 'Mon', users: 120, active: 95 },
      { date: 'Tue', users: 145, active: 110 },
      { date: 'Wed', users: 180, active: 140 },
      { date: 'Thu', users: 210, active: 165 },
      { date: 'Fri', users: 250, active: 190 },
      { date: 'Sat', users: 290, active: 220 },
      { date: 'Sun', users: 320, active: 250 }
    ];

    const categoryDistribution = [
      { name: 'Casual Eats', value: 450, color: '#eb7825' },
      { name: 'Dining', value: 380, color: '#d6691f' },
      { name: 'Sip & Chill', value: 320, color: '#3b82f6' },
      { name: 'Wellness', value: 280, color: '#8b5cf6' },
      { name: 'Creative', value: 220, color: '#10b981' },
      { name: 'Other', value: 180, color: '#6b7280' }
    ];

    const revenueData = [
      { month: 'Jan', revenue: 12000 },
      { month: 'Feb', revenue: 15000 },
      { month: 'Mar', revenue: 18000 },
      { month: 'Apr', revenue: 22000 },
      { month: 'May', revenue: 28000 },
      { month: 'Jun', revenue: 35000 }
    ];

    const userEngagement = [
      { type: 'Views', count: 15000 },
      { type: 'Likes', count: 8500 },
      { type: 'Saves', count: 5200 },
      { type: 'Shares', count: 2800 },
      { type: 'Purchases', count: 1200 }
    ];

    setAnalyticsData({
      userGrowth,
      categoryDistribution,
      revenueData,
      userEngagement
    });
  };

  const kpiCards = [
    { label: 'Total Revenue', value: '$130,000', change: '+23%', trend: 'up', icon: DollarSign, color: 'text-green-600' },
    { label: 'Total Users', value: '2,847', change: '+12%', trend: 'up', icon: Users, color: 'text-blue-600' },
    { label: 'Total Views', value: '45.2K', change: '+18%', trend: 'up', icon: Eye, color: 'text-purple-600' },
    { label: 'Conversion Rate', value: '3.8%', change: '+0.5%', trend: 'up', icon: TrendingUp, color: 'text-orange-600' }
  ];

  return (
    <AdminPageLayout
      title="Analytics"
      description="Deep insights into platform performance and user behavior"
      actions={
        <>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 Hours</SelectItem>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
              <SelectItem value="90d">Last 90 Days</SelectItem>
              <SelectItem value="1y">Last Year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((kpi, index) => (
          <Card key={index} className="p-6 border border-gray-200">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-[#6B7280] text-sm">{kpi.label}</p>
                <p className="text-[#111827] text-2xl mt-2">{kpi.value}</p>
                <div className="flex items-center gap-1 mt-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-green-600 text-sm">{kpi.change}</span>
                </div>
              </div>
              <div className={`p-3 rounded-xl bg-gray-50`}>
                <kpi.icon className={`w-6 h-6 ${kpi.color}`} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* User Growth */}
        <Card className="p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">User Growth</h2>
            <Badge variant="outline">7 Days</Badge>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <RechartsLineChart data={analyticsData.userGrowth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="users" stroke="#eb7825" strokeWidth={2} />
              <Line type="monotone" dataKey="active" stroke="#3b82f6" strokeWidth={2} />
            </RechartsLineChart>
          </ResponsiveContainer>
        </Card>

        {/* Category Distribution */}
        <Card className="p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">Category Distribution</h2>
            <Badge variant="outline">All Time</Badge>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <RechartsPieChart>
              <Pie
                data={analyticsData.categoryDistribution}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {analyticsData.categoryDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </RechartsPieChart>
          </ResponsiveContainer>
        </Card>

        {/* Revenue Trend */}
        <Card className="p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">Revenue Trend</h2>
            <Badge variant="outline">6 Months</Badge>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analyticsData.revenueData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* User Engagement */}
        <Card className="p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">User Engagement</h2>
            <Badge variant="outline">All Time</Badge>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={analyticsData.userEngagement} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="type" type="category" />
              <Tooltip />
              <Legend />
              <Bar dataKey="count" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Detailed Metrics Table */}
      <Card className="border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-[#111827]">Detailed Metrics</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Metric</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Value</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Change</th>
                <th className="px-6 py-3 text-left text-xs text-[#6B7280] uppercase">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {[
                { metric: 'Page Views', value: '125,430', change: '+12.5%', trend: 'up' },
                { metric: 'Unique Visitors', value: '45,230', change: '+8.2%', trend: 'up' },
                { metric: 'Avg. Session Duration', value: '5m 23s', change: '+15.3%', trend: 'up' },
                { metric: 'Bounce Rate', value: '32.1%', change: '-5.2%', trend: 'down' },
                { metric: 'Conversion Rate', value: '3.8%', change: '+0.5%', trend: 'up' }
              ].map((row, index) => (
                <tr key={index} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-[#111827]">{row.metric}</td>
                  <td className="px-6 py-4 text-[#111827]">{row.value}</td>
                  <td className="px-6 py-4">
                    <span className={row.trend === 'up' ? 'text-green-600' : 'text-red-600'}>
                      {row.change}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <TrendingUp 
                      className={`w-4 h-4 ${row.trend === 'up' ? 'text-green-600' : 'text-red-600 rotate-180'}`} 
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      </div>
    </AdminPageLayout>
  );
}
