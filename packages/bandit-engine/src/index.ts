// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT (class signature + constructor) — Agent A fills
// method bodies. Do not add/remove public methods or change types.
// ═══════════════════════════════════════════════════════════════

import {
  calculateVariance,
  dotProduct,
  invertMatrix,
  matrixVectorMultiply,
} from "./linalg";
import type {
  BanditConfig,
  EngineSnapshot,
  PredictionResult,
  UcbBreakdown,
} from "./types";

export type { BanditConfig, EngineSnapshot, PredictionResult, UcbBreakdown };

/**
 * Contextual Linear Upper Confidence Bound bandit (LinUCB).
 *
 * Selects the edge pre-fetch action that maximises the UCB criterion:
 *   a* = argmax_a [ xᵀθ̂_a + α·√(xᵀA_a⁻¹x) ]
 *
 * Updates are closed-form ridge regression increments — no gradient descent.
 */
export class LinUCBEngine {
  private readonly dimensions: number;
  private readonly alpha: number;
  private readonly actions: string[];

  /** Per-arm d×d covariance matrix A_a = DᵀD + I */
  private A: Record<string, number[][]>;
  /** Per-arm d×1 accumulator vector b_a */
  private b: Record<string, number[]>;
  /** Cached inverse of A_a (recomputed on each predict) */
  private AInv: Record<string, number[][]>;
  /** Last UCB breakdown for snapshot() */
  private lastUcb: UcbBreakdown[] = [];

  constructor(config: BanditConfig) {
    this.dimensions = config.dimensions;
    this.alpha = config.alpha;
    this.actions = config.actions;
    this.A = {};
    this.b = {};
    this.AInv = {};

    for (const action of this.actions) {
      this.A[action] = this.createIdentityMatrix(this.dimensions);
      this.b[action] = new Array(this.dimensions).fill(0);
      this.AInv[action] = this.createIdentityMatrix(this.dimensions); // A⁻¹ = I initially
    }
  }

  private createIdentityMatrix(dim: number): number[][] {
    const matrix: number[][] = [];
    for (let i = 0; i < dim; i++) {
      const row = new Array(dim).fill(0);
      row[i] = 1;
      matrix.push(row);
    }
    return matrix;
  }

  /**
   * Predict the optimal pre-fetch action for the given context vector.
   * Returns the winning action name plus the full UCB breakdown for visualization.
   */
  public predictNextAction(contextVector: number[]): PredictionResult {
    this.assertValidContextVector(contextVector);

    let winningAction = this.actions[0];
    let winningUcbValue = Number.NEGATIVE_INFINITY;
    const ucbBreakdown: UcbBreakdown[] = [];

    for (const action of this.actions) {
      this.AInv[action] = invertMatrix(this.A[action]);
      const thetaHat = matrixVectorMultiply(this.AInv[action], this.b[action]);
      const expectedReward = dotProduct(contextVector, thetaHat);
      const variance = calculateVariance(contextVector, this.AInv[action]);
      const explorationBonus = this.alpha * Math.sqrt(variance);
      const ucbValue = expectedReward + explorationBonus;

      ucbBreakdown.push({
        action,
        expectedReward,
        explorationBonus,
        ucbValue,
      });

      if (ucbValue > winningUcbValue) {
        winningAction = action;
        winningUcbValue = ucbValue;
      }
    }

    this.lastUcb = ucbBreakdown.map((breakdown) => ({ ...breakdown }));

    return {
      action: winningAction,
      ucbBreakdown: ucbBreakdown.map((breakdown) => ({ ...breakdown })),
    };
  }

  /**
   * Closed-form incremental weight update after observing a reward.
   * A_a ← A_a + xxᵀ
   * b_a ← b_a + r·x
   * No gradient descent, no key deletion.
   *
   * @param action        - the arm that was selected
   * @param contextVector - context vector x at the time of selection
   * @param reward        - normalized latency-reduction reward ∈ [0, 1]
   */
  public updateWeights(
    action: string,
    contextVector: number[],
    reward: number,
  ): void {
    this.assertKnownAction(action);
    this.assertValidContextVector(contextVector);

    if (!Number.isFinite(reward) || reward < 0 || reward > 1) {
      throw new Error("Reward must be a finite value in [0, 1]");
    }

    const covariance = this.A[action];
    const accumulator = this.b[action];

    for (let row = 0; row < this.dimensions; row++) {
      accumulator[row] += reward * contextVector[row];

      for (let column = 0; column < this.dimensions; column++) {
        covariance[row][column] += contextVector[row] * contextVector[column];
      }
    }

    this.AInv[action] = invertMatrix(covariance);
  }

  /**
   * Return current engine state for dashboard visualization (heatmap, convergence chart).
   */
  public snapshot(): EngineSnapshot {
    const aInvDiag: Record<string, number[]> = {};
    const thetaHat: Record<string, number[]> = {};

    for (const action of this.actions) {
      const inverse = this.AInv[action];
      aInvDiag[action] = inverse.map((row, index) => row[index]);
      thetaHat[action] = matrixVectorMultiply(inverse, this.b[action]);
    }

    return {
      aInvDiag,
      thetaHat,
      lastUcb: this.lastUcb.map((breakdown) => ({ ...breakdown })),
    };
  }

  // Expose alpha so the dashboard What-If board can re-parameterise
  public getAlpha(): number {
    return this.alpha;
  }

  public getActions(): string[] {
    return [...this.actions];
  }

  /** Re-create engine with updated alpha (immutable re-init). */
  public withAlpha(newAlpha: number): LinUCBEngine {
    const engine = new LinUCBEngine({
      dimensions: this.dimensions,
      alpha: newAlpha,
      actions: this.actions,
    });
    // Copy accumulated state so convergence history is preserved
    engine.A = JSON.parse(JSON.stringify(this.A));
    engine.b = JSON.parse(JSON.stringify(this.b));
    engine.AInv = JSON.parse(JSON.stringify(this.AInv));
    engine.lastUcb = this.lastUcb.map((breakdown) => ({ ...breakdown }));
    return engine;
  }

  private assertKnownAction(action: string): void {
    if (!this.actions.includes(action)) {
      throw new Error(`Unknown action: ${action}`);
    }
  }

  private assertValidContextVector(contextVector: number[]): void {
    if (contextVector.length !== this.dimensions) {
      throw new Error(
        `Expected context vector with ${this.dimensions} dimensions`,
      );
    }

    if (!contextVector.every(Number.isFinite)) {
      throw new Error("Context vector must contain only finite numbers");
    }
  }

  // Keep invertMatrix accessible for subclass tests
  protected _invertMatrix = invertMatrix;
}
