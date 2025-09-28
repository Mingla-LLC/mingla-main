/**
 * A/B Testing Service for Recommendation Algorithms
 * Implements user segmentation and algorithm testing
 */

import { supabase } from './supabase';

export interface ABTest {
  id: string;
  name: string;
  description: string;
  variants: ABTestVariant[];
  isActive: boolean;
  startDate: string;
  endDate?: string;
  targetAudience?: ABTestAudience;
  metrics: ABTestMetric[];
  createdAt: string;
  updatedAt: string;
}

export interface ABTestVariant {
  id: string;
  name: string;
  description: string;
  algorithm: string; // 'baseline', 'enhanced', 'ml_advanced', 'collaborative', 'time_based'
  weight: number; // 0-1, determines traffic allocation
  config: Record<string, any>; // Algorithm-specific configuration
}

export interface ABTestAudience {
  userSegments?: string[]; // 'new_users', 'power_users', 'casual_users'
  locationFilters?: string[]; // Geographic targeting
  categoryFilters?: string[]; // Interest-based targeting
  minInteractions?: number; // Minimum user interactions required
  maxInteractions?: number; // Maximum user interactions (for new users)
}

export interface ABTestMetric {
  name: string;
  type: 'conversion' | 'engagement' | 'retention' | 'revenue';
  target: number; // Target value for the metric
  weight: number; // Importance weight for this metric
}

export interface UserABTestAssignment {
  userId: string;
  testId: string;
  variantId: string;
  assignedAt: string;
  isActive: boolean;
}

export interface ABTestResult {
  testId: string;
  variantId: string;
  metric: string;
  value: number;
  sampleSize: number;
  confidence: number;
  significance: boolean;
  createdAt: string;
}

class ABTestingService {
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
  private userAssignments: Map<string, UserABTestAssignment[]> = new Map();
  private lastCacheUpdate: number = 0;

  /**
   * Get active A/B tests
   */
  async getActiveTests(): Promise<ABTest[]> {
    try {
      const { data, error } = await supabase
        .from('ab_tests')
        .select('*')
        .eq('is_active', true)
        .lte('start_date', new Date().toISOString())
        .or(`end_date.is.null,end_date.gte.${new Date().toISOString()}`)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching active A/B tests:', error);
        // If table doesn't exist, return empty array
        if (error.code === '42P01') {
          console.log('A/B tests table does not exist yet. Please apply the migration.');
          return [];
        }
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getActiveTests:', error);
      return [];
    }
  }

  /**
   * Assign user to A/B test variant
   */
  async assignUserToTest(userId: string, testId: string): Promise<string | null> {
    try {
      // Check if user is already assigned to this test
      const existingAssignment = await this.getUserAssignment(userId, testId);
      if (existingAssignment) {
        return existingAssignment.variantId;
      }

      // Get test details
      const { data: test, error: testError } = await supabase
        .from('ab_tests')
        .select('*')
        .eq('id', testId)
        .eq('is_active', true)
        .single();

      if (testError || !test) {
        console.error('Error fetching test:', testError);
        return null;
      }

      // Check if user meets audience criteria
      const meetsCriteria = await this.checkAudienceCriteria(userId, test.targetAudience);
      if (!meetsCriteria) {
        console.log(`User ${userId} does not meet audience criteria for test ${testId}`);
        return null;
      }

      // Assign variant based on weights
      const variantId = this.selectVariant(test.variants);
      if (!variantId) {
        console.error('Failed to select variant for test:', testId);
        return null;
      }

      // Store assignment
      const assignment: UserABTestAssignment = {
        userId,
        testId,
        variantId,
        assignedAt: new Date().toISOString(),
        isActive: true
      };

      const { error: insertError } = await supabase
        .from('user_ab_test_assignments')
        .insert([assignment]);

      if (insertError) {
        console.error('Error storing A/B test assignment:', insertError);
        return null;
      }

      // Update cache
      this.updateUserAssignmentsCache(userId, assignment);

      console.log(`✅ Assigned user ${userId} to variant ${variantId} in test ${testId}`);
      return variantId;
    } catch (error) {
      console.error('Error in assignUserToTest:', error);
      return null;
    }
  }

  /**
   * Get user's assigned variant for a test
   */
  async getUserAssignment(userId: string, testId: string): Promise<UserABTestAssignment | null> {
    try {
      // Check cache first
      const cached = this.getCachedUserAssignment(userId, testId);
      if (cached) {
        return cached;
      }

      const { data, error } = await supabase
        .from('user_ab_test_assignments')
        .select('*')
        .eq('user_id', userId)
        .eq('test_id', testId)
        .eq('is_active', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No assignment found
          return null;
        }
        if (error.code === '42P01') {
          // Table doesn't exist
          console.log('A/B test assignments table does not exist yet. Please apply the migration.');
          return null;
        }
        console.error('Error fetching user assignment:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getUserAssignment:', error);
      return null;
    }
  }

  /**
   * Get the current recommendation algorithm test ID
   */
  async getCurrentRecommendationTestId(): Promise<string | null> {
    try {
      const activeTests = await this.getActiveTests();
      
      // Find recommendation algorithm tests
      const recommendationTests = activeTests.filter(test => 
        test.name.toLowerCase().includes('recommendation') ||
        test.name.toLowerCase().includes('algorithm')
      );

      if (recommendationTests.length === 0) {
        return null;
      }

      // Return the most recent test ID
      return recommendationTests[0].id;
    } catch (error) {
      console.error('Error getting current recommendation test ID:', error);
      return null;
    }
  }

