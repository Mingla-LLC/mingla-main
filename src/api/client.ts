import { supabase } from '@/integrations/supabase/client';

// API client that attaches auth headers automatically
class APIClient {
  private baseURL = '';

  async request(endpoint: string, options: RequestInit = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const error = new Error(errorData.message || `HTTP ${response.status}`);
      (error as any).response = {
        status: response.status,
        data: errorData,
      };
      throw error;
    }

    return response.json();
  }

  async get(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  async post(endpoint: string, data?: any, options?: RequestInit) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put(endpoint: string, data?: any, options?: RequestInit) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete(endpoint: string, options?: RequestInit) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new APIClient();