/**
 * Table Relevance Scoring
 * 
 * Selects the 2-4 most relevant tables for a given question
 * to minimize LLM prompt size and improve generation quality.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface TableRelevance {
  tableName: string;
  score: number;
  matchedKeywords: string[];
}

interface ModeConfig {
  id: string;
  name: string;
  tables: string[];
  commonFields?: string[];
  keywords?: string[];
}

interface SemanticCatalog {
  modes: ModeConfig[];
}

const TABLE_KEYWORD_MAP: Record<string, string[]> = {
  'DASHt_Planning': ['job', 'jobs', 'schedule', 'scheduled', 'planning', 'late', 'overdue', 'due', 'priority', 'wip', 'dispatch', 'predecessor', 'otif', 'on-time', 'bottleneck', 'blocked'],
  'DASHt_JobOperationProducts': ['job', 'operation', 'product', 'part', 'item', 'work order', 'mo', 'op'],
  'DASHt_JobOperationAttributes': ['attribute', 'job', 'operation', 'custom', 'field'],
  'DASHt_PredecessorOPIds': ['predecessor', 'blocked', 'dependency', 'sequence', 'operation'],
  'DASHt_Resources': ['resource', 'machine', 'equipment', 'workcenter', 'work center', 'department', 'plant', 'labor', 'worker'],
  'DASHt_CapacityPlanning_ResourceActual': ['actual', 'resource', 'capacity', 'real', 'realized'],
  'DASHt_CapacityPlanning_ResourceCapacity': ['capacity', 'resource', 'available', 'hours', 'shift', 'utilization', 'load', 'bottleneck', 'over capacity', 'constrained'],
  'DASHt_CapacityPlanning_ResourceDemand': ['demand', 'resource', 'load', 'hours', 'required', 'bottleneck'],
  'DASHt_CapacityPlanning_ShiftsCombined': ['shift', 'shifts', 'overtime', 'schedule', 'calendar', 'working', 'overloaded', 'idle', 'loaded'],
  'DASHt_CapacityPlanning_ShiftsCombinedFromLastPublish': ['shift', 'last', 'previous', 'publish', 'compare', 'changed'],
  'DASHt_SalesOrders': ['sales', 'order', 'customer', 'demand', 'ship', 'delivery', 'overdue', 'scenario', 'what-if', 'production'],
  'DASHt_PurchaseOrders': ['purchase', 'po', 'supplier', 'vendor', 'buy', 'procurement', 'receiving', 'spend'],
  'DASHt_Inventories': ['inventory', 'stock', 'on-hand', 'warehouse', 'location', 'qty', 'quantity'],
  'DASHt_InventoryAdjustments': ['adjustment', 'inventory', 'change', 'transaction', 'movement', 'total'],
  'DASHt_NetInventoryBalance': ['net', 'balance', 'inventory', 'projected', 'available', 'item', 'plant'],
  'DASHt_Materials': ['material', 'bom', 'component', 'raw', 'part', 'ingredient', 'consumption'],
  'DASHt_HistoricalKPIs': ['kpi', 'metric', 'performance', 'history', 'trend', 'historical'],
  'DASHt_TranLog': ['transaction', 'log', 'audit', 'change', 'history'],
  'DASHt_RecentPublishedScenariosArchive': ['scenario', 'publish', 'archive', 'version', 'snapshot', 'changed', 'compare'],
};

const COMMON_SYNONYMS: Record<string, string[]> = {
  'late': ['overdue', 'behind', 'delayed', 'past due'],
  'on time': ['otif', 'punctual', 'timely'],
  'next': ['upcoming', 'future', 'scheduled'],
  'today': ['current', 'now'],
  'capacity': ['load', 'utilization', 'available'],
  'job': ['work order', 'manufacturing order', 'mo'],
  'part': ['item', 'product', 'sku'],
};

let catalogCache: SemanticCatalog | null = null;

function loadCatalog(): SemanticCatalog {
  if (catalogCache) return catalogCache;
  const path = join(process.cwd(), 'docs', 'semantic', 'semantic-catalog.json');
  catalogCache = JSON.parse(readFileSync(path, 'utf-8'));
  return catalogCache!;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function expandSynonyms(text: string): string {
  let expanded = text;
  for (const [key, synonyms] of Object.entries(COMMON_SYNONYMS)) {
    for (const syn of synonyms) {
      if (expanded.includes(syn)) {
        expanded = expanded + ' ' + key;
      }
    }
  }
  return expanded;
}

/**
 * Score tables based on keyword matches in the question
 */
export function scoreTablesForQuestion(question: string, modeTables: string[]): TableRelevance[] {
  const normalizedQuestion = expandSynonyms(normalizeText(question));
  const questionWords = new Set(normalizedQuestion.split(' '));
  
  const scores: TableRelevance[] = [];
  
  for (const fullTableName of modeTables) {
    const tableName = fullTableName.replace('publish.', '');
    const keywords = TABLE_KEYWORD_MAP[tableName] || [];
    
    let score = 0;
    const matchedKeywords: string[] = [];
    
    for (const keyword of keywords) {
      const normalizedKeyword = normalizeText(keyword);
      if (normalizedQuestion.includes(normalizedKeyword)) {
        score += 2;
        matchedKeywords.push(keyword);
      } else {
        for (const word of normalizedKeyword.split(' ')) {
          if (questionWords.has(word) && word.length > 2) {
            score += 1;
            if (!matchedKeywords.includes(word)) {
              matchedKeywords.push(word);
            }
          }
        }
      }
    }
    
    scores.push({
      tableName: fullTableName,
      score,
      matchedKeywords,
    });
  }
  
  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Select the top N most relevant tables for a question
 * Returns 2-4 tables based on score distribution
 */
export function selectRelevantTables(
  question: string, 
  modeTables: string[],
  minTables: number = 2,
  maxTables: number = 4
): { tables: string[]; reasoning: string } {
  const scores = scoreTablesForQuestion(question, modeTables);
  
  if (scores.length === 0) {
    return { tables: modeTables, reasoning: 'No keyword matches, using all mode tables' };
  }
  
  const relevantTables: string[] = [];
  const matchedKeywords: string[] = [];
  
  for (const { tableName, score, matchedKeywords: keywords } of scores) {
    if (score > 0 && relevantTables.length < maxTables) {
      relevantTables.push(tableName);
      matchedKeywords.push(...keywords.filter(k => !matchedKeywords.includes(k)));
    }
  }
  
  if (relevantTables.length < minTables) {
    for (const { tableName } of scores) {
      if (!relevantTables.includes(tableName) && relevantTables.length < minTables) {
        relevantTables.push(tableName);
      }
    }
  }
  
  if (relevantTables.length === 0) {
    return { 
      tables: modeTables.slice(0, maxTables), 
      reasoning: 'No keyword matches, using first tables from mode' 
    };
  }
  
  return {
    tables: relevantTables,
    reasoning: `Selected ${relevantTables.length} tables based on keywords: ${matchedKeywords.slice(0, 5).join(', ')}`,
  };
}

/**
 * Get relevant tables for a question within a specific mode
 */
export function getRelevantTablesForMode(question: string, mode: string): { tables: string[]; reasoning: string } {
  const catalog = loadCatalog();
  const modeConfig = catalog.modes.find(m => m.id === mode);
  
  if (!modeConfig) {
    return { tables: [], reasoning: `Unknown mode: ${mode}` };
  }
  
  return selectRelevantTables(question, modeConfig.tables);
}
