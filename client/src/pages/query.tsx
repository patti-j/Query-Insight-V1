import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertCircle, Sparkles, ChevronDown, ChevronUp, Database, XCircle, CheckCircle2, Download, ThumbsUp, ThumbsDown, Lightbulb, BarChart3, Heart, Trash2 } from 'lucide-react';
import { Link } from 'wouter';
import { ThemeToggle } from '@/components/theme-toggle';
import { ResultChart } from '@/components/result-chart';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exportToCSV, exportToExcel } from '@/lib/export-utils';
import { detectDateTimeColumns, formatCellValue } from '@/lib/date-formatter';
import { getQuickQuestionsForReport, type QuickQuestion } from '@/config/quickQuestions';
import { usePublishDate } from '@/hooks/usePublishDate';
import { transformRelativeDates, hasRelativeDateLanguage, getEffectiveToday } from '@/lib/date-anchor';
import { useFavoriteQueries } from '@/hooks/useFavoriteQueries';

const APP_VERSION = '1.2.0'; // Date formatting + mode-specific schema optimization

// Columns to hide from results display (system-generated IDs are not user-friendly)
const HIDDEN_ID_PATTERNS = [
  /^id$/i,
  /id$/i,  // Any column ending in "Id" (ResourceId, JobId, etc.)
  /_id$/i, // Any column ending in "_id"
];

function isHiddenColumn(columnName: string): boolean {
  return HIDDEN_ID_PATTERNS.some(pattern => pattern.test(columnName));
}

// Filter out hidden columns from a row
function filterRowColumns(row: Record<string, any>): Record<string, any> {
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => !isHiddenColumn(key))
  );
}

// Format table name by stripping publish.DASHt_ prefix
function formatTableName(fullTableName: string): string {
  // Remove 'publish.' prefix if present
  let tableName = fullTableName.replace(/^publish\./i, '');
  // Remove 'DASHt_' prefix if present
  tableName = tableName.replace(/^DASHt_/i, '');
  return tableName;
}

