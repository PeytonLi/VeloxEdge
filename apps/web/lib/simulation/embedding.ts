// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT — Agent B fills implementation.
// ═══════════════════════════════════════════════════════════════

import type { Journey } from './journeys';

/**
 * Map free-text user input to the context vector of the nearest journey cluster.
 * Implementation must be deterministic (no random, no external API calls).
 * Uses keyword→vector hashing so the demo never breaks on stage.
 *
 * @param text     - raw user text from the interactive console
 * @param journeys - available journeys to match against
 * @param d        - embedding dimension (must equal BanditConfig.dimensions)
 * @returns        - d-dimensional context vector
 */
export function embed(text: string, journeys: Journey[], d: number): number[] {
  // Agent B implements deterministic keyword→cluster hashing
  throw new Error('Not implemented — Agent B');
}
