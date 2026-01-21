/**
 * Static Quick Questions Configuration
 * Maps Power BI report IDs to their preset quick questions
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
 * Questions are displayed in the order defined here (6-10 per scope)
 */
export const REPORT_QUICK_QUESTIONS: Record<string, QuickQuestion[]> = {
  'capacity-plan': [
    { text: 'Show all resources with demand and capacity', icon: '📊' },
    { text: 'Which resources have the highest demand?', icon: '🔥' },
    { text: 'Show resources by planning area', icon: '🏭' },
    { text: 'List all bottleneck resources', icon: '🚧' },
    { text: 'Show shift schedules by resource', icon: '📅' },
    { text: 'Show resources with capacity hours', icon: '⚙️' },
    { text: 'Show resource actuals', icon: '📈' },
    { text: 'Compare demand vs capacity by resource', icon: '⚖️' },
  ],
  
  'production-planning': [
    { text: 'Show all scheduled jobs', icon: '📋' },
    { text: 'Show overdue jobs', icon: '🔴' },
    { text: 'Show jobs on hold', icon: '⏸️' },
    { text: 'Show jobs by priority', icon: '⭐' },
    { text: 'Show operations by resource', icon: '⚙️' },
    { text: 'Show jobs scheduled to start this week', icon: '🚀' },
    { text: 'Show jobs scheduled to complete this week', icon: '✅' },
    { text: 'Show open sales orders', icon: '📦' },
    { text: 'Show current inventory levels', icon: '📊' },
  ],
  
  'finance': [
    { text: 'Show sales orders with amounts', icon: '💰' },
    { text: 'Show items with unit prices', icon: '💵' },
    { text: 'Show inventory costs by item', icon: '📦' },
    { text: 'Show sales by customer', icon: '👥' },
    { text: 'Show high-value sales orders', icon: '📈' },
    { text: 'Show items by cost', icon: '💲' },
    { text: 'Show materials with costs', icon: '🏭' },
    { text: 'Show sales order line details', icon: '📋' },
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
