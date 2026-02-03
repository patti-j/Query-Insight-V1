import fs from 'fs';
import path from 'path';

interface MatrixEntry {
  keywords: string[];
  tier1Tables: string[];
  tier2Tables: string[];
  override?: boolean;
  contextHint?: string;
}

interface OverrideRule {
  triggers: string[];
  requiredTables: string[];
  description: string;
}

interface AnalyticsReference {
  version: string;
  lastUpdated: string;
  terms: any[];
  matrix: MatrixEntry[];
  tableKeywords: Record<string, string[]>;
  promptTrimming: {
    defaultTableCount: number;
    maxTableCount: number;
    maxColumnsPerTable: number;
    alwaysIncludeColumns: string[];
  };
  overrideRules: OverrideRule[];
}

function formatTableName(fullName: string): string {
  return fullName.replace('publish.', '');
}

function isTier2Table(tableName: string): boolean {
  return !tableName.includes('DASHt_');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateHtml(data: AnalyticsReference): string {
  const totalKeywords = data.matrix.reduce((sum, entry) => sum + entry.keywords.length, 0);
  const tier1Tables = new Set<string>();
  data.matrix.forEach(entry => entry.tier1Tables.forEach(t => tier1Tables.add(t)));

  const sectionIds = [
    'jobs', 'resources', 'capacity', 'utilization', 'lateness', 'bottlenecks',
    'predecessors', 'sales', 'purchase', 'inventory', 'materials', 'scenarios',
    'wip', 'dispatch', 'kpi', 'products', 'timing', 'throughput', 'travelers',
    'customers', 'resourceschedule', 'planningarea'
  ];

  const sectionNames: Record<string, string> = {
    jobs: 'Jobs & Operations',
    resources: 'Resources',
    capacity: 'Capacity & Demand',
    utilization: 'Utilization',
    lateness: 'Lateness & Risk',
    bottlenecks: 'Bottlenecks',
    predecessors: 'Predecessors',
    sales: 'Sales Orders',
    purchase: 'Purchase Orders',
    inventory: 'Inventory',
    materials: 'Materials',
    scenarios: 'Scenarios',
    wip: 'WIP & Status',
    dispatch: 'Dispatch & Schedule',
    kpi: 'KPIs',
    products: 'Products & Items',
    timing: 'Setup/Cycle Time',
    throughput: 'Throughput',
    travelers: 'Travelers',
    customers: 'Customer Orders',
    resourceschedule: 'Resource Schedule',
    planningarea: 'Planning Area'
  };

  function getSectionId(keywords: string[]): string {
    const kw = keywords.map(k => k.toLowerCase());
    if (kw.some(k => k.includes('job') || k.includes('operation') || k.includes('routing'))) return 'jobs';
    if (kw.some(k => k.includes('resource') || k.includes('workcenter') || k.includes('machine'))) return 'resources';
    if (kw.some(k => k.includes('capacity') || k.includes('demand') || k.includes('shift'))) return 'capacity';
    if (kw.some(k => k.includes('utilization'))) return 'utilization';
    if (kw.some(k => k.includes('late') || k.includes('overdue') || k.includes('delay'))) return 'lateness';
    if (kw.some(k => k.includes('bottleneck') || k.includes('constraint'))) return 'bottlenecks';
    if (kw.some(k => k.includes('predecessor') || k.includes('dependency'))) return 'predecessors';
    if (kw.some(k => k.includes('sales') || k.includes('customer') || k.includes('shipment'))) return 'sales';
    if (kw.some(k => k.includes('purchase') || k.includes('vendor'))) return 'purchase';
    if (kw.some(k => k.includes('inventory') || k.includes('stock') || k.includes('on hand'))) return 'inventory';
    if (kw.some(k => k.includes('material') || k.includes('bom') || k.includes('component'))) return 'materials';
    if (kw.some(k => k.includes('scenario') || k.includes('what-if'))) return 'scenarios';
    if (kw.some(k => k.includes('wip') || k.includes('progress') || k.includes('started'))) return 'wip';
    if (kw.some(k => k.includes('dispatch') || k.includes('schedule today'))) return 'dispatch';
    if (kw.some(k => k.includes('kpi') || k.includes('metric'))) return 'kpi';
    if (kw.some(k => k.includes('product') || k.includes('item') && !k.includes('material'))) return 'products';
    if (kw.some(k => k.includes('setup') || k.includes('cycle time'))) return 'timing';
    if (kw.some(k => k.includes('throughput'))) return 'throughput';
    if (kw.some(k => k.includes('traveler') || k.includes('routing'))) return 'travelers';
    if (kw.some(k => k.includes('planning area'))) return 'planningarea';
    return 'jobs';
  }

  let html = `<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'/>
<meta name='viewport' content='width=device-width, initial-scale=1'/>
<title>Query Matrix Reference - AI Analytics</title>
<style>
:root{
  --bg:#0b1020;
  --card:#111a33;
  --text:#e7ecff;
  --muted:#aeb9e1;
  --accent:#7aa2ff;
  --green:#4ade80;
  --yellow:#fbbf24;
  --border:rgba(231,236,255,.14);
  --tableStripe:rgba(231,236,255,.04);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";}
a{color:var(--accent)}
.wrap{max-width:1400px;margin:0 auto;padding:28px 18px 60px}
h1{font-size:28px;margin:0 0 10px}
h2{font-size:20px;margin:28px 0 10px}
h3{font-size:16px;margin:20px 0 8px;color:var(--accent)}
p{line-height:1.55;color:var(--muted);margin:8px 0}
.small{font-size:12px;color:var(--muted)}
.card{background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));border:1px solid var(--border);border-radius:16px;padding:16px 16px 10px;margin:14px 0}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted);font-size:12px;margin-right:6px}
.badge-green{border-color:var(--green);color:var(--green)}
.badge-yellow{border-color:var(--yellow);color:var(--yellow)}
table{width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;border-radius:14px;border:1px solid var(--border);background:rgba(255,255,255,.02)}
th,td{padding:10px 12px;vertical-align:top;border-bottom:1px solid var(--border);text-align:left}
th{font-size:12px;letter-spacing:.02em;color:var(--muted);background:rgba(0,0,0,.20);position:sticky;top:0}
tr:nth-child(even) td{background:var(--tableStripe)}
tr:last-child td{border-bottom:none}
code,kbd,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:12px;padding:10px;margin:8px 0;color:var(--text)}
.keyword{display:inline-block;background:rgba(122,162,255,.15);color:var(--accent);padding:2px 6px;border-radius:4px;margin:2px;font-size:12px}
.table-name{display:inline-block;background:rgba(74,222,128,.12);color:var(--green);padding:2px 6px;border-radius:4px;margin:2px;font-size:11px;font-family:monospace}
.table-name.tier2{background:rgba(251,191,36,.12);color:var(--yellow)}
.context-hint{font-size:11px;color:var(--muted);font-style:italic;margin-top:6px;padding:6px;background:rgba(0,0,0,.15);border-radius:6px}
.stats{display:flex;gap:20px;flex-wrap:wrap;margin:16px 0}
.stat-box{background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:12px 16px;min-width:120px}
.stat-value{font-size:24px;font-weight:600;color:var(--accent)}
.stat-label{font-size:12px;color:var(--muted)}
hr{border:none;border-top:1px solid var(--border);margin:18px 0}
.toc{background:rgba(0,0,0,.2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin:16px 0}
.toc a{display:inline-block;margin:4px 8px 4px 0}
</style>
</head>
<body>
<div class='wrap'>
<h1>Query Matrix Reference</h1>
<div class='card'>
<span class='badge'>Version: ${data.version}</span>
<span class='badge'>Updated: ${data.lastUpdated}</span>
<span class='badge badge-green'>${data.matrix.length} Matrix Entries</span>
<p class='small'>This matrix maps user question keywords to database tables. When a user asks a question, the system matches keywords and selects the appropriate Tier 1 tables (curated DASHt_* tables) with Tier 2 fallbacks (source tables).</p>
<p class='small'><strong>Auto-generated from analytics_reference.json</strong> - Do not edit this file directly.</p>
</div>

<div class='stats'>
<div class='stat-box'><div class='stat-value'>${data.matrix.length}</div><div class='stat-label'>Matrix Entries</div></div>
<div class='stat-box'><div class='stat-value'>${totalKeywords}+</div><div class='stat-label'>Keywords</div></div>
<div class='stat-box'><div class='stat-value'>${tier1Tables.size}</div><div class='stat-label'>Tier 1 Tables</div></div>
<div class='stat-box'><div class='stat-value'>${data.promptTrimming.defaultTableCount}-${data.promptTrimming.maxTableCount}</div><div class='stat-label'>Default Tables/Query</div></div>
</div>

<div class='toc'>
<strong>Quick Navigation:</strong>
`;

  const usedSections = new Set<string>();
  data.matrix.forEach(entry => usedSections.add(getSectionId(entry.keywords)));
  
  for (const id of sectionIds) {
    if (usedSections.has(id)) {
      html += `<a href='#${id}'>${sectionNames[id] || id}</a>\n`;
    }
  }

  html += `</div>

<h2>Query Matrix</h2>

<table>
<thead>
<tr>
<th style='width:25%'>Keywords (User Terms)</th>
<th style='width:35%'>Tier 1 Tables (Curated)</th>
<th style='width:35%'>Tier 2 Tables (Source)</th>
<th style='width:5%'>Override</th>
</tr>
</thead>
<tbody>
`;

  for (const entry of data.matrix) {
    const sectionId = getSectionId(entry.keywords);
    
    html += `<tr id='${sectionId}'>\n`;
    
    html += `<td>`;
    for (const kw of entry.keywords) {
      html += `<span class='keyword'>${escapeHtml(kw)}</span>`;
    }
    html += `</td>\n`;
    
    html += `<td>`;
    for (const table of entry.tier1Tables) {
      html += `<span class='table-name'>${formatTableName(table)}</span>`;
    }
    html += `</td>\n`;
    
    html += `<td>`;
    for (const table of entry.tier2Tables) {
      const className = isTier2Table(table) ? 'table-name tier2' : 'table-name';
      html += `<span class='${className}'>${formatTableName(table)}</span>`;
    }
    html += `</td>\n`;
    
    html += `<td>${entry.override ? '✓' : ''}</td>\n`;
    html += `</tr>\n`;
    
    if (entry.contextHint) {
      html += `<tr><td colspan='4'><div class='context-hint'>${escapeHtml(entry.contextHint)}</div></td></tr>\n`;
    }
  }

  html += `</tbody>
</table>

<h2>Override Rules</h2>
<p>Some keywords trigger <strong>mandatory</strong> table inclusion, overriding the normal matrix selection.</p>

<table>
<thead>
<tr>
<th>Trigger Phrases</th>
<th>Required Tables</th>
<th>Description</th>
</tr>
</thead>
<tbody>
`;

  for (const rule of data.overrideRules) {
    html += `<tr>\n`;
    html += `<td>`;
    for (const trigger of rule.triggers) {
      html += `<span class='keyword'>${escapeHtml(trigger)}</span>`;
    }
    html += `</td>\n`;
    html += `<td>`;
    for (const table of rule.requiredTables) {
      const className = isTier2Table(table) ? 'table-name tier2' : 'table-name';
      html += `<span class='${className}'>${formatTableName(table)}</span>`;
    }
    html += `</td>\n`;
    html += `<td>${escapeHtml(rule.description)}</td>\n`;
    html += `</tr>\n`;
  }

  html += `</tbody>
</table>

<h2>Table Keywords Reference</h2>
<p>Each table has associated keywords that help the classifier select it when those terms appear in user questions.</p>

<table>
<thead>
<tr>
<th>Table</th>
<th>Primary Keywords</th>
</tr>
</thead>
<tbody>
`;

  for (const [table, keywords] of Object.entries(data.tableKeywords)) {
    const className = isTier2Table(table) ? 'table-name tier2' : 'table-name';
    html += `<tr>\n`;
    html += `<td><span class='${className}'>${formatTableName(table)}</span></td>\n`;
    html += `<td>`;
    for (const kw of keywords) {
      html += `<span class='keyword'>${escapeHtml(kw)}</span>`;
    }
    html += `</td>\n`;
    html += `</tr>\n`;
  }

  html += `</tbody>
</table>

</div>
</body>
</html>
`;

  return html;
}

async function main() {
  const refPath = path.join(process.cwd(), 'src', 'config', 'analytics_reference.json');
  const outputPath = path.join(process.cwd(), 'docs', 'query-matrix.html');

  console.log('Reading analytics_reference.json...');
  const data: AnalyticsReference = JSON.parse(fs.readFileSync(refPath, 'utf-8'));

  console.log('Generating HTML...');
  const html = generateHtml(data);

  console.log(`Writing to ${outputPath}...`);
  fs.writeFileSync(outputPath, html, 'utf-8');

  console.log('Done! Generated query-matrix.html from analytics_reference.json');
  console.log(`  - ${data.matrix.length} matrix entries`);
  console.log(`  - ${data.overrideRules.length} override rules`);
  console.log(`  - ${Object.keys(data.tableKeywords).length} table keyword mappings`);
}

main().catch(console.error);
