'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMs, initialTimeline, type TimelinePoint } from './dashboardData';

interface LatencyPanelProps {
  data?: TimelinePoint[];
  improvement?: number;
}

export default function LatencyPanel({ data = initialTimeline(), improvement = 0 }: LatencyPanelProps) {
  const safeData = data.length > 0 ? data : initialTimeline();
  const latest = safeData[safeData.length - 1];

  return (
    <article className="chart-card latency-card">
      <div className="panel-title-row">
        <div>
          <span className="micro-label">Cumulative latency replay</span>
          <h3>Naive string cache loses to latent prefetch</h3>
        </div>
        <div className="dividend-pill">{Math.max(0, improvement).toFixed(0)}% faster</div>
      </div>

      <div className="latency-total-strip">
        <div>
          <span>Naive cache</span>
          <strong>{formatMs(latest.naive)}</strong>
        </div>
        <div>
          <span>VeloxEdge</span>
          <strong>{formatMs(latest.velox)}</strong>
        </div>
        <div>
          <span>Saved</span>
          <strong>{formatMs(latest.saved)}</strong>
        </div>
      </div>

      <div className="chart-frame">
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={safeData} margin={{ top: 16, right: 10, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="naiveGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f97316" stopOpacity={0.32} />
                <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="veloxGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#67e8f9" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#67e8f9" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
            <XAxis dataKey="step" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} tickFormatter={formatMs} />
            <Tooltip
              cursor={{ stroke: '#67e8f9', strokeOpacity: 0.3 }}
              contentStyle={{
                background: 'rgba(5, 9, 20, 0.94)',
                border: '1px solid rgba(103, 232, 249, 0.28)',
                borderRadius: 14,
                color: '#e2e8f0',
              }}
              formatter={(value) => formatMs(Number(value))}
              labelFormatter={(label) => `turn ${label}`}
            />
            <Area type="monotone" dataKey="naive" stroke="#fb923c" fill="url(#naiveGradient)" strokeWidth={2.2} name="Naive" />
            <Area type="monotone" dataKey="velox" stroke="#67e8f9" fill="url(#veloxGradient)" strokeWidth={2.8} name="VeloxEdge" />
            <Line type="monotone" dataKey="saved" stroke="#a3e635" strokeWidth={1.6} dot={false} name="Saved" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
