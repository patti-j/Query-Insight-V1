/**
 * Static Quick Questions Configuration
 * Maps Power BI report IDs to their preset quick questions
 * Based on scope_manifest_two_tier for accurate scope alignment
 */

export interface QuickQuestion {
  text: string;
  icon: string;
}

export interface ReportQuickQuestions {
  reportId: string;
  questions: QuickQuestion[];
}

/**
 * Quick questions for each Power BI report scope
 * Questions are displayed in the order defined here (6-8 per scope)
 */
export const REPORT_QUICK_QUESTIONS: Record<string, QuickQuestion[]> = {
  'capacity-plan': [
    { text: 'Where are we over capacity next 2 weeks by resource?', icon: '📊' },
    { text: 'Top 10 constrained resources next week', icon: '🚧' },
    { text: 'Show capacity vs demand by day for the next 14 days', icon: '📈' },
    { text: 'Which shifts are most overloaded this week?', icon: '⚙️' },
    { text: 'Idle vs loaded hours by resource for last 7 days', icon: '⏱️' },
    { text: 'Compare current shifts vs last publish shifts', icon: '🔄' },
    { text: 'List all resources', icon: '📋' },
    { text: 'Show bottleneck resources', icon: '🔥' },
  ],
  
  'production-planning': [
    { text: 'Which jobs are predicted late this month?', icon: '🔴' },
    { text: 'Top bottleneck operations by resource', icon: '🚧' },
    { text: 'Overdue jobs count by plant and priority', icon: '📊' },
    { text: 'Show jobs with longest predicted lateness', icon: '⏰' },
    { text: 'Which operations are blocked by predecessors?', icon: '🔗' },
    { text: 'What changed between last publish and current plan?', icon: '🔄' },
    { text: 'Show overdue jobs', icon: '⚠️' },
    { text: 'Show jobs on hold', icon: '⏸️' },
  ],
  
  'finance': [
    { text: 'Total sales orders value this month by customer', icon: '💰' },
    { text: 'Inventory adjustments total by category last 30 days', icon: '📦' },
    { text: 'Net inventory balance by item and plant', icon: '📊' },
    { text: 'Top purchase orders by spend next 30 days', icon: '💳' },
    { text: 'Material consumption trend by item', icon: '📉' },
    { text: 'Show KPI trends over time', icon: '📈' },
    { text: 'Show sales orders with amounts', icon: '💵' },
    { text: 'Show inventory costs', icon: '🏭' },
  ],
};

/**
 * Get quick questions for a specific report
 * Returns an empty array if no questions are configured for the report
 */
export function getQuickQuestionsForReport(reportId: string): QuickQuestion[] {
  return REPORT_QUICK_QUESTIONS[reportId] || [];
}

/**
 * Check if a report has quick questions configured
 */
export function hasQuickQuestions(reportId: string): boolean {
  return reportId in REPORT_QUICK_QUESTIONS && REPORT_QUICK_QUESTIONS[reportId].length > 0;
}
