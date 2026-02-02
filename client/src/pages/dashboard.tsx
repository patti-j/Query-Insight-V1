import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  XCircle,
  ArrowLeft,
  Database,
  Zap,
  ThumbsUp,
  ThumbsDown,
  Pin,
  Play,
  Trash2,
  ExternalLink,
  LayoutDashboard,
  BarChart3,
  Table,
  Loader2
} from "lucide-react";
import { usePinnedDashboard, PinnedItem, PinnedQueryResult } from "@/hooks/usePinnedDashboard";
import { useToast } from "@/hooks/use-toast";

interface AnalyticsData {
  summary: {
    totalQueries: number;
    successfulQueries: number;
    failedQueries: number;
    averageLatency: number;
    averageLlmMs: number;
    averageSqlMs: number;
  };
  errorBreakdown: Array<{ stage: string; count: number; percentage: number }>;
  performanceOverTime: Array<{ timestamp: string; latency: number; llmMs: number; sqlMs: number }>;
  topErrors: Array<{ message: string; count: number; lastOccurred: string }>;
  recentQueries: Array<{
    timestamp: string;
    question: string;
    success: boolean;
    latency: number;
    rowCount: number | null;
    error?: string;
  }>;
}

interface FeedbackStats {
  total: number;
  positive: number;
  negative: number;
}

