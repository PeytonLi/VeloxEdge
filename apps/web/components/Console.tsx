'use client';

import { FormEvent, useState } from 'react';
import type { Journey } from '@/lib/simulation';
import { DEMO_JOURNEYS } from './dashboardData';

interface ConsoleProps {
  journeys?: Journey[];
  selectedJourneyId?: string;
  prompt?: string;
  onPromptChange?: (value: string) => void;
  onSelectJourney?: (journeyId: string) => void;
  onStep?: () => Promise<void> | void;
  onRunJourney?: () => Promise<void> | void;
  onReset?: () => void;
  isRunning?: boolean;
  ready?: boolean;
  alpha?: number;
  activeStepLabel?: string;
}

const STEPPER = [
  { time: '001µs', label: 'Prompt delta hashed', description: 'deterministic keyword → latent vector' },
  { time: '006µs', label: 'A⁻¹ variance read', description: 'per-arm covariance confidence' },
  { time: '013µs', label: 'LinUCB argmax', description: 'reward + α·exploration bonus' },
  { time: '021µs', label: 'Edge prefetch issued', description: 'asset staged near the agent' },
];

export default function Console({
  journeys = DEMO_JOURNEYS,
  selectedJourneyId = DEMO_JOURNEYS[0].id,
  prompt = '',
  onPromptChange,
  onSelectJourney,
  onStep,
  onRunJourney,
  onReset,
  isRunning = false,
  ready = false,
  alpha = 1.05,
  activeStepLabel = 'Awaiting first latent trajectory',
}: ConsoleProps) {
  const [localBusy, setLocalBusy] = useState(false);
  const busy = isRunning || localBusy;
  const selectedJourney = journeys.find((journey) => journey.id === selectedJourneyId) ?? journeys[0] ?? DEMO_JOURNEYS[0];

  const invoke = async (callback?: () => Promise<void> | void) => {
    if (!callback) return;
    setLocalBusy(true);
    try {
      await callback();
    } finally {
      setLocalBusy(false);
    }
  };

  const submitPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await invoke(onStep);
  };

  return (
    <article className="console-card">
      <div className="console-topline">
        <div>
          <span className="micro-label">Active workspace simulator</span>
          <h3>Judge prompt → latent vector → speculative edge action</h3>
        </div>
        <span className={`engine-badge ${ready ? 'engine-live' : 'engine-demo'}`}>
          {ready ? 'Hook live' : 'UI fallback'} · α {alpha.toFixed(2)}
        </span>
      </div>

      <form className="prompt-console" onSubmit={submitPrompt}>
        <label htmlFor="journey-select">Scripted trajectory</label>
        <select
          id="journey-select"
          value={selectedJourney.id}
          onChange={(event) => onSelectJourney?.(event.target.value)}
          disabled={busy}
        >
          {journeys.map((journey) => (
            <option value={journey.id} key={journey.id}>{journey.name}</option>
          ))}
        </select>

        <label htmlFor="free-prompt">Free-text agent turn</label>
        <textarea
          id="free-prompt"
          value={prompt}
          rows={4}
          onChange={(event) => onPromptChange?.(event.target.value)}
          placeholder="Ask for schema, memory, vector search, or a mutated agent prompt…"
          disabled={busy}
        />

        <div className="console-actions">
          <button className="primary-action" type="submit" disabled={busy}>
            {busy ? 'Stepping…' : 'Run one bandit step'}
          </button>
          <button className="ghost-action" type="button" onClick={() => invoke(onRunJourney)} disabled={busy}>
            Replay journey
          </button>
          <button className="ghost-action subtle" type="button" onClick={onReset} disabled={busy}>
            Reset
          </button>
        </div>
      </form>

      <div className="journey-context">
        <strong>{selectedJourney.name}</strong>
        <p>{selectedJourney.description}</p>
        <span>{selectedJourney.steps.length || DEMO_JOURNEYS[0].steps.length} latent turns · current: {activeStepLabel}</span>
      </div>

      <div className="micro-stepper" aria-label="Microsecond execution stepper">
        {STEPPER.map((step, index) => (
          <div className={`micro-step ${busy || index < 3 ? 'micro-step-active' : ''}`} key={step.label}>
            <span>{step.time}</span>
            <strong>{step.label}</strong>
            <em>{step.description}</em>
          </div>
        ))}
      </div>
    </article>
  );
}
