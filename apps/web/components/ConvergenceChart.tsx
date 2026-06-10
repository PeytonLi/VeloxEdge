'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { initialConvergence, type ConvergencePoint } from './dashboardData';

interface ConvergenceChartProps {
  data?: ConvergencePoint[];
}

export default function ConvergenceChart({ data = initialConvergence() }: ConvergenceChartProps) {
  const safeData = data.length > 1 ? data : initialConvergence();

  return (
    <article className="chart-card convergence-card">
      <div className="panel-title-row">
        <div>
          <span className="micro-label">θ̂ convergence trace</span>
          <h3>Arm weights stabilize after repeated latent turns</h3>
        </div>
      </div>
      <div className="chart-frame convergence-frame">
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={safeData} margin={{ top: 18, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
            <XAxis dataKey="step" stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} />
            <YAxis stroke="#64748b" tickLine={false} axisLine={false} tick={{ fontSize: 10 }} domain={[0, 'dataMax + 0.15']} />
            <Tooltip
              cursor={{ stroke: '#67e8f9', strokeOpacity: 0.25 }}
              contentStyle={{
                background: 'rgba(5, 9, 20, 0.94)',
                border: '1px solid rgba(103, 232, 249, 0.28)',
                borderRadius: 14,
                color: '#e2e8f0',
              }}
              labelFormatter={(label) => `turn ${label}`}
            />
            <Line dataKey="tool" name="Tool context" stroke="#67e8f9" strokeWidth={2.2} dot={false} type="monotone" />
            <Line dataKey="memory" name="EdgeKV memory" stroke="#f59e0b" strokeWidth={2.2} dot={false} type="monotone" />
            <Line dataKey="vector" name="Vector weights" stroke="#a3e635" strokeWidth={2.2} dot={false} type="monotone" />
            <Line dataKey="noOp" name="No-op" stroke="#94a3b8" strokeWidth={1.6} dot={false} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
