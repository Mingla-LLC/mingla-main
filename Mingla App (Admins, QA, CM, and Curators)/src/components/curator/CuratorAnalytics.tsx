import React, { useState } from 'react';
import { 
  TrendingUp, Eye, Heart, Bookmark, Users, Target,
  ArrowUpRight, ArrowDownRight, Calendar, Download,
  BarChart3, PieChart, LineChart, Zap
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import CuratorPageLayout from './CuratorPageLayout';

interface CuratorAnalyticsProps {
  stats: {
    totalCards: number;
    liveCards: number;
    totalViews: number;
    totalLikes: number;
  };
  analyticsData: {
    viewsGrowth: number;
    engagementRate: number;
    conversionRate: number;
    avgTimeOnCard: string;
    topCard: any;
    chartData: any[];
  };
}

export default function CuratorAnalytics({ stats, analyticsData }: CuratorAnalyticsProps) {
  const [timeframe, setTimeframe] = useState('30d');

  return (
    <CuratorPageLayout
      title="Analytics"
      description="Track performance and insights for your experiences"
      actions={
        <div className="flex gap-2">
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-6 border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Total Views</p>
                <p className="text-[#111827] text-3xl mt-2">{stats.totalViews.toLocaleString()}</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  +{analyticsData.viewsGrowth}% growth
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
                <Eye className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Engagement Rate</p>
                <p className="text-[#111827] text-3xl mt-2">{analyticsData.engagementRate}%</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  Above average
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl">
                <Users className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Conversion Rate</p>
                <p className="text-[#111827] text-3xl mt-2">{analyticsData.conversionRate}%</p>
                <p className="text-[#6B7280] text-sm mt-2 flex items-center gap-1">
                  <Target className="w-4 h-4" />
                  Steady trend
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl">
                <Target className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Avg Time on Card</p>
                <p className="text-[#111827] text-3xl mt-2">{analyticsData.avgTimeOnCard}</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  +12% increase
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl">
                <Zap className="w-6 h-6 text-[#eb7825]" />
              </div>
            </div>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[#111827]">Performance Overview</h2>
              <BarChart3 className="w-5 h-5 text-gray-400" />
            </div>
            <div className="h-64 flex items-end justify-between gap-2">
              {analyticsData.chartData.map((day, index) => {
                const maxValue = Math.max(...analyticsData.chartData.map(d => d.views));
                const height = (day.views / maxValue) * 100;
                
                return (
                  <div key={index} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full bg-gray-100 rounded-t-lg relative group cursor-pointer hover:bg-gray-200 transition-colors" style={{ height: `${height}%` }}>
                      <div 
                        className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#eb7825] to-[#d6691f] rounded-t-lg transition-all"
                        style={{ height: '100%' }}
                      />
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                        {day.views} views
                      </div>
                    </div>
                    <span className="text-xs text-gray-600">{day.name}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-[#111827]">Engagement Metrics</h2>
              <LineChart className="w-5 h-5 text-gray-400" />
            </div>
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Eye className="w-4 h-4 text-blue-600" />
                    <span className="text-[#111827] text-sm">Views</span>
                  </div>
                  <span className="text-[#111827]">{stats.totalViews.toLocaleString()}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full" style={{ width: '85%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Heart className="w-4 h-4 text-red-500" />
                    <span className="text-[#111827] text-sm">Likes</span>
                  </div>
                  <span className="text-[#111827]">{stats.totalLikes.toLocaleString()}</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className="bg-gradient-to-r from-red-500 to-pink-600 h-3 rounded-full" style={{ width: '65%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Bookmark className="w-4 h-4 text-purple-600" />
                    <span className="text-[#111827] text-sm">Saves</span>
                  </div>
                  <span className="text-[#111827]">
                    {analyticsData.chartData.reduce((sum, d) => sum + d.saves, 0)}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className="bg-gradient-to-r from-purple-500 to-pink-600 h-3 rounded-full" style={{ width: '45%' }}></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-green-600" />
                    <span className="text-[#111827] text-sm">Conversions</span>
                  </div>
                  <span className="text-[#111827]">{analyticsData.conversionRate}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div className="bg-gradient-to-r from-green-500 to-emerald-600 h-3 rounded-full" style={{ width: '35%' }}></div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Top Performing Card */}
        {analyticsData.topCard && (
          <Card className="p-6 border border-gray-200">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-5 h-5 text-[#eb7825]" />
              <h2 className="text-[#111827]">Top Performing Experience</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex gap-4">
                {analyticsData.topCard.image && (
                  <img 
                    src={analyticsData.topCard.image} 
                    alt={analyticsData.topCard.title}
                    className="w-32 h-32 object-cover rounded-xl"
                  />
                )}
                <div>
                  <h3 className="text-[#111827] mb-2">{analyticsData.topCard.title}</h3>
                  <p className="text-[#6B7280] text-sm mb-3">{analyticsData.topCard.category}</p>
                  <div className="flex gap-4 text-sm">
                    <div className="flex items-center gap-1 text-[#6B7280]">
                      <Eye className="w-4 h-4" />
                      <span>{analyticsData.topCard.views || 0}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[#6B7280]">
                      <Heart className="w-4 h-4" />
                      <span>{analyticsData.topCard.likes || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-blue-50 rounded-xl">
                  <Eye className="w-5 h-5 text-blue-600 mx-auto mb-2" />
                  <p className="text-2xl text-[#111827]">{analyticsData.topCard.views || 0}</p>
                  <p className="text-[#6B7280] text-sm">Views</p>
                </div>
                <div className="text-center p-4 bg-red-50 rounded-xl">
                  <Heart className="w-5 h-5 text-red-500 mx-auto mb-2" />
                  <p className="text-2xl text-[#111827]">{analyticsData.topCard.likes || 0}</p>
                  <p className="text-[#6B7280] text-sm">Likes</p>
                </div>
                <div className="text-center p-4 bg-purple-50 rounded-xl">
                  <Bookmark className="w-5 h-5 text-purple-600 mx-auto mb-2" />
                  <p className="text-2xl text-[#111827]">{analyticsData.topCard.saves || 0}</p>
                  <p className="text-[#6B7280] text-sm">Saves</p>
                </div>
                <div className="text-center p-4 bg-green-50 rounded-xl">
                  <Target className="w-5 h-5 text-green-600 mx-auto mb-2" />
                  <p className="text-2xl text-[#111827]">4.2%</p>
                  <p className="text-[#6B7280] text-sm">Conv. Rate</p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Insights */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6 border border-gray-200">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-green-50 rounded-xl">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
              <div>
                <p className="text-[#111827] mb-1">Peak Engagement</p>
                <p className="text-[#6B7280] text-sm">
                  Your experiences perform best on Friday and Saturday evenings
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-blue-50 rounded-xl">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-[#111827] mb-1">Audience Growth</p>
                <p className="text-[#6B7280] text-sm">
                  You've gained 127 new followers this month
                </p>
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200">
            <div className="flex items-start gap-3">
              <div className="p-3 bg-purple-50 rounded-xl">
                <Target className="w-6 h-6 text-purple-600" />
              </div>
              <div>
                <p className="text-[#111827] mb-1">Top Category</p>
                <p className="text-[#6B7280] text-sm">
                  Food & Drink experiences have the highest conversion
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </CuratorPageLayout>
  );
}
