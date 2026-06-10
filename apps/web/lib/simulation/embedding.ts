// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

import type { Journey, JourneyStep } from './journeys';

const DOMAIN_KEYWORDS: Record<string, string[]> = {
  'data-analysis': [
    'analysis',
    'analytics',
    'anomaly',
    'chart',
    'cohort',
    'csv',
    'dashboard',
    'data',
    'kpi',
    'metric',
    'notebook',
    'query',
    'revenue',
    'sql',
    'warehouse',
  ],
  'code-generation': [
    'api',
    'build',
    'bug',
    'code',
    'compile',
    'component',
    'file',
    'function',
    'git',
    'package',
    'refactor',
    'repo',
    'repository',
    'test',
    'typescript',
  ],
  'customer-support': [
    'account',
    'billing',
    'complaint',
    'crm',
    'customer',
    'escalation',
    'policy',
    'refund',
    'reply',
    'sentiment',
    'sla',
    'subscription',
    'support',
    'ticket',
  ],
};

const ACTION_KEYWORDS: Record<string, string[]> = {
  TOOL_CONTEXT: [
    'adjustment',
    'api',
    'billing',
    'compiler',
    'crm',
    'diagnostic',
    'diagnostics',
    'package',
    'playbook',
    'query',
    'repo',
    'repository',
    'schema',
    'sql',
    'tool',
    'warehouse',
  ],
  EDGEKV_MEMORY: [
    'account',
    'analyst',
    'calendar',
    'conversation',
    'history',
    'memory',
    'preference',
    'previous',
    'promised',
    'recall',
    'reviewer',
    'session',
    'tier',
  ],
  VECTOR_WEIGHTS: [
    'embedding',
    'embeddings',
    'example',
    'examples',
    'kpi',
    'nearest',
    'policy',
    'related',
    'retrieval',
    'search',
    'semantic',
    'similar',
    'vector',
    'vectors',
  ],
  NO_OP: [
    'answer',
    'compose',
    'conclude',
    'draft',
    'explain',
    'final',
    'local',
    'noop',
    'response',
    'summarize',
    'write',
  ],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => Number((value / magnitude).toFixed(4)));
}

function resizeVector(values: number[], d: number): number[] {
  const vector = values.slice(0, d);
  while (vector.length < d) vector.push(0);
  return vector;
}

function scoreTokens(tokens: string[], keywords: string[]): number {
  return tokens.reduce((score, token) => {
    const exactHits = keywords.filter((keyword) => keyword === token).length;
    const fuzzyHits = keywords.filter(
      (keyword) => keyword.length > 3 && (token.includes(keyword) || keyword.includes(token)),
    ).length;
    return score + exactHits * 3 + fuzzyHits;
  }, 0);
}

function averageVector(steps: JourneyStep[], d: number): number[] {
  if (steps.length === 0) return normalize(hashedDrift(['empty'], d, 1));

  const totals = new Array(d).fill(0);
  for (const step of steps) {
    const vector = resizeVector(step.contextVector, d);
    for (let index = 0; index < d; index += 1) totals[index] += vector[index];
  }

  return normalize(totals.map((value) => value / steps.length));
}

function hashedDrift(tokens: string[], d: number, scale: number): number[] {
  const joined = tokens.length > 0 ? tokens.join('|') : 'veloxedge-empty-prompt';
  const drift = new Array(d).fill(0);
  let seed = hashText(joined);

  for (let index = 0; index < d; index += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const signedUnit = ((seed % 2001) - 1000) / 1000;
    drift[index] = signedUnit * scale;
  }

  return drift;
}

function pickJourney(tokens: string[], availableJourneys: Journey[]): Journey {
  const fallbackIndex = hashText(tokens.join('|')) % availableJourneys.length;
  let bestJourney = availableJourneys[fallbackIndex];
  let bestScore = -1;

  for (const journey of availableJourneys) {
    const score = scoreTokens(tokens, DOMAIN_KEYWORDS[journey.id] ?? []) + scoreTokens(tokens, tokenize(journey.name));
    if (score > bestScore) {
      bestScore = score;
      bestJourney = journey;
    }
  }

  return bestScore > 0 ? bestJourney : availableJourneys[fallbackIndex];
}

function pickAction(tokens: string[]): string | null {
  let bestAction: string | null = null;
  let bestScore = 0;

  for (const [action, keywords] of Object.entries(ACTION_KEYWORDS)) {
    const score = scoreTokens(tokens, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestAction = action;
    }
  }

  return bestAction;
}

function pickStep(tokens: string[], journey: Journey, action: string | null): JourneyStep | null {
  const actionCandidates = action === null ? journey.steps : journey.steps.filter((step) => step.bestAction === action);
  const candidates = actionCandidates.length > 0 ? actionCandidates : journey.steps;
  if (candidates.length === 0) return null;

  let bestStep = candidates[hashText(tokens.join('|')) % candidates.length];
  let bestScore = -1;

  for (const step of candidates) {
    const score = scoreTokens(tokens, tokenize(step.label));
    if (score > bestScore) {
      bestScore = score;
      bestStep = step;
    }
  }

  return bestStep;
}

/**
 * Map free-text user input to the context vector of the nearest journey cluster.
 * Implementation must be deterministic (no random, no external API calls).
 * Uses keyword→vector hashing so the demo never breaks on stage.
 *
 * @param text     - raw user text from the interactive console
 * @param journeys - available journeys to match against
 * @param d        - embedding dimension (must equal BanditConfig.dimensions)
 * @returns        - d-dimensional context vector
 */
export function embed(text: string, journeys: Journey[], d: number): number[] {
  const dimensions = Math.max(1, Math.floor(d));
  const tokens = tokenize(text);

  if (journeys.length === 0) {
    return normalize(hashedDrift(tokens, dimensions, 1));
  }

  const journey = pickJourney(tokens, journeys);
  const action = pickAction(tokens);
  const step = pickStep(tokens, journey, action);
  const baseVector = step === null ? averageVector(journey.steps, dimensions) : resizeVector(step.contextVector, dimensions);
  const drift = hashedDrift(tokens, dimensions, tokens.length > 0 ? 0.12 : 0.03);
  const vector = baseVector.map((value, index) => value + drift[index]);

  return normalize(vector);
}
