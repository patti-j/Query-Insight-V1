import { useState, useEffect, useCallback } from 'react';

interface DevUser {
  userId: string;
  username: string;
}

const STORAGE_KEY = 'query-insight-dev-user';

export function useDevUser() {
  const [devUser, setDevUserState] = useState<DevUser | null>(null);
  const [users, setUsers] = useState<DevUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (import.meta.env.PROD) {
      setLoading(false);
      return;
    }
    
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setDevUserState(JSON.parse(stored));
      } catch (e) {
        console.error('[dev-user] Failed to parse stored user:', e);
      }
    }
    
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/admin/users');
      const data = await response.json();
      const userList = (data.users || []).map((u: any) => ({
        userId: u.userId,
        username: u.username,
      }));
      setUsers(userList);
    } catch (error) {
      console.error('[dev-user] Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const setDevUser = useCallback((user: DevUser | null) => {
    setDevUserState(user);
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearDevUser = useCallback(() => {
    setDevUserState(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    devUser,
    users,
    loading,
    setDevUser,
    clearDevUser,
    refreshUsers: fetchUsers,
  };
}
