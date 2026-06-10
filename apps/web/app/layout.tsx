import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VeloxEdge — Predictive Latent Bandit Caching',
  description:
    'LinUCB contextual bandit engine for speculative edge pre-fetching in agentic workflows.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
