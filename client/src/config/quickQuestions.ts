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
    { text: 'Where are we over capacity by resource?', icon: '📊' },
    { text: 'Top 10 constrained resources (demand > capacity)', icon: '🚧' },
    { text: 'Show capacity vs demand by resource', icon: '📈' },
    { text: 'Which shifts are most overloaded?', icon: '⚙️' },
    { text: 'Idle vs loaded hours by resource', icon: '⏱️' },
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
    { text: 'Total sales order revenue this month (Production)', icon: '💰' },
    { text: 'Open demand quantity by customer', icon: '📦' },
    { text: 'What sales orders are overdue?', icon: '⚠️' },
    { text: 'Revenue at risk (overdue open orders)', icon: '🔥' },
    { text: 'Compare Production vs What-If demand next 30 days', icon: '🔄' },
    { text: 'Orders on hold and hold reasons', icon: '⏸️' },
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
