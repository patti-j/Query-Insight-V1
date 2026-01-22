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
    { text: 'List all resources with their capacity hours', icon: '📊' },
    { text: 'Show demand hours by resource', icon: '📈' },
    { text: 'Total demand hours by department', icon: '🏭' },
    { text: 'List resources by workcenter', icon: '⚙️' },
    { text: 'Show resources by plant', icon: '🏢' },
  ],
  
  'production-planning': [
    { text: 'List overdue jobs', icon: '🔴' },
    { text: 'Show jobs by priority', icon: '📊' },
    { text: 'Count jobs by plant', icon: '🏭' },
    { text: 'List jobs on hold', icon: '⏸️' },
    { text: 'Show late jobs by customer', icon: '👥' },
  ],
  
  'finance': [
    { text: 'List open sales orders', icon: '📦' },
    { text: 'Show sales orders by customer', icon: '👥' },
    { text: 'Total ordered quantity by item', icon: '📊' },
    { text: 'List overdue sales orders', icon: '⚠️' },
    { text: 'Show purchase orders by supplier', icon: '🚚' },
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
