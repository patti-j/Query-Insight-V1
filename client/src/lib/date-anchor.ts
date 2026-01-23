/**
 * Utilities for transforming date-relative language into concrete dates
 * based on the dataset's publish date anchor
 */

/**
 * Formats a date as YYYY-MM-DD for SQL queries
 */
function formatDateForSQL(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Gets the start of week (Monday) for a given date
 */
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  return new Date(d.setDate(diff));
}

/**
 * Gets the end of week (Sunday) for a given date
 */
function getWeekEnd(date: Date): Date {
  const weekStart = getWeekStart(date);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return weekEnd;
}

/**
 * Adds days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Checks if a query contains relative date language
 */
export function hasRelativeDateLanguage(query: string): boolean {
  const relativeDatePatterns = [
    /\btoday\b/i,
    /\bthis week\b/i,
    /\bnext week\b/i,
    /\blast week\b/i,
    /\bdue today\b/i,
    /\bpublish date\b/i,
    /\bpublish week\b/i,
  ];
  
  return relativeDatePatterns.some(pattern => pattern.test(query));
}

/**
 * Transforms relative date language into concrete dates based on anchor date
 * 
 * @param query - The original query text
 * @param anchorDate - The publish date to use as "today"
 * @returns Transformed query with concrete dates
 */
export function transformRelativeDates(query: string, anchorDate: Date): string {
  let transformed = query;
  
  const anchorDateStr = formatDateForSQL(anchorDate);
  
  // Calculate week boundaries
  const weekStart = getWeekStart(anchorDate);
  const weekEnd = getWeekEnd(anchorDate);
  const nextWeekStart = addDays(weekStart, 7);
  const nextWeekEnd = addDays(weekEnd, 7);
  const lastWeekStart = addDays(weekStart, -7);
  const lastWeekEnd = addDays(weekEnd, -7);
  
  // Transform patterns (order matters - more specific first)
  // Keep transformations simple and clean - no parenthetical explanations
  // that could confuse the LLM's natural language processing
  const transformations = [
    // "due today" / "due on publish date" -> "due on YYYY-MM-DD"
    {
      pattern: /\bdue (?:today|on publish date)\b/gi,
      replacement: `due on ${anchorDateStr}`
    },
    // "scheduled for today" / "scheduled on publish date" -> "scheduled on YYYY-MM-DD"
    {
      pattern: /\bscheduled (?:for|on) (?:today|publish date)\b/gi,
      replacement: `scheduled on ${anchorDateStr}`
    },
    // "on publish date" / "today" (standalone) -> "on YYYY-MM-DD"
    {
      pattern: /\b(?:on publish date|today)\b/gi,
      replacement: `on ${anchorDateStr}`
    },
    // "in publish week" / "this week" -> "between YYYY-MM-DD and YYYY-MM-DD"
    {
      pattern: /\b(?:in publish week|this week)\b/gi,
      replacement: `between ${formatDateForSQL(weekStart)} and ${formatDateForSQL(weekEnd)}`
    },
    // "next week" -> "between YYYY-MM-DD and YYYY-MM-DD"
    {
      pattern: /\bnext week\b/gi,
      replacement: `between ${formatDateForSQL(nextWeekStart)} and ${formatDateForSQL(nextWeekEnd)}`
    },
    // "last week" -> "between YYYY-MM-DD and YYYY-MM-DD"
    {
      pattern: /\blast week\b/gi,
      replacement: `between ${formatDateForSQL(lastWeekStart)} and ${formatDateForSQL(lastWeekEnd)}`
    },
  ];
  
  for (const { pattern, replacement } of transformations) {
    transformed = transformed.replace(pattern, replacement);
  }
  
  return transformed;
}
export function getEffectiveToday(): Date {
  // Vite exposes PROD boolean at build time
  if (import.meta.env.PROD) return new Date();

  const fixed = (import.meta.env.VITE_DEV_FIXED_TODAY as string) || "2024-01-01";
  // Parse as local midnight (not UTC) to avoid timezone display issues
  const [year, month, day] = fixed.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatEffectiveTodayLabel(): string {
  if (import.meta.env.PROD) return "";
  const d = getEffectiveToday();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `Effective Today = ${yyyy}-${mm}-${dd} (dev override)`;
}
