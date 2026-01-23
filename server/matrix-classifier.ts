import analyticsReference from '../src/config/analytics_reference.json';

interface MatrixMatch {
  keywords: string[];
  tier1Tables: string[];
  tier2Tables: string[];
  matchScore: number;
  override?: boolean;
  contextHint?: string;
}

interface ClassificationResult {
  selectedTables: string[];
  matchedKeywords: string[];
  matchedTerms: string[];
  contextHints: string[];
  isOverride: boolean;
  confidence: 'high' | 'medium' | 'low' | 'none';
  debugInfo: {
    matrixMatches: MatrixMatch[];
    termMatches: string[];
    originalQuestion: string;
  };
}

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchKeywords(normalizedQuestion: string, keywords: string[]): { matched: string[]; score: number } {
  const matched: string[] = [];
  let score = 0;
  
  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase();
    if (normalizedQuestion.includes(keywordLower)) {
      matched.push(keyword);
      score += keywordLower.split(' ').length;
    }
  }
  
  return { matched, score };
}

export function classifyQuestionWithMatrix(
  question: string
): ClassificationResult {
  const normalizedQuestion = normalizeQuestion(question);
  const matrixMatches: MatrixMatch[] = [];
  const allMatchedKeywords: string[] = [];
  let hasOverride = false;
  
  for (const rule of analyticsReference.overrideRules) {
    for (const trigger of rule.triggers) {
      if (normalizedQuestion.includes(trigger.toLowerCase())) {
        hasOverride = true;
        console.log(`[matrix-classifier] Override rule triggered: "${trigger}" → ${rule.requiredTables.join(', ')}`);
        break;
      }
    }
  }
  
  for (const entry of analyticsReference.matrix) {
    const { matched, score } = matchKeywords(normalizedQuestion, entry.keywords);
    
    if (matched.length > 0) {
      matrixMatches.push({
        keywords: matched,
        tier1Tables: entry.tier1Tables,
        tier2Tables: entry.tier2Tables || [],
        matchScore: score,
        override: (entry as any).override,
        contextHint: (entry as any).contextHint
      });
      allMatchedKeywords.push(...matched);
    }
  }
  
  matrixMatches.sort((a, b) => b.matchScore - a.matchScore);
  
  const selectedTables: Set<string> = new Set();
  
  if (hasOverride) {
    for (const rule of analyticsReference.overrideRules) {
      for (const trigger of rule.triggers) {
        if (normalizedQuestion.includes(trigger.toLowerCase())) {
          rule.requiredTables.forEach(t => selectedTables.add(t));
          break;
        }
      }
    }
  }
  
  const topMatches = matrixMatches.slice(0, 3);
  for (const match of topMatches) {
    for (const table of match.tier1Tables) {
      if (selectedTables.size < analyticsReference.promptTrimming.maxTableCount) {
        selectedTables.add(table);
      }
    }
  }
  
  if (selectedTables.size === 0) {
    selectedTables.add('publish.DASHt_Planning');
    selectedTables.add('publish.DASHt_Resources');
    console.log('[matrix-classifier] No matrix matches, using default tables: DASHt_Planning, DASHt_Resources');
  }
  
  while (selectedTables.size < analyticsReference.promptTrimming.defaultTableCount && matrixMatches.length > 0) {
    for (const match of matrixMatches) {
      for (const table of match.tier1Tables) {
        if (!selectedTables.has(table) && selectedTables.size < analyticsReference.promptTrimming.defaultTableCount) {
          selectedTables.add(table);
        }
      }
    }
    break;
  }
  
  const termMatches: string[] = [];
  for (const term of analyticsReference.terms) {
    const termLower = term.name.toLowerCase();
    if (normalizedQuestion.includes(termLower)) {
      termMatches.push(term.name);
    }
  }
  
  // Determine confidence based on match quality
  let confidence: 'high' | 'medium' | 'low' | 'none';
  const totalScore = matrixMatches.reduce((sum, m) => sum + m.matchScore, 0);
  const keywordCount = allMatchedKeywords.length;
  
  if (hasOverride || totalScore >= 3 || keywordCount >= 2) {
    confidence = 'high';
  } else if (totalScore >= 1 || keywordCount >= 1 || termMatches.length > 0) {
    confidence = 'medium';
  } else if (matrixMatches.length > 0) {
    confidence = 'low';
  } else {
    confidence = 'none';
  }
  
  const contextHints = matrixMatches
    .filter(m => m.contextHint)
    .map(m => m.contextHint as string);
  
  const result: ClassificationResult = {
    selectedTables: Array.from(selectedTables),
    matchedKeywords: Array.from(new Set(allMatchedKeywords)),
    matchedTerms: termMatches,
    contextHints,
    isOverride: hasOverride,
    confidence,
    debugInfo: {
      matrixMatches,
      termMatches,
      originalQuestion: question
    }
  };
  
  console.log(`[matrix-classifier] Question: "${question}"`);
  console.log(`[matrix-classifier] Matched keywords: ${result.matchedKeywords.join(', ') || 'none'}`);
  console.log(`[matrix-classifier] Confidence: ${confidence}`);
  console.log(`[matrix-classifier] Selected tables (${result.selectedTables.length}): ${result.selectedTables.join(', ')}`);
  if (termMatches.length > 0) {
    console.log(`[matrix-classifier] Business terms matched: ${termMatches.join(', ')}`);
  }
  if (contextHints.length > 0) {
    console.log(`[matrix-classifier] Context hints: ${contextHints.length} hint(s)`);
  }
  
  return result;
}

