"use client";

import type { EngineSnapshot } from "@veloxedge/bandit-engine";
import {
  ACTIONS,
  VIZ_DIMENSIONS,
  actionCopy,
  createDemoSnapshot,
} from "./dashboardData";

interface CovarianceHeatmapProps {
  snapshot?: EngineSnapshot | null;
  activeAction?: string;
}

export default function CovarianceHeatmap({
  snapshot = createDemoSnapshot(),
  activeAction = "TOOL_CONTEXT",
}: CovarianceHeatmapProps) {
  const data = snapshot ?? createDemoSnapshot();
  const actions =
    Object.keys(data.aInvDiag).length > 0
      ? Object.keys(data.aInvDiag)
      : [...ACTIONS];
  const allValues = actions.flatMap((a) => data.aInvDiag[a] ?? []);
  const maxVariance = Math.max(...allValues, 1);

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
        {actions.map((action) => {
          const copy = actionCopy(action);
          const values = data.aInvDiag[action] ?? [];
          const avgVariance =
            values.length > 0
              ? values.reduce((s, v) => s + v, 0) / values.length
              : 0;
          const isActive = action === activeAction;
          const barWidth = Math.min(100, Math.max(4, (avgVariance / maxVariance) * 100));

          const topDims = VIZ_DIMENSIONS.map((dim, i) => ({
            dim,
            value: values[i] ?? 0,
          }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 3);

          return (
            <div className="heatmap-row" key={action}>
              <div className="heatmap-row-header">
                <strong
                  style={{
                    color: copy.accent,
                    opacity: isActive ? 1 : 0.7,
                  }}
                >
                  {isActive ? "● " : ""}
                  {copy.shortLabel}
                </strong>
                <div style={{ flex: 1, position: "relative", height: 7 }}>
                  <div
                    className="heatmap-var-bar"
                    style={{
                      width: `${barWidth}%`,
                      background: `linear-gradient(90deg,
                        rgba(103, 232, 249, 0.7),
                        rgba(245, 158, 11, ${0.4 + (avgVariance / maxVariance) * 0.55})
                      )`,
                      boxShadow: avgVariance > 0.5
                        ? `0 0 ${6 + avgVariance * 10}px rgba(245, 158, 11, ${avgVariance * 0.25})`
                        : undefined,
                    }}
                  />
                </div>
                <em>{avgVariance.toFixed(3)}</em>
              </div>
              <div className="heatmap-dimension-labels">
                {topDims.map(({ dim, value }) => (
                  <span
                    className={`heatmap-dim-tag ${value > 0.5 ? "heatmap-dim-tag-high" : ""}`}
                    key={dim}
                    title={`${dim}: ${value.toFixed(3)}`}
                  >
                    {dim}
                  </span>
                ))}
                {VIZ_DIMENSIONS.length - 3 > 0 && (
                  <span className="heatmap-dim-tag">
                    +{VIZ_DIMENSIONS.length - 3}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ucb-breakdown">
        {(data.lastUcb.length > 0
          ? data.lastUcb
          : createDemoSnapshot().lastUcb
        )
          .slice(0, 4)
          .map((entry) => {
            const copy = actionCopy(entry.action);
            const width = `${Math.min(100, Math.max(8, entry.ucbValue * 44))}%`;
            return (
              <div className="ucb-line" key={entry.action}>
                <span>{copy.shortLabel}</span>
                <div>
                  <i style={{ width, background: copy.accent }} />
                </div>
                <em>{entry.ucbValue.toFixed(2)} ucb</em>
              </div>
            );
          })}
      </div>
    </article>
  );
}
