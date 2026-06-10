import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  transpilePackages: ['@veloxedge/bandit-engine'],
  // Point to monorepo root so Next.js doesn't pick up the parent pnpm-lock.yaml
  outputFileTracingRoot: path.join(__dirname, '../../'),
};

export default nextConfig;
