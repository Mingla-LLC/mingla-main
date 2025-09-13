import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { UserPlus, Loader2 } from 'lucide-react';
import { useUsers, type PublicUser } from '@/hooks/useUsers';
import { cn } from '@/lib/utils';

interface UserSearchProps {
  onSelectUser: (user: PublicUser) => void;
  placeholder?: string;
  className?: string;
}

export const UserSearch: React.FC<UserSearchProps> = ({
  onSelectUser,
  placeholder = "Enter username or email",
  className
}) => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const { searchUsers, getDisplayName, getUserInitials } = useUsers();
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const searchForUsers = async () => {
      if (query.trim().length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setIsSearching(true);
      try {
        const users = await searchUsers(query);
        setSuggestions(users);
        setShowSuggestions(users.length > 0);
      } finally {
        setIsSearching(false);
      }
    };

    const debounceTimer = setTimeout(searchForUsers, 300);
    return () => clearTimeout(debounceTimer);
  }, [query, searchUsers]);

  // Handle clicks outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectUser = (user: PublicUser) => {
    onSelectUser(user);
    setQuery('');
    setSuggestions([]);
    setShowSuggestions(false);
  };

  return (
    <div ref={searchRef} className={cn("relative", className)}>
      <div className="relative">
        <Input
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          className="pr-10"
        />
        {isSearching && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      
      <p className="text-xs text-muted-foreground mt-1">
        Search by username or email to find friends
      </p>

      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-background border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {suggestions.map((user) => (
            <button
              key={user.id}
              onClick={() => handleSelectUser(user)}
              className="w-full flex items-center gap-3 p-3 hover:bg-muted transition-colors text-left"
            >
              <Avatar className="h-10 w-10">
                {user.avatar_url && (
                  <AvatarImage src={user.avatar_url} alt={getDisplayName(user)} />
                )}
                <AvatarFallback>{getUserInitials(user)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{getDisplayName(user)}</p>
                <p className="text-sm text-muted-foreground truncate">@{user.username}</p>
              </div>
              <UserPlus className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};