function PinnedQueryCard({ 
  item, 
  onRemove, 
  onRerun, 
  isRerunning 
}: { 
  item: PinnedItem; 
  onRemove: () => void; 
  onRerun: () => void;
  isRerunning: boolean;
}) {
  const [, navigate] = useLocation();
  const lastRunDate = item.lastRunAt ? new Date(item.lastRunAt) : null;
  
  return (
    <Card className="flex flex-col h-full" data-testid={`pinned-card-${item.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium line-clamp-2">{item.question}</CardTitle>
          <div className="flex items-center gap-1 shrink-0">
            {item.visualizationType === 'chart' ? (
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Table className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {item.filters.planningArea && (
            <Badge variant="secondary" className="text-xs">{item.filters.planningArea}</Badge>
          )}
          {item.filters.scenarioId && (
            <Badge variant="secondary" className="text-xs">{item.filters.scenarioId}</Badge>
          )}
          {item.filters.plant && (
            <Badge variant="secondary" className="text-xs">{item.filters.plant}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        {item.lastResult ? (
          <div className="flex-1">
            <p className="text-xs text-muted-foreground mb-2 line-clamp-3">
              {item.lastResult.answer}
            </p>
            <div className="text-xs text-muted-foreground">
              {item.lastResult.rowCount} rows
            </div>
            {item.lastResult.rows.length > 0 && (
              <div className="mt-2 max-h-32 overflow-auto text-xs border rounded">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      {Object.keys(item.lastResult.rows[0]).slice(0, 3).map((key) => (
                        <th key={key} className="px-2 py-1 text-left font-medium truncate max-w-[80px]">
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {item.lastResult.rows.slice(0, 3).map((row, idx) => (
                      <tr key={idx} className="border-t">
                        {Object.values(row).slice(0, 3).map((val: any, i) => (
                          <td key={i} className="px-2 py-1 truncate max-w-[80px]">
                            {String(val ?? '')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            No results cached. Run to see data.
          </div>
        )}
        
        <div className="mt-3 pt-3 border-t flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {lastRunDate ? (
              <>Last run: {lastRunDate.toLocaleDateString()}</>
            ) : (
              <>Never run</>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => navigate(`/?q=${encodeURIComponent(item.question)}`)}
              title="Open in Query"
              data-testid={`button-view-${item.id}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRerun}
              disabled={isRerunning}
              title="Rerun query"
              data-testid={`button-rerun-${item.id}`}
            >
              {isRerunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onRemove}
              title="Remove from dashboard"
              data-testid={`button-remove-${item.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("my-dashboard");
  const [rerunningId, setRerunningId] = useState<string | null>(null);
  const { pinnedItems, removePinnedItem, updatePinnedItemResult } = usePinnedDashboard();
  const { toast } = useToast();
  
  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ['/api/analytics'],
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const { data: feedbackStats } = useQuery<FeedbackStats>({
    queryKey: ['/api/feedback/stats'],
    refetchInterval: 10000,
  });

  const handleRerunQuery = async (item: PinnedItem) => {
    setRerunningId(item.id);
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: item.question,
          publishDate: new Date().toISOString().split('T')[0],
          filters: {
            planningArea: item.filters.planningArea,
            scenarioId: item.filters.scenarioId,
            plant: item.filters.plant
          }
        })
      });
      
      if (!response.ok) throw new Error('Query failed');
      
      const data = await response.json();
      const result: PinnedQueryResult = {
        rows: data.rows || [],
        rowCount: data.rowCount || 0,
        sql: data.sql || '',
        answer: data.answer || ''
      };
      
      updatePinnedItemResult(item.id, result);
      toast({ title: 'Updated!', description: 'Query results refreshed' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message || 'Failed to run query', variant: 'destructive' });
    } finally {
      setRerunningId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Activity className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load analytics data. Please try again later.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { summary, errorBreakdown, performanceOverTime, topErrors, recentQueries } = data;
  const successRate = summary.totalQueries > 0 
    ? ((summary.successfulQueries / summary.totalQueries) * 100).toFixed(1) 
    : '0.0';

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <button 
                className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors bg-transparent border-0 cursor-pointer"
                data-testid="button-back-to-query"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Query
              </button>
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">Dashboard</h1>
              <p className="text-sm text-muted-foreground">Your pinned queries and analytics</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-8">
          <TabsList>
            <TabsTrigger value="my-dashboard" className="gap-2" data-testid="tab-my-dashboard">
              <LayoutDashboard className="h-4 w-4" />
              My Dashboard
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2" data-testid="tab-analytics">
              <Activity className="h-4 w-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-dashboard" className="mt-6">
            {pinnedItems.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Pin className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium mb-2">No pinned queries yet</h3>
                  <p className="text-sm text-muted-foreground text-center max-w-md mb-4">
                    Pin your favorite queries from the Query page to see them here for quick access.
                  </p>
                  <Link href="/">
                    <Button variant="outline" data-testid="button-go-to-query">
                      Go to Query Page
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {pinnedItems.map((item) => (
                  <PinnedQueryCard
                    key={item.id}
                    item={item}
                    onRemove={() => {
                      removePinnedItem(item.id);
                      toast({ title: 'Removed', description: 'Query removed from dashboard' });
                    }}
                    onRerun={() => handleRerunQuery(item)}
                    isRerunning={rerunningId === item.id}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="analytics" className="mt-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Queries</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalQueries}</div>
              <p className="text-xs text-muted-foreground">Last 24 hours</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{successRate}%</div>
              <p className="text-xs text-muted-foreground">
                {summary.successfulQueries} / {summary.totalQueries} queries
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg Latency</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.averageLatency}ms</div>
              <p className="text-xs text-muted-foreground">Total request time</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Failed Queries</CardTitle>
              <XCircle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.failedQueries}</div>
              <p className="text-xs text-muted-foreground">Validation or execution errors</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">User Feedback</CardTitle>
              <div className="flex gap-1">
                <ThumbsUp className="h-4 w-4 text-green-500" />
                <ThumbsDown className="h-4 w-4 text-red-500" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <ThumbsUp className="h-4 w-4 text-green-500" />
                  <span className="text-xl font-bold text-green-600">{feedbackStats?.positive || 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <ThumbsDown className="h-4 w-4 text-red-500" />
                  <span className="text-xl font-bold text-red-600">{feedbackStats?.negative || 0}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{feedbackStats?.total || 0} total responses</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2 mb-8">
          <Card>
            <CardHeader>
              <CardTitle>Performance Breakdown</CardTitle>
              <CardDescription>Average time spent in each stage</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">LLM Generation</span>
                  </div>
                  <span className="text-sm font-bold">{summary.averageLlmMs}ms</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full" 
                    style={{ 
                      width: `${summary.averageLatency > 0 ? (summary.averageLlmMs / summary.averageLatency * 100) : 0}%` 
                    }}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">SQL Execution</span>
                  </div>
                  <span className="text-sm font-bold">{summary.averageSqlMs}ms</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full" 
                    style={{ 
                      width: `${summary.averageLatency > 0 ? (summary.averageSqlMs / summary.averageLatency * 100) : 0}%` 
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Error Breakdown</CardTitle>
              <CardDescription>Errors by stage</CardDescription>
            </CardHeader>
            <CardContent>
              {errorBreakdown.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  <p className="text-sm">No errors in the selected time range</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {errorBreakdown.map((error) => (
                    <div key={error.stage} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant={error.stage === 'validation' ? 'destructive' : 'secondary'}>
                          {error.stage}
                        </Badge>
                        <span className="text-sm">{error.count} errors</span>
                      </div>
                      <span className="text-sm font-medium">{error.percentage.toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="recent" className="space-y-4">
          <TabsList>
            <TabsTrigger value="recent" data-testid="tab-recent-queries">Recent Queries</TabsTrigger>
            <TabsTrigger value="errors" data-testid="tab-top-errors">Top Errors</TabsTrigger>
            <TabsTrigger value="performance" data-testid="tab-performance">Performance Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="recent" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Query Activity</CardTitle>
                <CardDescription>Latest 20 queries with status and performance</CardDescription>
              </CardHeader>
              <CardContent>
                {recentQueries.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm">No queries in the selected time range</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentQueries.map((query, index) => (
                      <div 
                        key={index} 
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        data-testid={`recent-query-${index}`}
                      >
                        {query.success ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5 flex-shrink-0" />
                        ) : (
                          <XCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{query.question}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs text-muted-foreground">
                              {new Date(query.timestamp).toLocaleTimeString()}
                            </span>
                            <span className="text-xs text-muted-foreground">{query.latency}ms</span>
                            {query.success && query.rowCount !== null && (
                              <span className="text-xs text-muted-foreground">{query.rowCount} rows</span>
                            )}
                          </div>
                          {query.error && (
                            <p className="text-xs text-red-500 mt-1 line-clamp-2">{query.error}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="errors" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Most Common Errors</CardTitle>
                <CardDescription>Top 10 error messages by frequency</CardDescription>
              </CardHeader>
              <CardContent>
                {topErrors.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                    <p className="text-sm">No errors in the selected time range</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topErrors.map((error, index) => (
                      <div 
                        key={index} 
                        className="p-3 rounded-lg border bg-card"
                        data-testid={`top-error-${index}`}
                      >
                        <div className="flex items-start gap-3">
                          <Badge variant="destructive" className="mt-0.5">{error.count}</Badge>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium break-words">{error.message}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Last occurred: {new Date(error.lastOccurred).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Performance Timeline</CardTitle>
                <CardDescription>Last 50 successful queries</CardDescription>
              </CardHeader>
              <CardContent>
                {performanceOverTime.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm">No successful queries in the selected time range</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {performanceOverTime.slice().reverse().map((entry, index) => (
                      <div 
                        key={index} 
                        className="flex items-center gap-3"
                        data-testid={`performance-entry-${index}`}
                      >
                        <span className="text-xs text-muted-foreground w-20 flex-shrink-0">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium w-20">Total: {entry.latency}ms</span>
                            <div className="flex-1 bg-secondary rounded-full h-2 overflow-hidden">
                              <div className="flex h-full">
                                <div 
                                  className="bg-blue-500" 
                                  style={{ width: `${(entry.llmMs / entry.latency) * 100}%` }}
                                  title={`LLM: ${entry.llmMs}ms`}
                                />
                                <div 
                                  className="bg-green-500" 
                                  style={{ width: `${(entry.sqlMs / entry.latency) * 100}%` }}
                                  title={`SQL: ${entry.sqlMs}ms`}
                                />
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span>LLM: {entry.llmMs}ms</span>
                            <span>SQL: {entry.sqlMs}ms</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
