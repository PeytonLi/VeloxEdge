'use client';

import type { InterceptorEvent } from '@/hooks/useVeloxEngine';
import { actionCopy, buildFallbackEvents } from './dashboardData';

interface InterceptorOverlayProps {
  events?: InterceptorEvent[];
  activeAction?: string;
  activeStepLabel?: string;
  ready?: boolean;
}

const fallbackEvents = buildFallbackEvents(0, 'TOOL_CONTEXT', 'Awaiting first latent trajectory', true);

export default function InterceptorOverlay({
  events = fallbackEvents,
  activeAction = 'TOOL_CONTEXT',
  activeStepLabel = 'Awaiting first latent trajectory',
  ready = false,
}: InterceptorOverlayProps) {
  const copy = actionCopy(activeAction);
  const visibleEvents = events.length > 0 ? events : fallbackEvents;

  return (
    <article className="interceptor-card">
      <div className="panel-title-row">
        <div>
          <span className="micro-label">Speculative action interceptor</span>
          <h3 style={{ color: copy.accent }}>{copy.interceptor}</h3>
        </div>
        <div className="edge-route">
          <span>agent</span>
          <i />
          <span>VeloxEdge</span>
          <i />
          <span>Akamai edge</span>
        </div>
      </div>

      <div className="active-prefetch" style={{ background: copy.softAccent, borderColor: copy.accent }}>
        <span className="radar-dot" style={{ background: copy.accent }} />
        <div>
          <strong>{copy.asset}</strong>
          <p>{activeStepLabel}</p>
        </div>
        <em>{ready ? 'live engine' : 'demo telemetry'}</em>
      </div>

      <div className="stream-window">
        {visibleEvents.map((event, index) => {
          const eventCopy = actionCopy(event.action);
          return (
            <div className="stream-line" key={`${event.timestamp}-${index}`}>
              <span className="stream-time">{String(event.timestamp).padStart(3, '0')}ms</span>
              <span className="stream-led" style={{ background: event.cacheHit ? eventCopy.accent : '#fb923c' }} />
              <code>{event.message}</code>
            </div>
          );
        })}
      </div>
    </article>
  );
}
