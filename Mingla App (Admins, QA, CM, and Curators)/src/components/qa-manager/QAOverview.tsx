import React, { useState, useEffect } from 'react';
import { 
  Users, TrendingUp, Activity, DollarSign, ShoppingCart, 
  Eye, MessageCircle, Star, ArrowUpRight, ArrowDownRight,
  Calendar, MapPin, Sparkles, FileText, AlertCircle, Shield
} from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { motion } from 'motion/react';
import QAPageLayout from './QAPageLayout';

interface QAOverviewProps {
  userData?: any;
  onNavigate?: (tab: string) => void;
  onOpenCreateCard?: () => void;
}

export default function QAOverview({ userData, onNavigate, onOpenCreateCard }: QAOverviewProps) {
  const [stats, setStats] = useState({
    totalExplorers: 0,
    totalCurators: 0,
    totalBusinesses: 0,
    totalExperiences: 0,
    liveExperiences: 0,
    flaggedExperiences: 0,
    myExperiences: 0,
    apiExperiences: 0,
    totalReviews: 0,
    avgRating: 0,
    pendingTickets: 0,
    resolvedTickets: 0
  });

  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [recentFlags, setRecentFlags] = useState<any[]>([]);

  useEffect(() => {
    loadOverviewData();
  }, []);

  const loadOverviewData = () => {
    // Load users
    const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const explorers = allUsers.filter((u: any) => u.role === 'explorer');
    const curators = allUsers.filter((u: any) => u.role === 'curator');
    const businesses = allUsers.filter((u: any) => u.role === 'business');

    // Load experiences
    const experiences = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const liveExps = experiences.filter((e: any) => e.status === 'live');
    const flaggedExps = experiences.filter((e: any) => e.flaggedForReview);
    const apiExps = experiences.filter((e: any) => e.isApiGenerated);
    const myExps = experiences.filter((e: any) => 
      e.createdBy === userData?.email || e.createdBy?.includes('qa')
    );

    // Load support tickets
    const tickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
    const pendingTickets = tickets.filter((t: any) => t.status === 'open' || t.status === 'in-progress');
    const resolvedTickets = tickets.filter((t: any) => t.status === 'resolved');

    setStats({
      totalExplorers: explorers.length,
      totalCurators: curators.length,
      totalBusinesses: businesses.length,
      totalExperiences: experiences.length,
      liveExperiences: liveExps.length,
      flaggedExperiences: flaggedExps.length,
      myExperiences: myExps.length,
      apiExperiences: apiExps.length,
      totalReviews: experiences.reduce((sum: number, e: any) => sum + (e.reviews?.length || 0), 0),
      avgRating: 4.7,
      pendingTickets: pendingTickets.length,
      resolvedTickets: resolvedTickets.length
    });

    // Load recent flagged content
    const recentlyFlagged = flaggedExps
      .sort((a: any, b: any) => new Date(b.flaggedAt || 0).getTime() - new Date(a.flaggedAt || 0).getTime())
      .slice(0, 5);
    setRecentFlags(recentlyFlagged);

    // Load recent activity - tickets and flagged content
    const activities = [
      ...tickets.slice(-10).map((t: any) => ({
        type: 'ticket',
        user: t.userName,
        action: `created ticket: ${t.subject}`,
        time: t.createdAt,
        priority: t.priority
      })),
      ...flaggedExps.slice(-5).map((e: any) => ({
        type: 'flag',
        user: e.flaggedBy,
        action: `flagged ${e.title}`,
        time: e.flaggedAt,
        reason: e.flagReason
      }))
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10);

    setRecentActivity(activities);
  };

  const statCards = [
    {
      title: 'Total Explorers',
      value: stats.totalExplorers,
      icon: Users,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      change: '+12%',
      trend: 'up'
    },
    {
      title: 'Total Curators',
      value: stats.totalCurators,
      icon: Sparkles,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      change: '+8%',
      trend: 'up'
    },
    {
      title: 'Total Businesses',
      value: stats.totalBusinesses,
      icon: ShoppingCart,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      change: '+15%',
      trend: 'up'
    },
    {
      title: 'Live Experiences',
      value: stats.liveExperiences,
      icon: Eye,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
      change: `${stats.totalExperiences} total`,
      trend: 'neutral'
    },
    {
      title: 'Flagged Content',
      value: stats.flaggedExperiences,
      icon: AlertCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      change: 'Needs review',
      trend: stats.flaggedExperiences > 0 ? 'up' : 'neutral'
    },
    {
      title: 'My Experiences',
      value: stats.myExperiences,
      icon: Star,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      change: 'Created by you',
      trend: 'neutral'
    },
    {
      title: 'API Content',
      value: stats.apiExperiences,
      icon: Sparkles,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
      change: 'Auto-generated',
      trend: 'neutral'
    },
    {
      title: 'Pending Tickets',
      value: stats.pendingTickets,
      icon: MessageCircle,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
      change: `${stats.resolvedTickets} resolved`,
      trend: stats.pendingTickets > 5 ? 'up' : 'down'
    }
  ];

  return (
    <QAPageLayout
      title="QA Overview"
      description={`Welcome back, ${userData?.name || 'QA Manager'}! Here's what's happening on Mingla today.`}
    >
      <div className="space-y-6">
        {/* Quick Actions */}
        <Card className="p-6 border border-gray-200">
          <h2 className="text-[#111827] mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Button 
              variant="outline" 
              className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-[#eb7825]/5 hover:border-[#eb7825] hover:text-[#eb7825] transition-all"
              onClick={() => onNavigate && onNavigate('moderate')}
            >
              <Shield className="w-5 h-5" />
              <span className="text-sm">Moderate</span>
            </Button>
            <Button 
              variant="outline" 
              className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-purple-50 hover:border-purple-500 hover:text-purple-600 transition-all"
              onClick={() => {
                if (onOpenCreateCard) {
                  onOpenCreateCard();
                } else if (onNavigate) {
                  onNavigate('my-cards');
                }
              }}
            >
              <Sparkles className="w-5 h-5" />
              <span className="text-sm">Create Card</span>
            </Button>
            <Button 
              variant="outline" 
              className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-blue-50 hover:border-blue-500 hover:text-blue-600 transition-all"
              onClick={() => onNavigate && onNavigate('admin-chat')}
            >
              <MessageCircle className="w-5 h-5" />
              <span className="text-sm">Admin Chat</span>
            </Button>
            <Button 
              variant="outline" 
              className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-green-50 hover:border-green-500 hover:text-green-600 transition-all"
              onClick={() => onNavigate && onNavigate('support')}
            >
              <FileText className="w-5 h-5" />
              <span className="text-sm">Support</span>
            </Button>
          </div>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, index) => (
            <motion.div
              key={stat.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-[#6B7280] text-sm">{stat.title}</p>
                    <p className="text-[#111827] text-2xl mt-2">{stat.value}</p>
                    <div className="flex items-center gap-2 mt-2">
                      {stat.trend === 'up' && (
                        <div className="flex items-center text-green-600 text-sm">
                          <ArrowUpRight className="w-4 h-4" />
                          <span>{stat.change}</span>
                        </div>
                      )}
                      {stat.trend === 'down' && (
                        <div className="flex items-center text-red-600 text-sm">
                          <ArrowDownRight className="w-4 h-4" />
                          <span>{stat.change}</span>
                        </div>
                      )}
                      {stat.trend === 'neutral' && (
                        <span className="text-[#6B7280] text-sm">{stat.change}</span>
                      )}
                    </div>
                  </div>
                  <div className={`p-3 rounded-xl ${stat.bgColor}`}>
                    <stat.icon className={`w-6 h-6 ${stat.color}`} />
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Recent Activity & Flagged Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Activity */}
          <Card className="p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[#111827]">Recent Activity</h2>
              <Button variant="ghost" size="sm">
                View All
              </Button>
            </div>
            <div className="space-y-4">
              {recentActivity.length === 0 ? (
                <p className="text-[#6B7280] text-center py-8">No recent activity</p>
              ) : (
                recentActivity.map((activity, index) => (
                  <div key={index} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                    <div className={`p-2 rounded-lg ${
                      activity.type === 'ticket' ? 'bg-blue-50' : 'bg-red-50'
                    }`}>
                      {activity.type === 'ticket' ? (
                        <MessageCircle className="w-4 h-4 text-blue-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#111827] text-sm">
                        <span className="font-medium">{activity.user}</span> {activity.action}
                      </p>
                      <p className="text-[#6B7280] text-xs mt-1">
                        {new Date(activity.time).toLocaleString()}
                      </p>
                    </div>
                    {activity.priority && (
                      <Badge variant="outline" className={
                        activity.priority === 'high' 
                          ? 'bg-red-50 text-red-700 border-red-200' 
                          : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                      }>
                        {activity.priority}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Flagged Content */}
          <Card className="p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[#111827]">Flagged Content</h2>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onNavigate && onNavigate('moderate')}
              >
                View All
              </Button>
            </div>
            <div className="space-y-4">
              {recentFlags.length === 0 ? (
                <div className="text-center py-8">
                  <Shield className="w-12 h-12 text-green-400 mx-auto mb-2" />
                  <p className="text-[#6B7280]">No flagged content</p>
                  <p className="text-[#6B7280] text-sm">All content is clean!</p>
                </div>
              ) : (
                recentFlags.map((flag, index) => (
                  <div key={index} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                    <div className="p-2 rounded-lg bg-red-50">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[#111827] font-medium line-clamp-1">{flag.title}</p>
                      <p className="text-[#6B7280] text-sm line-clamp-1">
                        Reason: {flag.flagReason}
                      </p>
                      <p className="text-[#6B7280] text-xs mt-1">
                        Flagged by {flag.flaggedBy} • {new Date(flag.flaggedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                      Review
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </QAPageLayout>
  );
}
