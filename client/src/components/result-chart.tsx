import { useState, useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { BarChart3, PieChart as PieChartIcon, TrendingUp } from 'lucide-react';

interface ResultChartProps {
  rows: Record<string, any>[];
  columns: string[];
}

type ChartType = 'bar' | 'pie' | 'line';

const COLORS = [
  'hsl(var(--primary))',
  'hsl(221, 83%, 53%)',
  'hsl(262, 83%, 58%)',
  'hsl(316, 73%, 52%)',
  'hsl(0, 84%, 60%)',
  'hsl(24, 95%, 53%)',
  'hsl(47, 95%, 53%)',
  'hsl(142, 71%, 45%)',
  'hsl(173, 80%, 40%)',
  'hsl(199, 89%, 48%)',
];

export function ResultChart({ rows, columns }: ResultChartProps) {
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [selectedLabelColumn, setSelectedLabelColumn] = useState<string>('');
  const [selectedValueColumn, setSelectedValueColumn] = useState<string>('');

  const { labelColumns, valueColumns } = useMemo(() => {
    if (!rows || rows.length === 0) return { labelColumns: [], valueColumns: [] };

    const labelCols: string[] = [];
    const valueCols: string[] = [];

    columns.forEach((col) => {
      const sampleValue = rows[0][col];
      if (typeof sampleValue === 'number' || (!isNaN(parseFloat(sampleValue)) && isFinite(sampleValue))) {
        valueCols.push(col);
      } else {
        labelCols.push(col);
      }
    });

    return { labelColumns: labelCols, valueColumns: valueCols };
  }, [rows, columns]);

  const effectiveLabelColumn = selectedLabelColumn || labelColumns[0] || columns[0];
  const effectiveValueColumn = selectedValueColumn || valueColumns[0];

  const chartData = useMemo(() => {
    if (!rows || rows.length === 0 || !effectiveValueColumn) return [];

    return rows.slice(0, 20).map((row, index) => ({
      name: String(row[effectiveLabelColumn] || `Item ${index + 1}`).substring(0, 25),
      value: parseFloat(row[effectiveValueColumn]) || 0,
      fullName: String(row[effectiveLabelColumn] || `Item ${index + 1}`),
    }));
  }, [rows, effectiveLabelColumn, effectiveValueColumn]);

  if (!valueColumns.length) {
    return (
      <div className="p-4 text-center text-muted-foreground text-sm">
        No numeric columns available for charting
      </div>
    );
  }

  const formatValue = (value: number) => {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (Math.abs(value) >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toFixed(1);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          <Button
            variant={chartType === 'bar' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setChartType('bar')}
            className="h-8 px-3"
            data-testid="button-chart-bar"
          >
            <BarChart3 className="h-4 w-4 mr-1" />
            Bar
          </Button>
          <Button
            variant={chartType === 'pie' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setChartType('pie')}
            className="h-8 px-3"
            data-testid="button-chart-pie"
          >
            <PieChartIcon className="h-4 w-4 mr-1" />
            Pie
          </Button>
          <Button
            variant={chartType === 'line' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setChartType('line')}
            className="h-8 px-3"
            data-testid="button-chart-line"
          >
            <TrendingUp className="h-4 w-4 mr-1" />
            Line
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Label:</label>
          <select
            value={effectiveLabelColumn}
            onChange={(e) => setSelectedLabelColumn(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-sm"
            data-testid="select-label-column"
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                {col.replace(/([a-z])([A-Z])/g, '$1 $2')}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Value:</label>
          <select
            value={effectiveValueColumn}
            onChange={(e) => setSelectedValueColumn(e.target.value)}
            className="bg-background border border-border rounded px-2 py-1 text-sm"
            data-testid="select-value-column"
          >
            {valueColumns.map((col) => (
              <option key={col} value={col}>
                {col.replace(/([a-z])([A-Z])/g, '$1 $2')}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="h-[300px] w-full" data-testid="chart-container">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'bar' ? (
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis tickFormatter={formatValue} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <Tooltip
                formatter={(value: number) => [formatValue(value), effectiveValueColumn.replace(/([a-z])([A-Z])/g, '$1 $2')]}
                labelFormatter={(label) => chartData.find((d) => d.name === label)?.fullName || label}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : chartType === 'pie' ? (
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                outerRadius={100}
                fill="hsl(var(--primary))"
                dataKey="value"
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [formatValue(value), effectiveValueColumn.replace(/([a-z])([A-Z])/g, '$1 $2')]}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
            </PieChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis
                dataKey="name"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <YAxis tickFormatter={formatValue} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <Tooltip
                formatter={(value: number) => [formatValue(value), effectiveValueColumn.replace(/([a-z])([A-Z])/g, '$1 $2')]}
                labelFormatter={(label) => chartData.find((d) => d.name === label)?.fullName || label}
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="value"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2 }}
                name={effectiveValueColumn.replace(/([a-z])([A-Z])/g, '$1 $2')}
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {rows.length > 20 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing first 20 rows. Export data for full chart.
        </p>
      )}
    </div>
  );
}
