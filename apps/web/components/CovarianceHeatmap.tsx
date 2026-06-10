'use client';

import type { EngineSnapshot } from '@veloxedge/bandit-engine';
import { ACTIONS, VIZ_DIMENSIONS, actionCopy, createDemoSnapshot } from './dashboardData';

interface CovarianceHeatmapProps {
  snapshot?: EngineSnapshot | null;
  activeAction?: string;
}

export default function CovarianceHeatmap({
  snapshot = createDemoSnapshot(),
  activeAction = 'TOOL_CONTEXT',
}: CovarianceHeatmapProps) {
  const data = snapshot ?? createDemoSnapshot();
  const actions = Object.keys(data.aInvDiag).length > 0 ? Object.keys(data.aInvDiag) : [...ACTIONS];
  const variances = actions.flatMap((action) => data.aInvDiag[action] ?? []);
  const maxVariance = Math.max(...variances, 1);
  const minVariance = Math.min(...variances, 0);
  const spread = Math.max(0.001, maxVariance - minVariance);

  return (
    <article className="chart-card heatmap-card">
      <div className="panel-title-row">
        <div>
          <span className="micro-label">Covariance variance heatmap</span>
          <h3>A⁻¹ diagonal cools as the engine learns</h3>
        </div>
        <div className="variance-key">
          <span>cool</span>
          <i />
          <span>explore</span>
        </div>
      </div>

      <div className="heatmap-shell">
        <div className="dimension-ruler">
          {VIZ_DIMENSIONS.map((dimension) => <span key={dimension}>{dimension}</span>)}
        </div>
        {actions.map((action) => {
          const copy = actionCopy(action);
          const values = data.aInvDiag[action] ?? Array.from({ length: VIZ_DIMENSIONS.length }, () => 0.4);
          return (
            <div className={`heatmap-row ${action === activeAction ? 'heatmap-row-active' : ''}`} key={action}>
              <strong style={{ color: copy.accent }}>{copy.shortLabel}</strong>
              <div className="heatmap-grid">
                {values.slice(0, VIZ_DIMENSIONS.length).map((value, index) => {
                  const normalized = (value - minVariance) / spread;
                  const amber = Math.round(80 + normalized * 175);
                  const cyan = Math.round(210 - normalized * 110);
                  return (
                    <span
                      className="heat-cell"
                      key={`${action}-${VIZ_DIMENSIONS[index]}`}
                      title={`${copy.label} · ${VIZ_DIMENSIONS[index]} · variance ${value.toFixed(3)}`}
                      style={{
                        background: `rgba(${amber}, ${Math.round(150 + normalized * 75)}, ${cyan}, ${0.22 + normalized * 0.58})`,
                        boxShadow: normalized > 0.62 ? `0 0 ${8 + normalized * 18}px rgba(245, 158, 11, ${normalized * 0.36})` : undefined,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ucb-breakdown">
        {(data.lastUcb.length > 0 ? data.lastUcb : createDemoSnapshot().lastUcb).slice(0, 4).map((entry) => {
          const copy = actionCopy(entry.action);
          const width = `${Math.min(100, Math.max(8, entry.ucbValue * 44))}%`;
          return (
            <div className="ucb-line" key={entry.action}>
              <span>{copy.shortLabel}</span>
              <div><i style={{ width, background: copy.accent }} /></div>
              <em>{entry.ucbValue.toFixed(2)} ucb</em>
            </div>
          );
        })}
      </div>
    </article>
  );
}
