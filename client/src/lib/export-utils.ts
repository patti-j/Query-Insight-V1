import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/**
 * Export data to CSV format and trigger download
 */
export function exportToCSV(data: any[], filename: string = 'query-results.csv') {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  const csv = Papa.unparse(data);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  downloadFile(blob, filename);
}

/**
 * Export data to Excel format and trigger download
 */
export function exportToExcel(data: any[], filename: string = 'query-results.xlsx') {
  if (!data || data.length === 0) {
    throw new Error('No data to export');
  }

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Query Results');

  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadFile(blob, filename);
}

/**
 * Trigger file download in browser
 */
function downloadFile(blob: Blob, filename: string) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
