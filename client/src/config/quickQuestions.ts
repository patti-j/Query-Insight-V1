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
 * Quick questions for each Power BI report
 * Questions are displayed in the order defined here
 */
export const REPORT_QUICK_QUESTIONS: Record<string, QuickQuestion[]> = {
  'capacity-plan': [
    { text: 'Show resource demand for publish week', icon: '📅' },
    { text: 'Show resource capacity for publish week', icon: '📊' },
    { text: 'Which resources are over capacity in publish week?', icon: '🔴' },
    { text: 'Show resource actuals for publish week', icon: '📈' },
    { text: 'Show demand vs capacity by day (publish week)', icon: '⚖️' },
    { text: 'Which resources have the highest demand in publish week?', icon: '🔥' },
    { text: 'Show unfulfilled demand by resource (publish week)', icon: '⚠️' },
  ],
  
  'production-planning': [
    { text: 'Show jobs scheduled on publish date', icon: '📌' },
    { text: 'Show jobs starting in publish week', icon: '🚀' },
    { text: 'Show jobs completing in publish week', icon: '✅' },
    { text: 'Show overdue jobs', icon: '🔴' },
    { text: 'Show jobs by priority', icon: '⭐' },
    { text: 'Show operations scheduled on publish date', icon: '⚙️' },
    { text: 'Show jobs on hold', icon: '⏸️' },
  ],
  
  'dispatch-list': [
    { text: 'Show jobs ready for dispatch', icon: '🚀' },
    { text: 'Show operations ready to start', icon: '▶️' },
    { text: 'Show operations scheduled on publish date', icon: '📌' },
    { text: 'Show overdue operations', icon: '🔴' },
    { text: 'Show operations by resource', icon: '⚙️' },
    { text: 'Show operations by priority', icon: '⭐' },
  ],
  
  'finance': [
    { text: 'Show work order costs by job', icon: '💰' },
    { text: 'Show production cost by resource', icon: '💵' },
    { text: 'Show completed jobs with costs', icon: '✅' },
    { text: 'Show cost by date', icon: '📅' },
    { text: 'Show highest cost jobs', icon: '📈' },
    { text: 'Show cost trends over time', icon: '📊' },
  ],
  
  'customer-analysis': [
    { text: 'Show jobs by customer', icon: '👥' },
    { text: 'Show open jobs by customer', icon: '📋' },
    { text: 'Show overdue jobs by customer', icon: '🔴' },
    { text: 'Show order volume by customer', icon: '📊' },
    { text: 'Show customers with late orders', icon: '⏰' },
    { text: 'Show jobs scheduled for each customer', icon: '📅' },
  ],
  
  'inventories': [
    { text: 'Show current inventory levels', icon: '📦' },
    { text: 'Show items below safety stock', icon: '⚠️' },
    { text: 'Show inventory adjustments', icon: '🔄' },
    { text: 'Show net inventory balance by item', icon: '⚖️' },
    { text: 'Show inventory trends over time', icon: '📈' },
    { text: 'Show items with recent changes', icon: '🔔' },
  ],
  
  'sales-orders': [
    { text: 'Show open sales orders', icon: '📋' },
    { text: 'Show sales orders due in publish week', icon: '📅' },
    { text: 'Show overdue sales orders', icon: '🔴' },
    { text: 'Show sales orders by customer', icon: '👥' },
    { text: 'Show sales orders by priority', icon: '⭐' },
    { text: 'Show recent sales orders', icon: '🆕' },
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
