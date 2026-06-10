"use client";

import { ACTIONS, actionCopy } from "./dashboardData";

type VeloxEngineMode = "local" | "edge";
type EdgeStatus = "idle" | "ok" | "fallback" | "error";

interface WhatIfBoardProps {
  alpha?: number;
  onAlphaChange?: (alpha: number) => void;
  activeAction?: string;
  dimensions?: number;
  ready?: boolean;
  mode?: VeloxEngineMode;
  onModeChange?: (mode: VeloxEngineMode) => void;
  edgeRttMs?: number | null;
  edgeComputeMicros?: number | null;
  edgeStatus?: EdgeStatus;
  edgeError?: string | null;
}

function formatLatency(value: number | null | undefined, suffix: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(suffix === "µs" ? 0 : 1) + suffix;
}

export default function WhatIfBoard({
  alpha = 1.05,
  onAlphaChange,
  activeAction = "TOOL_CONTEXT",
  dimensions = 12,
  ready = false,
  mode = "local",
  onModeChange,
  edgeRttMs = null,
  edgeComputeMicros = null,
  edgeStatus = "idle",
  edgeError = null,
}: WhatIfBoardProps) {
  const active = actionCopy(activeAction);
  const explorationMode =
    alpha < 0.8
      ? "Exploit learned winner"
      : alpha > 1.45
        ? "Probe uncertain arms"
        : "Balanced edge budget";
  const modeCopy = mode === "edge" ? "LIVE EDGE" : "LOCAL";
  const statusCopy =
    edgeStatus === "ok"
      ? "edge emulator/live route healthy"
      : edgeStatus === "fallback"
        ? "edge failed; local fallback served this step"
        : edgeStatus === "error"
          ? "edge unavailable"
          : mode === "edge"
            ? "waiting for first edge step"
            : "browser engine active";

  return (
    <article className="whatif-card">
      <div className="panel-title-row">
        <div>
          <span className="micro-label">What-if control board</span>
          <h3>Re-parameterize α and route inference live</h3>
        </div>
        <span className="alpha-readout">α {alpha.toFixed(2)}</span>
      </div>

      <div className="edge-mode-board" aria-label="VeloxEdge runtime mode">
        <div>
          <span className="micro-label">Runtime mode</span>
          <strong>{modeCopy}</strong>
          <em>{statusCopy}</em>
        </div>
        <div className="mode-toggle" role="group" aria-label="Switch runtime mode">
          <button
            className={mode === "local" ? "mode-button mode-button-active" : "mode-button"}
            type="button"
            onClick={() => onModeChange?.("local")}
          >
            Local
          </button>
          <button
            className={mode === "edge" ? "mode-button mode-button-active" : "mode-button"}
            type="button"
            onClick={() => onModeChange?.("edge")}
          >
            Live edge
          </button>
        </div>
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
          <span>Edge RTT</span>
          <strong>{formatLatency(edgeRttMs, "ms")}</strong>
          <em>{mode === "edge" ? "browser measured route round-trip" : "switch live edge to measure"}</em>
        </div>
        <div>
          <span>Compute budget</span>
          <strong>{formatLatency(edgeComputeMicros, "µs")}</strong>
          <em>worker/emulator measured LinUCB time</em>
        </div>
        <div>
          <span>Engine source</span>
          <strong>{ready ? modeCopy : "UI fallback"}</strong>
          <em>{edgeError ?? (ready ? active.asset : "synthetic fallback before hydration")}</em>
        </div>
      </div>

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
          <span>Route status</span>
          <strong>{edgeStatus}</strong>
          <em>{statusCopy}</em>
        </div>
      </div>

      <div className="arm-chip-row">
        {ACTIONS.map((action) => {
          const copy = actionCopy(action);
          return (
            <span
              className={action === activeAction ? "arm-chip arm-chip-active" : "arm-chip"}
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
