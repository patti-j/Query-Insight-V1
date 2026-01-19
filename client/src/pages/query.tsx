import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Sparkles, ChevronDown, ChevronUp, Database, XCircle, CheckCircle2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Default questions shown when no FAQ history exists
const DEFAULT_QUESTIONS = [
  { text: "Show jobs that are overdue", icon: "🔴" },
  { text: "Show jobs on hold with hold reasons", icon: "⏸️" },
  { text: "List jobs that are not scheduled", icon: "❌" },
  { text: "What jobs are scheduled for next week?", icon: "📅" },
  { text: "Show late jobs grouped by plant", icon: "🏭" },
  { text: "Top 10 jobs by quantity", icon: "📊" },
  { text: "Jobs with highest lateness days", icon: "⏰" },
  { text: "List all scheduled jobs", icon: "✅" },
  { text: "Which resources have work scheduled today?", icon: "⚙️" },
  { text: "Jobs scheduled to finish this month", icon: "🎯" },
];

// Columns to hide from results display (system-generated IDs)
const HIDDEN_COLUMNS = ['jobid', 'job_id', 'id'];

function isHiddenColumn(columnName: string): boolean {
  return HIDDEN_COLUMNS.includes(columnName.toLowerCase());
}

// Filter out hidden columns from a row
function filterRowColumns(row: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !isHiddenColumn(key))
  );
}

// Icons for FAQ questions (assigned based on content keywords)
function getQuestionIcon(question: string): string {
  const q = question.toLowerCase();
  if (q.includes('overdue') || q.includes('late')) return '🔴';
  if (q.includes('hold') || q.includes('pause')) return '⏸️';
  if (q.includes('fail') || q.includes('error')) return '❌';
  if (q.includes('week') || q.includes('schedule')) return '📅';
  if (q.includes('plant') || q.includes('facility')) return '🏭';
  if (q.includes('top') || q.includes('quantity') || q.includes('count')) return '📊';
  if (q.includes('lateness') || q.includes('time')) return '⏰';
  if (q.includes('finish') || q.includes('complete')) return '🎯';
  if (q.includes('resource') || q.includes('busy')) return '⚙️';
  if (q.includes('today') || q.includes('now')) return '📌';
  return '💡';
}

interface QueryResult {
  answer: string;
  sql: string;
  rows: any[];
  rowCount: number;
  isMock: boolean;
}

interface DiagnosticsResult {
  timestamp: string;
  totalTables: number;
  accessible: number;
  failed: number;
  tables: Array<{
    table: string;
    accessible: boolean;
    error: string | null;
  }>;
}

const MOCK_DATA = [
  { job_id: 'J001', job_name: 'Engine Assembly', status: 'In Progress', due_date: '2023-11-15', quantity: 50, plant: 'Plant A' },
  { job_id: 'J002', job_name: 'Chassis Welding', status: 'Completed', due_date: '2023-11-10', quantity: 20, plant: 'Plant B' },
  { job_id: 'J003', job_name: 'Paint Shop', status: 'Pending', due_date: '2023-11-20', quantity: 100, plant: 'Plant A' },
  { job_id: 'J004', job_name: 'Final Inspection', status: 'Scheduled', due_date: '2023-11-25', quantity: 50, plant: 'Plant C' },
  { job_id: 'J005', job_name: 'Packaging', status: 'On Hold', due_date: '2023-11-30', quantity: 200, plant: 'Plant B' },
];