export function getBusinessTermContext(matchedTerms: string[]): string {
  if (matchedTerms.length === 0) return '';
  
  const termContexts: string[] = [];
  
  for (const termName of matchedTerms.slice(0, 10)) {
    const term = analyticsReference.terms.find(t => t.name === termName);
    if (term) {
      termContexts.push(`- ${term.name}: ${term.description}. Computation: ${term.computation}`);
    }
  }
  
  if (termContexts.length === 0) return '';
  
  return `
RELEVANT BUSINESS TERMS:
${termContexts.join('\n')}
`;
}

export function getRelevantColumns(
  question: string,
  table: string,
  allColumns: string[]
): string[] {
  const normalizedQuestion = normalizeQuestion(question);
  const tableKeywords = analyticsReference.tableKeywords[table as keyof typeof analyticsReference.tableKeywords] || [];
  const maxColumns = analyticsReference.promptTrimming.maxColumnsPerTable;
  const alwaysInclude = analyticsReference.promptTrimming.alwaysIncludeColumns;
  
  const relevantColumns: Set<string> = new Set();
  
  for (const col of allColumns) {
    const colLower = col.toLowerCase();
    for (const keyword of alwaysInclude) {
      if (colLower.includes(keyword.toLowerCase())) {
        relevantColumns.add(col);
        break;
      }
    }
  }
  
  for (const col of allColumns) {
    if (relevantColumns.size >= maxColumns) break;
    const colLower = col.toLowerCase();
    
    for (const keyword of tableKeywords) {
      if (colLower.includes(keyword.toLowerCase())) {
        relevantColumns.add(col);
        break;
      }
    }
  }
  
  const questionWords = normalizedQuestion.split(' ').filter(w => w.length > 3);
  for (const col of allColumns) {
    if (relevantColumns.size >= maxColumns) break;
    const colLower = col.toLowerCase();
    
    for (const word of questionWords) {
      if (colLower.includes(word)) {
        relevantColumns.add(col);
        break;
      }
    }
  }
  
  if (relevantColumns.size < 10) {
    for (const col of allColumns) {
      if (relevantColumns.size >= maxColumns) break;
      relevantColumns.add(col);
    }
  }
  
  return Array.from(relevantColumns);
}