interface QueryResult {
  answer: string;
  sql: string;
  rows: any[];
  rowCount: number;
  isMock: boolean;
  suggestions?: string[];
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

interface SemanticMode {
  id: string;
  name: string;
  description: string;
  tables: string[];
  default: boolean;
  schemaImplemented?: boolean;
  commonFields?: string[];
  keywords?: string[];
  available?: boolean;
  tablesFound?: number;
  tablesExpected?: number;
  availableTables?: string[];
  missingTables?: string[];
  warning?: string;
}

interface ScopeMismatch {
  detectedScope: string;
  currentScope: string;
  question: string;
}

interface SemanticCatalog {
  modes: SemanticMode[];
  version: string;
  lastUpdated: string;
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
  const [faqQuestions, setFaqQuestions] = useState<QuickQuestion[]>([]);
  const [showAllRows, setShowAllRows] = useState(false);
  const [showSql, setShowSql] = useState(false);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsResult, setDiagnosticsResult] = useState<DiagnosticsResult | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isDevelopment, setIsDevelopment] = useState(true);
  const [semanticCatalog, setSemanticCatalog] = useState<SemanticCatalog | null>(null);
  const [selectedMode, setSelectedMode] = useState('capacity-plan');
  const [scopeMismatch, setScopeMismatch] = useState<ScopeMismatch | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [feedbackGiven, setFeedbackGiven] = useState<'up' | 'down' | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [dateTimeColumns, setDateTimeColumns] = useState<Set<string>>(new Set());
  const [queryWasTransformed, setQueryWasTransformed] = useState(false);
  const [suggestedMode, setSuggestedMode] = useState<string | null>(null);
  const [failedQuestion, setFailedQuestion] = useState<string>('');
  const [generalAnswer, setGeneralAnswer] = useState<string | null>(null);
  const [showChart, setShowChart] = useState(false);
  
  // Fetch publish date for date anchoring
  const { data: publishDate } = usePublishDate();
  
  // Favorite queries
  const { favorites, isFavorite, toggleFavorite, removeFavorite } = useFavoriteQueries();

  const submitFeedback = async (feedback: 'up' | 'down') => {
    if (!result || feedbackGiven) return;
    
    setFeedbackLoading(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: submittedQuestion,
          sql: result.sql,
          feedback,
        }),
      });
      if (response.ok) {
        setFeedbackGiven(feedback);
      } else {
        console.error('Failed to submit feedback:', response.statusText);
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    } finally {
      setFeedbackLoading(false);
    }
  };

  useEffect(() => {
    // Check if diagnostics is available (dev mode check)
    fetch('/api/db/diagnostics', { method: 'HEAD' })
      .then(res => setIsDevelopment(res.status !== 403))
      .catch(() => setIsDevelopment(false));
    
    // Fetch semantic catalog
    fetch('/api/semantic-catalog')
      .then(res => res.json())
      .then(data => {
        setSemanticCatalog(data);
        // Set default mode if specified
        const defaultMode = data.modes.find((m: SemanticMode) => m.default);
        if (defaultMode) {
          setSelectedMode(defaultMode.id);
          // Load quick questions for default mode from static config
          setFaqQuestions(getQuickQuestionsForReport(defaultMode.id));
        }
      })
      .catch(err => console.error('Failed to load semantic catalog:', err));
  }, []);

  // Update quick questions when report selection changes
  useEffect(() => {
    if (selectedMode) {
      setFaqQuestions(getQuickQuestionsForReport(selectedMode));
      setScopeMismatch(null);
    }
  }, [selectedMode]);

  const executeQuery = async (q: string) => {
    if (!q.trim()) return;

    // Check if selected scope has available tables
    const selectedReport = semanticCatalog?.modes.find(m => m.id === selectedMode);
    if (selectedReport?.available === false) {
      setError(`${selectedReport.name} tables are not available in this environment. ${selectedReport.warning || ''}`);
      return;
    }

    // Check if selected report has schema implemented
    if (selectedReport && selectedReport.schemaImplemented === false) {
      setError(`The "${selectedReport.name}" report schema is coming soon. Please select a different report.`);
      return;
    }

    // Clear any previous scope mismatch state
    setScopeMismatch(null);
    setSuggestedMode(null);
    setFailedQuestion('');
    setLoading(true);
    setError(null);
    setResult(null);
    setGeneralAnswer(null);
    setFeedbackGiven(null);
    setShowAllRows(false);
    setSubmittedQuestion(q.trim());

    // Get the anchor date (effective "today" for queries) from environment secret
    const anchorDate = getEffectiveToday();
    const anchorDateStr = anchorDate.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Transform relative dates to concrete dates using anchor date
    let queryToSend = q.trim();
    const wasTransformed = hasRelativeDateLanguage(queryToSend);
    if (wasTransformed) {
      queryToSend = transformRelativeDates(queryToSend, anchorDate);
      setQueryWasTransformed(true);
    } else {
      setQueryWasTransformed(false);
    }

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          question: queryToSend,
          mode: selectedMode,
          advancedMode,
          publishDate: anchorDateStr // Send anchor date to AI for date-relative queries
        }),
      });

      // Try to parse JSON, if it fails (HTML response), throw error
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

      // Handle general (non-data) answers
      if (data.isGeneralAnswer) {
        setGeneralAnswer(data.answer);
        setQuestion('');
        setLoading(false);
        return;
      }

      if (!response.ok) {
        // If this is a schema/column validation error, don't fall back to mock data
        if (data.schemaError) {
          setError(data.error || 'Schema validation failed. The AI generated a query that references non-existent columns or tables.');
          
          // Check if backend suggests switching to a different report mode
          if (data.suggestMode) {
            setSuggestedMode(data.suggestMode);
            setFailedQuestion(queryToSend);
          } else {
            setSuggestedMode(null);
            setFailedQuestion('');
          }
          
          setLoading(false);
          setQuestion('');
          return;
        }
        // If server returns explicit error, throw it
        throw new Error(data.error || 'Query failed');
      }

      setResult(data);
      
      // Detect date/time columns in the result data
      if (data.rows && data.rows.length > 0) {
        const detectedColumns = detectDateTimeColumns(data.rows);
        setDateTimeColumns(detectedColumns);
      } else {
        setDateTimeColumns(new Set());
      }
      
      // Clear the query box and any scope suggestions after successful query
      setQuestion('');
      setSuggestedMode(null);
      setFailedQuestion('');
    } catch (err: any) {
      console.error("API Query Failed:", err);
      
      // Show error message without falling back to mock data
      setError(`Query failed: ${err.message}. Please check your database connection, API configuration, or try rephrasing your question.`);
      setSuggestedMode(null);
      setFailedQuestion('');
      setQuestion('');
    } finally {
      setLoading(false);
    }
  };
  
  const handleSwitchMode = (newMode: string) => {
    // Switch to suggested mode and re-run the failed question
    setSelectedMode(newMode);
    setSuggestedMode(null);
    setError(null);
    
    // Re-run the failed question after a brief delay to allow mode switch to complete
    setTimeout(() => {
      if (failedQuestion) {
        executeQuery(failedQuestion);
        setFailedQuestion('');
      }
    }, 100);
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/10">
      {/* Header Bar */}
      <div className="bg-slate-900 border-b border-slate-700">
        <div className="max-w-6xl mx-auto px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="AI Analytics" className="h-10" />
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 text-slate-300 hover:text-white hover:bg-slate-800"
                  data-testid="button-dashboard"
                  title="View analytics dashboard"
                >
                  <BarChart3 className="h-4 w-4" />
                  Dashboard
                </Button>
              </Link>
              {isDevelopment && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={runDiagnostics}
                  disabled={diagnosticsLoading}
                  data-testid="button-diagnostics"
                  className="gap-2 text-slate-300 hover:text-white hover:bg-slate-800"
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
              <div className="[&_button]:border-slate-600 [&_button]:text-slate-300 [&_button]:hover:bg-slate-800 [&_button]:hover:text-white">
                <ThemeToggle />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        <h1 className="text-3xl font-semibold text-primary">AI Analytics</h1>

        {/* Scope Tabs */}
        <div className="flex gap-2 flex-wrap" data-testid="scope-tabs">
          {semanticCatalog?.modes.map((mode) => {
            const isUnavailable = mode.available === false;
            return (
              <button
                key={mode.id}
                onClick={() => setSelectedMode(mode.id)}
                className={`px-6 py-3 rounded-lg font-medium transition-all duration-200 relative ${
                  selectedMode === mode.id
                    ? isUnavailable 
                      ? 'bg-amber-600/80 text-amber-100 shadow-md'
                      : 'bg-primary text-primary-foreground shadow-md'
                    : isUnavailable
                      ? 'bg-card/50 text-foreground/40 border border-amber-500/30'
                      : 'bg-card/80 text-foreground/70 hover:bg-card hover:text-foreground border border-border/50'
                }`}
                data-testid={`tab-${mode.id}`}
              >
                {mode.name}
                {isUnavailable && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full" title="Tables not available" />
                )}
              </button>
            );
          })}
        </div>

        {/* Scope Unavailable Warning */}
        {(() => {
          const selectedModeData = semanticCatalog?.modes.find(m => m.id === selectedMode);
          if (selectedModeData?.available === false) {
            return (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400" data-testid="scope-warning">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  <span className="font-medium">{selectedModeData.warning || `${selectedModeData.name} tables not available in this environment yet`}</span>
                </div>
                {selectedModeData.missingTables && selectedModeData.missingTables.length > 0 && (
                  <p className="mt-2 text-sm opacity-80">
                    Missing: {selectedModeData.missingTables.slice(0, 3).map(t => t.replace('publish.', '')).join(', ')}
                    {selectedModeData.missingTables.length > 3 && ` and ${selectedModeData.missingTables.length - 3} more`}
                  </p>
                )}
              </div>
            );
          }
          return null;
        })()}

        {/* Quick Questions */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground/80">
            Quick questions
          </h2>
          
          {faqQuestions.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {faqQuestions.map((q, idx) => {
                const isScopeUnavailable = semanticCatalog?.modes.find(m => m.id === selectedMode)?.available === false;
                return (
                  <button
                    key={idx}
                    onClick={() => { setQuestion(q.text); executeQuery(q.text); }}
                    disabled={loading || isScopeUnavailable}
                    className="group relative p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover:bg-primary/10 hover:border-primary/50 transition-all duration-200 text-left disabled:opacity-50 disabled:cursor-not-allowed"
                    data-testid={`card-sample-question-${idx}`}
                  >
                    <span className="text-2xl mb-2 block">{q.icon}</span>
                    <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground">
                      {q.text}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center border border-border/50 rounded-xl bg-card/50 backdrop-blur-sm">
              <p className="text-sm text-muted-foreground italic" data-testid="text-questions-coming-soon">
                Quick questions: coming soon
              </p>
            </div>
          )}
        </div>

        {/* Favorite Queries */}
        {favorites.length > 0 && (
          <div className="space-y-4" data-testid="favorites-section">
            <h2 className="text-lg font-semibold text-foreground/80 flex items-center gap-2">
              <Heart className="h-5 w-5 fill-red-500 text-red-500" />
              Favorite Queries
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {favorites.map((fav) => (
                <div
                  key={fav.id}
                  className="group relative p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
                  data-testid={`favorite-${fav.id}`}
                >
                  <button
                    onClick={() => {
                      if (fav.mode !== selectedMode) {
                        setSelectedMode(fav.mode);
                      }
                      setTimeout(() => executeQuery(fav.question), fav.mode !== selectedMode ? 100 : 0);
                    }}
                    disabled={loading}
                    className="w-full text-left disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground line-clamp-2">
                      {fav.question}
                    </span>
                    <Badge variant="secondary" className="mt-2 text-xs">
                      {semanticCatalog?.modes.find(m => m.id === fav.mode)?.name || fav.mode}
                    </Badge>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFavorite(fav.id);
                    }}
                    className="absolute top-2 right-2 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-all"
                    title="Remove from favorites"
                    data-testid={`remove-favorite-${fav.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>Ask a Question</span>
              <Badge variant="outline" className="font-normal">
                {semanticCatalog?.modes.find(m => m.id === selectedMode)?.name}
              </Badge>
            </CardTitle>
            <CardDescription>
              Type a natural language question about {semanticCatalog?.modes.find(m => m.id === selectedMode)?.name?.toLowerCase() || 'your data'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-3">
                
                {/* Display scoped tables for selected report */}
                {(() => {
                  const selectedReport = semanticCatalog?.modes.find(m => m.id === selectedMode);
                  if (!selectedReport) return null;
                  
                  if (selectedReport.schemaImplemented === false || selectedReport.tables.length === 0) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="tables-display">
                        <Database className="h-3 w-3" />
                        <span className="font-medium">Tables:</span>
                        <span className="italic">Coming soon</span>
                      </div>
                    );
                  }
                  
                  const formattedTables = selectedReport.tables.map(formatTableName);
                  
                  return (
                    <div className="flex items-start gap-2 text-xs" data-testid="tables-display">
                      <Database className="h-3 w-3 mt-0.5 text-muted-foreground" />
                      <div className="flex-1">
                        <span className="font-medium text-muted-foreground">Tables:</span>{' '}
                        <span className="text-foreground/80">{formattedTables.join(', ')}</span>
                      </div>
                    </div>
                  );
                })()}
                
                {/* Display both Query Date (anchor) and Data Last Updated (publish date) */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
                  <div className="flex items-center gap-2" data-testid="today-anchor-display">
                    <span className="font-medium">Query Date:</span>
                    <span className="text-foreground/70">
                      {getEffectiveToday().toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                      })}
                    </span>
                    {!import.meta.env.PROD && (
                      <span className="italic text-xs">(dev)</span>
                    )}
                  </div>
                  {publishDate && (
                    <div className="flex items-center gap-2" data-testid="publish-date-display">
                      <span className="font-medium">Data Last Updated:</span>
                      <span className="text-foreground/70">
                        {publishDate.toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'short', 
                          day: 'numeric' 
                        })}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <Textarea
                  placeholder="What would you like to know about your manufacturing data?"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="min-h-[100px] bg-background/50"
                  data-testid="input-question"
                />
                
                {/* Common terms helper */}
                {(() => {
                  const selectedReport = semanticCatalog?.modes.find(m => m.id === selectedMode);
                  if (!selectedReport || !selectedReport.commonFields || selectedReport.commonFields.length === 0) {
                    return null;
                  }
                  
                  // Convert camelCase/PascalCase to readable format (e.g., "ResourceName" -> "Resource Name")
                  const formatFieldName = (field: string) => {
                    return field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
                  };
                  
                  // Get short scope name (e.g., "Capacity Plan" -> "Capacity")
                  const scopeShortName = selectedReport.name.split(' ')[0];
                  
                  // Filter out ID fields - they contain system-generated integers
                  const filteredFields = selectedReport.commonFields.filter(
                    (field) => !field.toLowerCase().endsWith('id')
                  );
                  
                  if (filteredFields.length === 0) return null;
                  
                  return (
                    <div className="space-y-1.5" data-testid="common-fields-display">
                      <p className="text-xs font-medium text-muted-foreground">
                        Common terms for {scopeShortName} scope:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {filteredFields.map((field) => (
                          <Badge 
                            key={field} 
                            variant="secondary" 
                            className="text-xs bg-muted/50 hover:bg-muted/70 cursor-default"
                            data-testid={`field-chip-${field}`}
                          >
                            {formatFieldName(field)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
              
              <Button 
                type="submit" 
                disabled={loading || !question.trim() || semanticCatalog?.modes.find(m => m.id === selectedMode)?.available === false} 
                data-testid="button-submit"
                className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? 'Analyzing...' : 'Submit Question'}
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
                {suggestedMode ? 'Wrong Report Scope' : 'System Notification'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p data-testid="text-error" className="whitespace-pre-line">{error}</p>
              
              {suggestedMode && semanticCatalog && (
                <div className="pt-2 border-t border-destructive/20">
                  <Button
                    onClick={() => handleSwitchMode(suggestedMode)}
                    className="bg-primary hover:bg-primary/90"
                    data-testid="button-switch-mode"
                  >
                    <Lightbulb className="mr-2 h-4 w-4" />
                    Switch to {semanticCatalog.modes.find(m => m.id === suggestedMode)?.name} and Retry
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* General Answer (non-data response) */}
        {generalAnswer && (
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm" data-testid="card-general-answer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Answer
              </CardTitle>
              {submittedQuestion && (
                <p className="text-sm text-muted-foreground mt-1">
                  "{submittedQuestion}"
                </p>
              )}
            </CardHeader>
            <CardContent>
              <p className="text-foreground leading-relaxed" data-testid="text-general-answer">
                {generalAnswer}
              </p>
              <p className="text-xs text-muted-foreground mt-4 italic">
                This is a general explanation. To query your data, try asking something like "Show me..." or "List all..."
              </p>
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
                  <div className="mt-2 space-y-2">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 flex items-center justify-between" data-testid="text-submitted-question">
                      <p className="text-base font-medium text-foreground">
                        "{submittedQuestion}"
                      </p>
                      <button
                        onClick={() => toggleFavorite(submittedQuestion, selectedMode)}
                        className="ml-3 p-1.5 rounded-full hover:bg-primary/20 transition-colors"
                        title={isFavorite(submittedQuestion, selectedMode) ? "Remove from favorites" : "Add to favorites"}
                        data-testid="button-toggle-favorite"
                      >
                        <Heart 
                          className={`h-5 w-5 transition-colors ${
                            isFavorite(submittedQuestion, selectedMode) 
                              ? 'fill-red-500 text-red-500' 
                              : 'text-muted-foreground hover:text-red-500'
                          }`} 
                        />
                      </button>
                    </div>
                    {queryWasTransformed && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground px-3" data-testid="text-query-transformed">
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30">
                          Anchored
                        </Badge>
                        <span>
                          Date-relative terms converted to {getEffectiveToday().toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSql(!showSql)}
                      className="gap-2 px-2 h-7"
                      data-testid="button-toggle-sql"
                    >
                      {showSql ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 pointer-events-none">SQL Query</Badge>
                    </Button>
                    <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">{result.rowCount} rows</Badge>
                  </div>
                  {showSql && (
                    <pre className="bg-muted/50 p-4 rounded-xl text-sm overflow-x-auto border border-border/30" data-testid="text-sql">
                      {result.sql}
                    </pre>
                  )}
                </div>

                {result.rows.length > 0 ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">Data Preview</h3>
                      <div className="flex items-center gap-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              data-testid="button-export"
                            >
                              <Download className="h-4 w-4" />
                              Export
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => {
                                try {
                                  const exportData = result.rows.map(filterRowColumns);
                                  exportToCSV(exportData, `query-results-${Date.now()}.csv`);
                                } catch (err: any) {
                                  setError(`Export failed: ${err.message}`);
                                }
                              }}
                              data-testid="menu-export-csv"
                            >
                              Export as CSV
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                try {
                                  const exportData = result.rows.map(filterRowColumns);
                                  exportToExcel(exportData, `query-results-${Date.now()}.xlsx`);
                                } catch (err: any) {
                                  setError(`Export failed: ${err.message}`);
                                }
                              }}
                              data-testid="menu-export-excel"
                            >
                              Export as Excel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowChart(!showChart)}
                          className={`gap-2 ${showChart ? 'bg-primary/10 border-primary/50' : ''}`}
                          data-testid="button-toggle-chart"
                        >
                          <BarChart3 className="h-4 w-4" />
                          {showChart ? 'Hide Chart' : 'Show Chart'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowAllRows(!showAllRows)}
                          disabled={result.rows.length <= 10}
                          className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30 hover:bg-green-500/20 disabled:opacity-50"
                          data-testid="button-toggle-rows"
                        >
                          {showAllRows ? `Show First 10` : `Show All ${result.rows.length} Rows`}
                        </Button>
                      </div>
                    </div>
                    
                    {/* Chart visualization */}
                    {showChart && result.rows.length > 0 && (
                      <div className="border border-border/50 rounded-xl p-4 bg-card/50">
                        <ResultChart 
                          rows={result.rows.map(filterRowColumns)} 
                          columns={Object.keys(filterRowColumns(result.rows[0]))} 
                        />
                      </div>
                    )}
                    
                    <div className="w-full overflow-x-auto border border-border/50 rounded-xl">
                      <div className="max-h-[420px] overflow-auto">
                        <table className={`w-full text-sm table-auto ${Object.keys(filterRowColumns(result.rows[0])).length > 5 ? 'min-w-[900px]' : ''}`}>
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
                                  {Object.entries(filteredRow).map(([columnName, value]: [string, any], cellIdx) => (
                                    <td key={cellIdx} className="px-4 py-3">
                                      {value === null ? (
                                        <span className="text-muted-foreground italic">null</span>
                                      ) : (
                                        formatCellValue(value, columnName, dateTimeColumns)
                                      )}
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
                ) : (
                  <div className="p-6 text-center border border-border/50 rounded-xl bg-muted/30" data-testid="no-results-message">
                    <div className="text-4xl mb-3">📭</div>
                    <h3 className="font-semibold text-lg mb-2">No matching records found</h3>
                    <p className="text-sm text-muted-foreground">
                      Your query ran successfully, but no data matched the criteria. Try adjusting the date range or filters in your question.
                    </p>
                  </div>
                )}

                {/* Feedback Section */}
                <div className="flex items-center justify-between pt-4 border-t border-border/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Was this helpful?</span>
                    <Button
                      variant={feedbackGiven === 'up' ? "default" : "outline"}
                      size="sm"
                      onClick={() => submitFeedback('up')}
                      disabled={feedbackLoading || feedbackGiven !== null}
                      data-testid="button-feedback-up"
                      className={feedbackGiven === 'up' ? "bg-green-500 hover:bg-green-600" : ""}
                    >
                      <ThumbsUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={feedbackGiven === 'down' ? "default" : "outline"}
                      size="sm"
                      onClick={() => submitFeedback('down')}
                      disabled={feedbackLoading || feedbackGiven !== null}
                      data-testid="button-feedback-down"
                      className={feedbackGiven === 'down' ? "bg-red-500 hover:bg-red-600" : ""}
                    >
                      <ThumbsDown className="h-4 w-4" />
                    </Button>
                    {feedbackGiven && (
                      <span className="text-sm text-muted-foreground ml-2">Thanks for your feedback!</span>
                    )}
                  </div>
                </div>

                {/* Did you mean? Suggestions */}
                {result.suggestions && result.suggestions.length > 0 && (
                  <div className="pt-4 border-t border-border/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Lightbulb className="h-4 w-4 text-yellow-500" />
                      <span className="text-sm font-medium">Related questions you might ask:</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.suggestions.map((suggestion, idx) => (
                        <Button
                          key={idx}
                          variant="outline"
                          size="sm"
                          onClick={() => executeQuery(suggestion)}
                          disabled={loading}
                          data-testid={`button-suggestion-${idx}`}
                          className="text-xs bg-yellow-500/5 border-yellow-500/30 hover:bg-yellow-500/10"
                        >
                          {suggestion}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <footer className="mt-12 pb-6 text-center">
          <p className="text-xs text-muted-foreground" data-testid="text-app-version">
            AI Analytics v{APP_VERSION}
          </p>
        </footer>
      </div>
    </div>
  );
}