export default function QueryPage() {
  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [faqQuestions, setFaqQuestions] = useState<{ text: string; icon: string }[]>(DEFAULT_QUESTIONS);
  const [showAllRows, setShowAllRows] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosticsResult | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isDevelopment, setIsDevelopment] = useState(true);

  // Fetch popular questions on mount and after each successful query
  const fetchPopularQuestions = async () => {
    try {
      const response = await fetch('/api/popular-questions');
      if (response.ok) {
        const data = await response.json();
        if (data.questions && data.questions.length > 0) {
          // Convert popular questions to display format with icons
          const faq = data.questions.map((q: { question: string; count: number }) => ({
            text: q.question,
            icon: getQuestionIcon(q.question),
          }));
          // Merge FAQ with defaults: FAQ first, then fill remaining slots with defaults
          const faqTexts = new Set(faq.map((q: { text: string }) => q.text.toLowerCase()));
          const remainingDefaults = DEFAULT_QUESTIONS.filter(
            d => !faqTexts.has(d.text.toLowerCase())
          );
          const merged = [...faq, ...remainingDefaults].slice(0, 10);
          setFaqQuestions(merged);
        }
      } else {
        // Fall back to defaults silently if API fails
        setFaqQuestions(DEFAULT_QUESTIONS);
      }
    } catch (err) {
      // Fall back to defaults silently
      setFaqQuestions(DEFAULT_QUESTIONS);
    }
  };

  useEffect(() => {
    fetchPopularQuestions();
    // Check if diagnostics is available (dev mode check)
    fetch('/api/db/diagnostics', { method: 'HEAD' })
      .then(res => setIsDevelopment(res.status !== 403))
      .catch(() => setIsDevelopment(false));
  }, []);

  const executeQuery = async (q: string) => {
    if (!q.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);
    setShowAllRows(false);
    setSubmittedQuestion(q.trim());

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });

      // Try to parse JSON, if it fails (HTML response), throw error to trigger fallback
      let data;
      try {
        const text = await response.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
           throw new Error(`Server response was not JSON: ${text.substring(0, 100)}...`);
        }
      } catch (e: any) {
        throw new Error(e.message || 'Failed to parse server response');
      }

      if (!response.ok) {
        // If server returns explicit error, throw it
        throw new Error(data.error || 'Query failed');
      }

      setResult(data);
      // Clear the query box and refresh FAQ after successful query
      setQuestion('');
      fetchPopularQuestions();
    } catch (err: any) {
      console.error("API Query Failed:", err);
      // Fallback to mock data if API fails (e.g. secrets not set)
      
      // Simple mock logic to return different results based on keywords
      let mockRows = [...MOCK_DATA];
      let answer = "Showing sample data (Backend connection failed or secrets missing).";
      let sql = "-- SQL generation unavailable (Mock Mode)\nSELECT * FROM jobs";

      const qLower = q.toLowerCase();
      if (qLower.includes('plant a')) {
        mockRows = MOCK_DATA.filter(row => row.plant === 'Plant A');
        answer = "Found 2 jobs for Plant A (Mock Data).";
        sql = "-- SQL generation unavailable (Mock Mode)\nSELECT * FROM jobs WHERE plant = 'Plant A'";
      } else if (qLower.includes('completed')) {
        mockRows = MOCK_DATA.filter(row => row.status === 'Completed');
        answer = "Found 1 completed job (Mock Data).";
        sql = "-- SQL generation unavailable (Mock Mode)\nSELECT * FROM jobs WHERE status = 'Completed'";
      } else if (qLower.includes('hold')) {
        mockRows = MOCK_DATA.filter(row => row.status === 'On Hold');
        answer = "Found 1 job on hold (Mock Data).";
        sql = "-- SQL generation unavailable (Mock Mode)\nSELECT * FROM jobs WHERE status = 'On Hold'";
      }

      const mockResult: QueryResult = {
        answer,
        sql,
        rows: mockRows,
        rowCount: mockRows.length,
        isMock: true
      };

      setResult(mockResult);
      // If it was a real error (not just missing backend), maybe show a toast or small indicator?
      // For now, the "Mock Mode" indicator in result is enough.
      setError(`Backend Error: ${err.message}. Showing mock data.`);
      
      setQuestion('');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    executeQuery(question);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (question.trim() && !loading) {
        executeQuery(question);
      }
    }
  };

  const runDiagnostics = async () => {
    setDiagnosticsLoading(true);
    setDiagnosticsResult(null);
    setShowDiagnostics(true);

    try {
      const response = await fetch('/api/db/diagnostics');
      
      if (response.ok) {
        const data = await response.json();
        setDiagnosticsResult(data);
      } else {
        const errorData = await response.json();
        setDiagnosticsResult({
          timestamp: new Date().toISOString(),
          totalTables: 0,
          accessible: 0,
          failed: 0,
          tables: [],
        });
        setError(`Diagnostics failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setError(`Failed to run diagnostics: ${err.message}`);
      setDiagnosticsResult({
        timestamp: new Date().toISOString(),
        totalTables: 0,
        accessible: 0,
        failed: 0,
        tables: [],
      });
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/10 p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-primary to-primary/70">
                <Sparkles className="h-8 w-8 text-primary-foreground" />
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Query Insight
              </h1>
            </div>
            <p className="text-muted-foreground mt-2 ml-14">
              Ask questions about your manufacturing planning data
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isDevelopment && (
              <Button
                variant="outline"
                size="sm"
                onClick={runDiagnostics}
                disabled={diagnosticsLoading}
                data-testid="button-diagnostics"
                className="gap-2"
                title="Check database table access"
              >
                {diagnosticsLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                DB Check
              </Button>
            )}
            <ThemeToggle />
          </div>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Ask a Question</span>
            </CardTitle>
            <CardDescription>
              Type a natural language question or click on one of the predefined questions below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <Textarea
                placeholder="What would you like to know about your manufacturing data?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-[100px] bg-background/50"
                data-testid="input-question"
              />
              <Button 
                type="submit" 
                disabled={loading || !question.trim()} 
                data-testid="button-submit"
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? 'Analyzing...' : 'Submit Query'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isDevelopment && showDiagnostics && diagnosticsResult && (
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Database Diagnostics
              </CardTitle>
              <CardDescription>
                Validation of access to publish.DASHt_* tables
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30" data-testid="badge-total-tables">
                  {diagnosticsResult.totalTables} tables found
                </Badge>
                <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30" data-testid="badge-accessible-tables">
                  {diagnosticsResult.accessible} accessible
                </Badge>
                {diagnosticsResult.failed > 0 && (
                  <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" data-testid="badge-failed-tables">
                    {diagnosticsResult.failed} failed
                  </Badge>
                )}
              </div>

              {diagnosticsResult.tables.length > 0 && (
                <div className="border border-border/50 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">Status</th>
                          <th className="px-4 py-3 text-left font-medium">Table Name</th>
                          <th className="px-4 py-3 text-left font-medium">Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnosticsResult.tables.map((table, idx) => (
                          <tr key={idx} className="border-t border-border/30 hover:bg-muted/30 transition-colors" data-testid={`row-diagnostics-${idx}`}>
                            <td className="px-4 py-3" data-testid={`status-${table.table}`}>
                              {table.accessible ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono" data-testid={`table-${table.table}`}>{table.table}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs" data-testid={`error-${table.table}`}>
                              {table.error || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground" data-testid="text-diagnostics-timestamp">
                Last checked: {new Date(diagnosticsResult.timestamp).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                System Notification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p data-testid="text-error">{error}</p>
            </CardContent>
          </Card>
        )}

        {result && (
          <div className="space-y-4">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Results
                </CardTitle>
                {submittedQuestion && (
                  <p className="text-sm text-muted-foreground italic mb-2" data-testid="text-submitted-question">
                    "{submittedQuestion}"
                  </p>
                )}
                <CardDescription data-testid="text-answer">{result.answer}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">SQL Query</Badge>
                    <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">{result.rowCount} rows</Badge>
                  </div>
                  <pre className="bg-muted/50 p-4 rounded-xl text-sm overflow-x-auto border border-border/30" data-testid="text-sql">
                    {result.sql}
                  </pre>
                </div>

                {result.rows.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">Data Preview</h3>
                      {result.rows.length > 10 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowAllRows(!showAllRows)}
                          data-testid="button-toggle-rows"
                        >
                          {showAllRows ? `Show First 10` : `Show All ${result.rows.length} Rows`}
                        </Button>
                      )}
                    </div>
                    <div className="border border-border/50 rounded-xl overflow-hidden">
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted sticky top-0 z-10 shadow-sm">
                            <tr>
                              {Object.keys(filterRowColumns(result.rows[0])).map((key) => (
                                <th key={key} className="px-4 py-3 text-left font-medium text-foreground/70">
                                  {key}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {(showAllRows ? result.rows : result.rows.slice(0, 10)).map((row, idx) => {
                              const filteredRow = filterRowColumns(row);
                              return (
                                <tr key={idx} className="border-t border-border/30 hover:bg-muted/30 transition-colors" data-testid={`row-result-${idx}`}>
                                  {Object.values(filteredRow).map((value: any, cellIdx) => (
                                    <td key={cellIdx} className="px-4 py-3">
                                      {value === null ? <span className="text-muted-foreground italic">null</span> : String(value)}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">
                      Showing {showAllRows ? result.rows.length : Math.min(10, result.rows.length)} of {result.rows.length} rows
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground/80">Quick Questions</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {faqQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => executeQuery(q.text)}
                disabled={loading}
                className="group relative p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover:bg-primary/10 hover:border-primary/50 transition-all duration-200 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid={`card-sample-question-${idx}`}
              >
                <span className="text-2xl mb-2 block">{q.icon}</span>
                <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground">
                  {q.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
