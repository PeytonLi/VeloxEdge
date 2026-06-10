'use client';
// ═══════════════════════════════════════════════════════════════
// FROZEN SHELL — Agent C fills section content inside each zone.
// Do not change zone IDs or the 3-pane grid structure.
// ═══════════════════════════════════════════════════════════════

import Console from '@/components/Console';
import InterceptorOverlay from '@/components/InterceptorOverlay';
import LatencyPanel from '@/components/LatencyPanel';
import CounterCards from '@/components/CounterCards';
import CovarianceHeatmap from '@/components/CovarianceHeatmap';
import ConvergenceChart from '@/components/ConvergenceChart';
import WhatIfBoard from '@/components/WhatIfBoard';

export default function Dashboard() {
  return (
    <main className="min-h-screen flex flex-col">
      {/* Header */}
      <header
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}
      >
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent-glow)' }}>
          ⚡ VELOXEDGE
        </span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>
          Predictive Latent Bandit Caching · LinUCB Edge Engine · Inference Hack Day 2026
        </span>
      </header>

      {/* 3-Zone Grid — matches PRD §5.1 layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: 'auto auto',
          flex: 1,
          gap: '1px',
          background: 'var(--border)',
        }}
      >
        {/* ZONE A — The Problem & Solution Analytics */}
        <section
          id="zone-a"
          style={{
            background: 'var(--bg-surface)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <h2 style={{ color: 'var(--accent-glow)', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            A · Latency Analytics
          </h2>
          <CounterCards />
          <LatencyPanel />
        </section>

        {/* ZONE C — Active Workspace Simulation (spans both rows on right) */}
        <section
          id="zone-c"
          style={{
            background: 'var(--bg-surface)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            gridRow: '1 / 3',
          }}
        >
          <h2 style={{ color: 'var(--accent-glow)', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            C · Active Simulation
          </h2>
          <Console />
          <InterceptorOverlay />
        </section>

        {/* ZONE B — Math Co-processor */}
        <section
          id="zone-b"
          style={{
            background: 'var(--bg-surface)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <h2 style={{ color: 'var(--accent-glow)', fontSize: 11, letterSpacing: 2, textTransform: 'uppercase' }}>
            B · Math Co-processor
          </h2>
          <CovarianceHeatmap />
          <ConvergenceChart />
          <WhatIfBoard />
        </section>
      </div>
    </main>
  );
}
