'use client';

import type { LatencyStats } from '@/lib/simulation';
import { actionCopy, calculateImprovement, createEmptyStats, formatMs, formatNumber } from './dashboardData';

interface CounterCardsProps {
  stats?: LatencyStats;
  improvement?: number;
  activeAction?: string;
  ready?: boolean;
}

export default function CounterCards({
  stats = createEmptyStats(),
  improvement = calculateImprovement(stats),
  activeAction = 'TOOL_CONTEXT',
  ready = false,
}: CounterCardsProps) {
  const hitRate = stats.totalSteps === 0 ? 0 : (stats.cacheHits / stats.totalSteps) * 100;
  const active = actionCopy(activeAction);
  const cards = [
    {
      label: 'Edge Hits',
      value: formatNumber(stats.cacheHits),
      detail: `${hitRate.toFixed(0)}% hit confidence`,
      tone: 'cyan',
    },
    {
      label: 'Cold Pulls',
      value: formatNumber(stats.coldFetches),
      detail: 'origin round-trips avoided after warmup',
      tone: 'amber',
    },
    {
      label: 'Time-Saved Dividend',
      value: formatMs(stats.totalSavedMs),
      detail: `${formatMs(stats.naiveTotalMs)} naive baseline`,
      tone: 'lime',
    },
    {
      label: 'Improvement',
      value: `${Math.max(0, improvement).toFixed(0)}%`,
      detail: ready ? 'live engine telemetry' : 'UI demo fallback until hook lands',
      tone: 'blue',
    },
  ];

  return (
    <div className="counter-panel">
      <div className="counter-status" style={{ borderColor: active.accent }}>
        <span className="status-pulse" style={{ background: active.accent }} />
        <div>
          <strong>{active.label}</strong>
          <p>{active.description}</p>
        </div>
      </div>
      <div className="counter-grid">
        {cards.map((card) => (
          <article className={`metric-card metric-${card.tone}`} key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <em>{card.detail}</em>
          </article>
        ))}
      </div>
    </div>
  );
}
