import { useState, useEffect, useCallback } from 'react';

export interface PinnedQueryFilters {
  planningArea: string | null;
  scenarioId: string | null;
  plant: string | null;
}

export interface PinnedQueryResult {
  rows: any[];
  rowCount: number;
  sql: string;
  answer: string;
}

export interface PinnedItem {
  id: string;
  question: string;
  filters: PinnedQueryFilters;
  visualizationType: 'table' | 'chart';
  chartType?: 'bar' | 'line' | 'pie';
  pinnedAt: string;
  lastRunAt: string | null;
  lastResult: PinnedQueryResult | null;
}

const STORAGE_KEY = 'query-insight-pinned-dashboard';
const MAX_ROWS_PER_ITEM = 20;
const MAX_PINNED_ITEMS = 20;

export function usePinnedDashboard() {
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setPinnedItems(JSON.parse(stored));
      } catch (e) {
        console.error('[pinned-dashboard] Failed to parse:', e);
      }
    }
  }, []);

  const savePinnedItems = useCallback((items: PinnedItem[]) => {
    setPinnedItems(items);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, []);

  const addPinnedItem = useCallback((
    question: string,
    filters: PinnedQueryFilters,
    visualizationType: 'table' | 'chart' = 'table',
    chartType?: 'bar' | 'line' | 'pie',
    result?: PinnedQueryResult
  ): 'success' | 'already_pinned' | 'max_reached' => {
    const normalizedQ = question.trim().toLowerCase();
    const exists = pinnedItems.some(p => 
      p.question.trim().toLowerCase() === normalizedQ &&
      JSON.stringify(p.filters) === JSON.stringify(filters)
    );
    if (exists) return 'already_pinned';

    if (pinnedItems.length >= MAX_PINNED_ITEMS) {
      console.warn('[pinned-dashboard] Max pinned items reached');
      return 'max_reached';
    }

    const truncatedResult = result ? {
      ...result,
      rows: result.rows.slice(0, MAX_ROWS_PER_ITEM)
    } : null;

    const newItem: PinnedItem = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      question,
      filters,
      visualizationType,
      chartType,
      pinnedAt: new Date().toISOString(),
      lastRunAt: result ? new Date().toISOString() : null,
      lastResult: truncatedResult,
    };

    savePinnedItems([newItem, ...pinnedItems]);
    return 'success';
  }, [pinnedItems, savePinnedItems]);

  const removePinnedItem = useCallback((id: string) => {
    savePinnedItems(pinnedItems.filter(p => p.id !== id));
  }, [pinnedItems, savePinnedItems]);

  const updatePinnedItemResult = useCallback((id: string, result: PinnedQueryResult) => {
    const truncatedResult = {
      ...result,
      rows: result.rows.slice(0, MAX_ROWS_PER_ITEM)
    };

    const updated = pinnedItems.map(p => 
      p.id === id 
        ? { ...p, lastResult: truncatedResult, lastRunAt: new Date().toISOString() }
        : p
    );
    savePinnedItems(updated);
  }, [pinnedItems, savePinnedItems]);

  const updateVisualizationType = useCallback((
    id: string, 
    visualizationType: 'table' | 'chart',
    chartType?: 'bar' | 'line' | 'pie'
  ) => {
    const updated = pinnedItems.map(p => 
      p.id === id 
        ? { ...p, visualizationType, chartType }
        : p
    );
    savePinnedItems(updated);
  }, [pinnedItems, savePinnedItems]);

  const isPinned = useCallback((question: string, filters: PinnedQueryFilters): boolean => {
    const normalizedQ = question.trim().toLowerCase();
    return pinnedItems.some(p => 
      p.question.trim().toLowerCase() === normalizedQ &&
      JSON.stringify(p.filters) === JSON.stringify(filters)
    );
  }, [pinnedItems]);

  const reorderPinnedItems = useCallback((fromIndex: number, toIndex: number) => {
    const items = [...pinnedItems];
    const [removed] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, removed);
    savePinnedItems(items);
  }, [pinnedItems, savePinnedItems]);

  return {
    pinnedItems,
    addPinnedItem,
    removePinnedItem,
    updatePinnedItemResult,
    updateVisualizationType,
    isPinned,
    reorderPinnedItems,
  };
}