  /**
   * Get user's algorithm variant for recommendations
   */
  async getUserRecommendationVariant(userId: string): Promise<string> {
    try {
      const activeTests = await this.getActiveTests();
      
      // Find recommendation algorithm tests
      const recommendationTests = activeTests.filter(test => 
        test.name.toLowerCase().includes('recommendation') ||
        test.name.toLowerCase().includes('algorithm')
      );

      if (recommendationTests.length === 0) {
        return 'enhanced'; // Default algorithm
      }

      // Get the most recent test
      const latestTest = recommendationTests[0];
      const assignment = await this.getUserAssignment(userId, latestTest.id);
      
      if (assignment) {
        // Get variant details
        const variant = latestTest.variants.find(v => v.id === assignment.variantId);
        return variant?.algorithm || 'enhanced';
      }

      // Assign user to test if not already assigned
      const variantId = await this.assignUserToTest(userId, latestTest.id);
      if (variantId) {
        const variant = latestTest.variants.find(v => v.id === variantId);
        return variant?.algorithm || 'enhanced';
      }

      return 'enhanced'; // Fallback
    } catch (error) {
      console.error('Error in getUserRecommendationVariant:', error);
      return 'enhanced';
    }
  }

  /**
   * Track A/B test event
   */
  async trackEvent(userId: string, testId: string, eventType: string, eventData: any = {}): Promise<void> {
    try {
      const assignment = await this.getUserAssignment(userId, testId);
      if (!assignment) {
        console.log(`No assignment found for user ${userId} in test ${testId}`);
        return;
      }

      const event = {
        user_id: userId,
        test_id: testId,
        variant_id: assignment.variantId,
        event_type: eventType,
        event_data: eventData,
        created_at: new Date().toISOString()
      };

      const { error } = await supabase
        .from('ab_test_events')
        .insert([event]);

      if (error) {
        if (error.code === '42P01') {
          console.log('A/B test events table does not exist yet. Please apply the migration.');
        } else {
          console.error('Error tracking A/B test event:', error);
        }
      } else {
        console.log(`📊 Tracked A/B test event: ${eventType} for user ${userId} in variant ${assignment.variantId}`);
      }
    } catch (error) {
      console.error('Error in trackEvent:', error);
    }
  }

  /**
   * Get A/B test results
   */
  async getTestResults(testId: string): Promise<ABTestResult[]> {
    try {
      const { data, error } = await supabase
        .from('ab_test_results')
        .select('*')
        .eq('test_id', testId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching test results:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getTestResults:', error);
      return [];
    }
  }

  /**
   * Check if user meets audience criteria
   */
  private async checkAudienceCriteria(userId: string, audience?: ABTestAudience): Promise<boolean> {
    if (!audience) {
      return true; // No criteria means all users
    }

    try {
      // Check interaction count criteria
      if (audience.minInteractions !== undefined || audience.maxInteractions !== undefined) {
        const { data: interactions, error } = await supabase
          .from('user_interactions')
          .select('id')
          .eq('user_id', userId);

        if (error) {
          console.error('Error checking user interactions:', error);
          return false;
        }

        const interactionCount = interactions?.length || 0;

        if (audience.minInteractions !== undefined && interactionCount < audience.minInteractions) {
          return false;
        }

        if (audience.maxInteractions !== undefined && interactionCount > audience.maxInteractions) {
          return false;
        }
      }

      // Additional criteria can be added here (location, categories, etc.)
      return true;
    } catch (error) {
      console.error('Error in checkAudienceCriteria:', error);
      return false;
    }
  }

  /**
   * Select variant based on weights
   */
  private selectVariant(variants: ABTestVariant[]): string | null {
    if (variants.length === 0) {
      return null;
    }

    const random = Math.random();
    let cumulativeWeight = 0;

    for (const variant of variants) {
      cumulativeWeight += variant.weight;
      if (random <= cumulativeWeight) {
        return variant.id;
      }
    }

    // Fallback to last variant
    return variants[variants.length - 1].id;
  }

  /**
   * Cache management
   */
  private getCachedUserAssignment(userId: string, testId: string): UserABTestAssignment | null {
    const now = Date.now();
    if (now - this.lastCacheUpdate > this.CACHE_DURATION) {
      return null; // Cache expired
    }

    const userAssignments = this.userAssignments.get(userId);
    if (!userAssignments) {
      return null;
    }

    return userAssignments.find(assignment => assignment.testId === testId) || null;
  }

  private updateUserAssignmentsCache(userId: string, assignment: UserABTestAssignment): void {
    const existing = this.userAssignments.get(userId) || [];
    const updated = existing.filter(a => a.testId !== assignment.testId);
    updated.push(assignment);
    this.userAssignments.set(userId, updated);
    this.lastCacheUpdate = Date.now();
  }

  /**
   * Create a new A/B test
   */
  async createTest(test: Omit<ABTest, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('ab_tests')
        .insert([{
          ...test,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select('id')
        .single();

      if (error) {
        console.error('Error creating A/B test:', error);
        return null;
      }

      console.log(`✅ Created A/B test: ${test.name} (${data.id})`);
      return data.id;
    } catch (error) {
      console.error('Error in createTest:', error);
      return null;
    }
  }

  /**
   * End an A/B test
   */
  async endTest(testId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('ab_tests')
        .update({
          is_active: false,
          end_date: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', testId);

      if (error) {
        console.error('Error ending A/B test:', error);
        return false;
      }

      console.log(`✅ Ended A/B test: ${testId}`);
      return true;
    } catch (error) {
      console.error('Error in endTest:', error);
      return false;
    }
  }
}

export const abTestingService = new ABTestingService();
