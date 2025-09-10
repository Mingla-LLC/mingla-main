import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import AuthGuard from "./components/AuthGuard";
import Index from "./pages/Index";
import Home from "./pages/Home"; 
import Explore from "./pages/Explore";
import Boards from "./pages/Boards";
import Saved from "./pages/Saved";
import Profile from "./pages/Profile";
import Profiles from "./pages/Profiles";
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={
          <AuthGuard>
            <Layout>
              <Home />
            </Layout>
          </AuthGuard>
        } />
        <Route path="/explore" element={
          <AuthGuard>
            <Layout>
              <Explore />
            </Layout>
          </AuthGuard>
        } />
        <Route path="/boards" element={
          <AuthGuard>
            <Layout>
              <Boards />
            </Layout>
          </AuthGuard>
        } />
        <Route path="/saved" element={
          <AuthGuard>
            <Layout>
              <Saved />
            </Layout>
          </AuthGuard>
        } />
        <Route path="/profile" element={
          <AuthGuard>
            <Layout>
              <Profile />
            </Layout>
          </AuthGuard>
        } />
        <Route path="/profiles" element={
          <AuthGuard>
            <Layout>
              <Profiles />
            </Layout>
          </AuthGuard>
        } />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
