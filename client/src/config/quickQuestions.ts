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
    { text: 'List all resources', icon: '📋' },
    { text: 'Show resources by department', icon: '🏭' },
    { text: 'Show resources by plant', icon: '📍' },
    { text: 'Show bottleneck resources', icon: '🚧' },
    { text: 'Show historical KPIs', icon: '📈' },
    { text: 'Show resources with their workcenter and cell', icon: '⚙️' },
    { text: 'Show resource types', icon: '🔧' },
    { text: 'Count resources by department', icon: '📊' },
  ],
  
  'production-planning': [
    { text: 'Show all scheduled jobs', icon: '📋' },
    { text: 'Show overdue jobs', icon: '🔴' },
    { text: 'Show jobs on hold', icon: '⏸️' },
    { text: 'Show jobs by priority', icon: '⭐' },
    { text: 'Show open sales orders', icon: '📦' },
    { text: 'Show current inventory levels', icon: '📊' },
    { text: 'Show materials list', icon: '🏭' },
    { text: 'Show job products', icon: '📋' },
  ],
  
  'finance': [
    { text: 'Show sales orders with amounts', icon: '💰' },
    { text: 'Show items with unit prices', icon: '💵' },
    { text: 'Show inventory costs', icon: '📦' },
    { text: 'Show sales by customer', icon: '👥' },
    { text: 'Show high-value sales orders', icon: '📈' },
    { text: 'Show total sales amount by customer', icon: '💲' },
    { text: 'Show sales order quantities', icon: '📋' },
    { text: 'Show top 10 sales orders by amount', icon: '🏆' },
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
