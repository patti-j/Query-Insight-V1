/**
 * Static Quick Questions Configuration
 * Universal questions that work across all data types
 */

export interface QuickQuestion {
  text: string;
  icon: string;
}

/**
 * Universal quick questions displayed on the main page
 * Selected to cover common use cases across planning, capacity, and finance
 */
export const QUICK_QUESTIONS: QuickQuestion[] = [
  { text: 'Show jobs that are overdue', icon: '🔴' },
  { text: 'Show demand hours by resource', icon: '📈' },
  { text: 'List open sales orders', icon: '📦' },
  { text: 'Which resources are over capacity?', icon: '⚡' },
  { text: 'List jobs on hold', icon: '⏸️' },
];

/**
 * Get all quick questions (universal list)
 */
export function getQuickQuestions(): QuickQuestion[] {
  return QUICK_QUESTIONS;
}
