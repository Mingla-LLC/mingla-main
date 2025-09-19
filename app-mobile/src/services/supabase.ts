import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = 'https://gqnoajqerqhnvulmnyvv.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxbm9hanFlcnFobnZ1bG1ueXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MDUyNzIsImV4cCI6MjA3MzA4MTI3Mn0.p4yi9yD2RWfJ2HN4DD-dgrvXnyzhJi3g2YCouSK-hbo';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    debug: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
