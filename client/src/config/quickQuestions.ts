/**
 * Static Quick Questions Configuration
 * Maps Power BI report IDs to their preset quick questions
 * Based on ChatGPT scope manifest for accurate scope alignment
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
 * Questions are displayed in the order defined here (6 per scope)
 */
export const REPORT_QUICK_QUESTIONS: Record<string, QuickQuestion[]> = {
  'capacity-plan': [
    { text: 'Where are we over capacity next 2 weeks by resource?', icon: '📊' },
    { text: 'Top 10 constrained resources next week (demand > capacity)', icon: '🚧' },
    { text: 'Show capacity vs demand by day for the next 14 days', icon: '📈' },
    { text: 'Which shifts are most overloaded this week?', icon: '⚙️' },
    { text: 'Idle vs loaded hours by resource for last 7 days', icon: '⏱️' },
    { text: 'Compare current shifts vs last publish shifts', icon: '🔄' },
  ],
  
  'production-planning': [
    { text: 'Which jobs are predicted late this month?', icon: '🔴' },
    { text: 'Top bottleneck operations by resource/workcenter', icon: '🚧' },
    { text: 'Overdue jobs count by plant and priority', icon: '📊' },
    { text: 'Show jobs with longest predicted lateness', icon: '⏰' },
    { text: 'Which operations are blocked by predecessors?', icon: '🔗' },
    { text: 'What changed between last publish and current plan?', icon: '🔄' },
  ],
  
  'finance': [
    { text: 'Total sales order demand qty this month by customer (Production scenario)', icon: '💰' },
    { text: 'What sales orders are overdue (Production scenario)?', icon: '⚠️' },
    { text: 'Compare Production vs What-If demand qty next 30 days', icon: '🔄' },
    { text: 'Inventory adjustments total last 30 days', icon: '📦' },
    { text: 'Net inventory balance by item and plant', icon: '📊' },
    { text: 'Top purchase orders by qty next 30 days', icon: '💳' },
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
