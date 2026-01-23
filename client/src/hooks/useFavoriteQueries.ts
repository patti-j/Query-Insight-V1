import { useState, useEffect, useCallback } from 'react';

export interface FavoriteQuery {
  id: string;
  question: string;
  mode: string;
  savedAt: string;
}

const STORAGE_KEY = 'query-insight-favorites';

export function useFavoriteQueries() {
  const [favorites, setFavorites] = useState<FavoriteQuery[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setFavorites(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to parse favorites:', e);
      }
    }
  }, []);

  const saveFavorites = useCallback((newFavorites: FavoriteQuery[]) => {
    setFavorites(newFavorites);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newFavorites));
  }, []);

  const addFavorite = useCallback((question: string, mode: string) => {
    const normalizedQ = question.trim().toLowerCase();
    const exists = favorites.some(f => f.question.trim().toLowerCase() === normalizedQ && f.mode === mode);
    if (exists) return;
    
    const newFavorite: FavoriteQuery = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      question,
      mode,
      savedAt: new Date().toISOString(),
    };
    saveFavorites([newFavorite, ...favorites]);
  }, [favorites, saveFavorites]);

  const removeFavorite = useCallback((id: string) => {
    saveFavorites(favorites.filter(f => f.id !== id));
  }, [favorites, saveFavorites]);

  const isFavorite = useCallback((question: string, mode: string) => {
    const normalizedQ = question.trim().toLowerCase();
    return favorites.some(f => f.question.trim().toLowerCase() === normalizedQ && f.mode === mode);
  }, [favorites]);

  const toggleFavorite = useCallback((question: string, mode: string) => {
    const normalizedQ = question.trim().toLowerCase();
    const existing = favorites.find(f => f.question.trim().toLowerCase() === normalizedQ && f.mode === mode);
    if (existing) {
      removeFavorite(existing.id);
    } else {
      addFavorite(question, mode);
    }
  }, [favorites, addFavorite, removeFavorite]);

  return {
    favorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    toggleFavorite,
  };
}
