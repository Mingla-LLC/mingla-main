import React, { useState, useEffect } from 'react';
import { 
  Users, TrendingUp, Activity, DollarSign, ShoppingCart, 
  Eye, MessageCircle, Star, ArrowUpRight, ArrowDownRight,
  Calendar, MapPin, Sparkles, FileText, AlertCircle
} from 'lucide-react';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { motion } from 'motion/react';
import AdminPageLayout from './AdminPageLayout';

interface AdminOverviewProps {
  userData?: any;
  onNavigate?: (tab: string) => void;
  onOpenAddUser?: () => void;
  onOpenCreateCard?: () => void;
}

export default function AdminOverview({ userData, onNavigate, onOpenAddUser, onOpenCreateCard }: AdminOverviewProps) {
  const [stats, setStats] = useState({
    totalExplorers: 0,
    totalCurators: 0,
    totalBusinesses: 0,
    totalQAManagers: 0,
    totalExperiences: 0,
    liveExperiences: 0,
    totalRevenue: 0,
    totalTransactions: 0,
    avgRating: 0,
    totalReviews: 0,
    activeUsers: 0,
    pendingTickets: 0
  });

  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [topPerformers, setTopPerformers] = useState<any[]>([]);

  useEffect(() => {
    loadOverviewData();
  }, []);

  const loadOverviewData = () => {
    // Load users
    const allUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const explorers = allUsers.filter((u: any) => u.role === 'explorer');
    const curators = allUsers.filter((u: any) => u.role === 'curator');
    const businesses = allUsers.filter((u: any) => u.role === 'business');
    const qaManagers = allUsers.filter((u: any) => u.role === 'qa');

    // Load experiences
    const experiences = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const liveExps = experiences.filter((e: any) => e.status === 'live');

    // Load transactions
    const purchases = JSON.parse(localStorage.getItem('userPurchases') || '[]');
    const totalRevenue = purchases.reduce((sum: number, p: any) => {
      const price = parseFloat(p.price?.replace(/[^0-9.]/g, '') || '0');
      return sum + price;
    }, 0);

    // Load support tickets
    const tickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
    const pendingTickets = tickets.filter((t: any) => t.status === 'open' || t.status === 'in-progress');

    setStats({
      totalExplorers: explorers.length,
      totalCurators: curators.length,
      totalBusinesses: businesses.length,
      totalQAManagers: qaManagers.length,
      totalExperiences: experiences.length,
      liveExperiences: liveExps.length,
      totalRevenue,
      totalTransactions: purchases.length,
      avgRating: 4.7,
      totalReviews: purchases.length * 0.8,
      activeUsers: allUsers.filter((u: any) => u.lastActive && 
        new Date(u.lastActive) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length,
      pendingTickets: pendingTickets.length
    });

    // Load recent activity
    const activities = [
      ...purchases.slice(-10).map((p: any) => ({
        type: 'purchase',
        user: p.userName,
        action: `purchased ${p.experienceName}`,
        time: p.purchaseDate,
        amount: p.price
      })),
      ...experiences.slice(-5).map((e: any) => ({
        type: 'experience',
        user: e.createdByName,
        action: `created ${e.title}`,
        time: e.createdAt,
        status: e.status
      }))
    ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 10);

    setRecentActivity(activities);

    // Calculate top performers
    const experienceViews = experiences.reduce((acc: any, exp: any) => {
      if (exp.createdBy) {
        if (!acc[exp.createdBy]) {
          acc[exp.createdBy] = { name: exp.createdByName, views: 0, cards: 0, revenue: 0 };
        }
        acc[exp.createdBy].views += exp.views || 0;
        acc[exp.createdBy].cards += 1;
      }
      return acc;
    }, {});

    const performers = Object.values(experienceViews)
      .sort((a: any, b: any) => b.views - a.views)
      .slice(0, 5);

    setTopPerformers(performers as any[]);
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
      title: 'Active Users (7d)',
      value: stats.activeUsers,
      icon: Activity,
      color: 'text-orange-600',
      bgColor: 'bg-orange-50',
      change: '+5%',
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
      title: 'Total Revenue',
      value: `$${stats.totalRevenue.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
      change: '+23%',
      trend: 'up'
    },
    {
      title: 'Total Transactions',
      value: stats.totalTransactions,
      icon: FileText,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
      change: '+18%',
      trend: 'up'
    },
    {
      title: 'Pending Tickets',
      value: stats.pendingTickets,
      icon: AlertCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
      change: '-3%',
      trend: 'down'
    }
  ];

  return (
    <AdminPageLayout
      title="Platform Overview"
      description={`Welcome back, ${userData?.name || 'Admin'}! Here's what's happening on Mingla today.`}
    >
      <div className="space-y-6">
        {/* Quick Actions */}
        <Card className="p-6 border border-gray-200">
        <h2 className="text-[#111827] mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Button 
            variant="outline" 
            className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-[#eb7825]/5 hover:border-[#eb7825] hover:text-[#eb7825] transition-all"
            onClick={() => {
              if (onOpenAddUser) {
                onOpenAddUser();
              } else if (onNavigate) {
                onNavigate('users');
              }
            }}
          >
            <Users className="w-5 h-5" />
            <span className="text-sm">Add User</span>
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
            onClick={() => onNavigate && onNavigate('analytics')}
          >
            <FileText className="w-5 h-5" />
            <span className="text-sm">View Reports</span>
          </Button>
          <Button 
            variant="outline" 
            className="h-auto py-4 flex flex-col items-center gap-2 hover:bg-green-50 hover:border-green-500 hover:text-green-600 transition-all"
            onClick={() => onNavigate && onNavigate('support')}
          >
            <MessageCircle className="w-5 h-5" />
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

      {/* Recent Activity & Top Performers */}
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
                    activity.type === 'purchase' ? 'bg-green-50' : 'bg-blue-50'
                  }`}>
                    {activity.type === 'purchase' ? (
                      <ShoppingCart className="w-4 h-4 text-green-600" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-blue-600" />
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
                  {activity.amount && (
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      {activity.amount}
                    </Badge>
                  )}
                  {activity.status && (
                    <Badge variant="outline">
                      {activity.status}
                    </Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Top Performers */}
        <Card className="p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">Top Performers</h2>
            <Button variant="ghost" size="sm">
              View All
            </Button>
          </div>
          <div className="space-y-4">
            {topPerformers.length === 0 ? (
              <p className="text-[#6B7280] text-center py-8">No data available</p>
            ) : (
              topPerformers.map((performer, index) => (
                <div key={index} className="flex items-center gap-3 pb-3 border-b border-gray-100 last:border-0">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[#eb7825] text-white">
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[#111827] font-medium">{performer.name}</p>
                    <p className="text-[#6B7280] text-sm">
                      {performer.cards} cards • {performer.views.toLocaleString()} views
                    </p>
                  </div>
                  <Star className="w-5 h-5 text-yellow-500 fill-yellow-500" />
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
      </div>
    </AdminPageLayout>
  );
}
