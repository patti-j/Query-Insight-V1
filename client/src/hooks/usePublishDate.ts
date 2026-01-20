import { useQuery } from '@tanstack/react-query';

interface PublishDateResponse {
  ok: boolean;
  lastUpdate: string | null;
}

/**
 * Hook to fetch and cache the latest publish date from the database
 * This is used as an anchor for date-relative queries in demo data
 */
export function usePublishDate() {
  return useQuery({
    queryKey: ['publish-date'],
    queryFn: async (): Promise<Date> => {
      const response = await fetch('/api/last-update');
      if (!response.ok) {
        throw new Error('Failed to fetch publish date');
      }
      
      const data: PublishDateResponse = await response.json();
      
      if (data.ok && data.lastUpdate) {
        return new Date(data.lastUpdate);
      }
      
      // Fallback to current date if no publish date available
      return new Date();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    retry: 1,
  });
}
