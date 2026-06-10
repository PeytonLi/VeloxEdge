import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VeloxEdge — Predictive Latent Bandit Caching',
  description:
    'A LinUCB contextual bandit dashboard for speculative edge pre-fetching in agentic workflows.',
};

export const viewport: Viewport = {
  themeColor: '#050914',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
