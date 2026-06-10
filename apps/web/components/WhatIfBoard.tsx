'use client';

import { ACTIONS, actionCopy } from './dashboardData';

interface WhatIfBoardProps {
  alpha?: number;
  onAlphaChange?: (alpha: number) => void;
  activeAction?: string;
  dimensions?: number;
  ready?: boolean;
}

export default function WhatIfBoard({
  alpha = 1.05,
  onAlphaChange,
  activeAction = 'TOOL_CONTEXT',
  dimensions = 12,
  ready = false,
}: WhatIfBoardProps) {
  const active = actionCopy(activeAction);
  const explorationMode = alpha < 0.8 ? 'Exploit learned winner' : alpha > 1.45 ? 'Probe uncertain arms' : 'Balanced edge budget';

  return (
    <article className="whatif-card">
      <div className="panel-title-row">
        <div>
          <span className="micro-label">What-if control board</span>
          <h3>Re-parameterize α without losing the session</h3>
        </div>
        <span className="alpha-readout">α {alpha.toFixed(2)}</span>
      </div>

      <label className="alpha-slider" htmlFor="alpha-range">
        <span>{explorationMode}</span>
        <input
          id="alpha-range"
          type="range"
          min="0.2"
          max="2.2"
          step="0.05"
          value={alpha}
          onChange={(event) => onAlphaChange?.(Number(event.target.value))}
        />
      </label>

      <div className="whatif-grid">
        <div>
          <span>Context dimensions</span>
          <strong>d={dimensions}</strong>
          <em>small enough for sub-ms closed-form UCB</em>
        </div>
        <div>
          <span>Selected arm</span>
          <strong style={{ color: active.accent }}>{active.shortLabel}</strong>
          <em>{active.asset}</em>
        </div>
        <div>
          <span>Engine source</span>
          <strong>{ready ? 'LinUCB hook' : 'UI fallback'}</strong>
          <em>{ready ? 'Agent B telemetry connected' : 'awaiting integration worktree'}</em>
        </div>
      </div>

      <div className="arm-chip-row">
        {ACTIONS.map((action) => {
          const copy = actionCopy(action);
          return (
            <span
              className={action === activeAction ? 'arm-chip arm-chip-active' : 'arm-chip'}
              style={{ borderColor: copy.accent, color: action === activeAction ? copy.accent : undefined }}
              key={action}
            >
              {copy.shortLabel}
            </span>
          );
        })}
      </div>
    </article>
  );
}
