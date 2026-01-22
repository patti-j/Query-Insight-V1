/**
 * Date/Time Formatting Utilities for Query Results
 * 
 * Automatically detects and formats date/time columns in query results
 * while preserving raw values for sorting and exports.
 */

/**
 * Detects if a column name suggests it contains date/time data
 */
export function isDateTimeColumn(columnName: string): boolean {
  const normalizedName = columnName.toLowerCase();
  
  // Exclude columns that end with "days" - these are numeric day counts, not dates
  if (normalizedName.endsWith('days')) {
    return false;
  }
  
  // Exclude columns that contain "hours" - these are numeric hour values, not times
  if (normalizedName.includes('hours')) {
    return false;
  }
  
  const dateTimeKeywords = [
    'date',
    'time',
    'datetime',
    'timestamp',
    'created',
    'updated',
    'modified',
    'start',
    'end',
    'due',
    'schedule',
    'finish',
    'begin',
    'expire',
  ];
  
  return dateTimeKeywords.some(keyword => normalizedName.includes(keyword));
}

/**
 * Checks if a value is a valid date
 */
export function isValidDate(value: any): boolean {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Determines if a date value should display time component
 * Returns false if time is midnight (00:00:00), suggesting it's a date-only field
 */
export function shouldShowTime(value: string | Date): boolean {
  const date = new Date(value);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const milliseconds = date.getMilliseconds();
  
  // If time is exactly midnight, it's likely a date-only field
  return !(hours === 0 && minutes === 0 && seconds === 0 && milliseconds === 0);
}

/**
 * Formats a date value for human-readable display
 * @param value - The date value to format
 * @param includeTime - Whether to include time in the output
 * @returns Formatted date string
 */
export function formatDateTime(value: any, includeTime?: boolean): string {
  if (!isValidDate(value)) {
    return String(value);
  }
  
  const date = new Date(value);
  
  // Auto-detect if we should show time (if not explicitly specified)
  const showTime = includeTime !== undefined ? includeTime : shouldShowTime(value);
  
  // Format options for date with time
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  
  // Format options for date only
  const dateOnlyOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  };
  
  try {
    return date.toLocaleString('en-US', showTime ? dateTimeOptions : dateOnlyOptions);
  } catch (error) {
    // Fallback to ISO string if formatting fails
    return showTime ? date.toLocaleString() : date.toLocaleDateString();
  }
}

/**
 * Detects date/time columns in a dataset by analyzing column names and values
 * @param rows - Array of data rows
 * @returns Set of column names that contain date/time data
 */
export function detectDateTimeColumns(rows: any[]): Set<string> {
  const dateTimeColumns = new Set<string>();
  
  if (rows.length === 0) {
    return dateTimeColumns;
  }
  
  // Get column names from first row
  const columns = Object.keys(rows[0]);
  
  for (const column of columns) {
    // Check if column name suggests date/time
    const nameMatch = isDateTimeColumn(column);
    
    if (nameMatch) {
      // Verify by sampling values (check first 5 non-null values)
      let validDateCount = 0;
      let samplesChecked = 0;
      
      for (const row of rows) {
        if (samplesChecked >= 5) break;
        
        const value = row[column];
        if (value !== null && value !== undefined && value !== '') {
          samplesChecked++;
          if (isValidDate(value)) {
            validDateCount++;
          }
        }
      }
      
      // If at least 80% of sampled values are valid dates, mark as date column
      if (samplesChecked > 0 && validDateCount / samplesChecked >= 0.8) {
        dateTimeColumns.add(column);
      }
    }
  }
  
  return dateTimeColumns;
}

/**
 * Formats a cell value for display, applying date formatting if applicable
 * @param value - The raw cell value
 * @param columnName - The column name
 * @param dateTimeColumns - Set of columns identified as date/time columns
 * @returns Formatted value for display
 */
export function formatCellValue(
  value: any,
  columnName: string,
  dateTimeColumns: Set<string>
): string {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return '';
  }
  
  // If this is a date/time column, format it
  if (dateTimeColumns.has(columnName) && isValidDate(value)) {
    return formatDateTime(value);
  }
  
  // Otherwise return string representation
  return String(value);
}
