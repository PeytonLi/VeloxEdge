import { LinUCBEngine } from "./index";
import {
  calculateVariance,
  invertMatrix,
  matrixVectorMultiply,
} from "./linalg";

function expectMatrixCloseTo(
  actual: number[][],
  expected: number[][],
  precision = 8,
): void {
  expect(actual).toHaveLength(expected.length);

  for (let row = 0; row < expected.length; row++) {
    expect(actual[row]).toHaveLength(expected[row].length);

    for (let column = 0; column < expected[row].length; column++) {
      expect(actual[row][column]).toBeCloseTo(expected[row][column], precision);
    }
  }
}

describe("linear algebra helpers", () => {
  it("inverts a known 2x2 matrix", () => {
    const inverse = invertMatrix([
      [4, 7],
      [2, 6],
    ]);

    expectMatrixCloseTo(inverse, [
      [0.6, -0.7],
      [-0.2, 0.4],
    ]);
  });

  it("inverts a known 3x3 matrix", () => {
    const inverse = invertMatrix([
      [1, 2, 3],
      [0, 1, 4],
      [5, 6, 0],
    ]);

    expectMatrixCloseTo(inverse, [
      [-24, 18, 5],
      [20, -15, -4],
      [-5, 4, 1],
    ]);
  });

  it("regularizes singular matrices before falling back to identity", () => {
    const input = [
      [1, 2],
      [2, 4],
    ];
    const original = input.map((row) => [...row]);

    const inverse = invertMatrix(input);

    expect(input).toEqual(original);
    expect(inverse.flat().every(Number.isFinite)).toBe(true);
    expect(inverse[0][1]).not.toBe(0);
    expect(inverse[1][0]).not.toBe(0);
  });
});

describe("LinUCBEngine", () => {
  it("rejects invalid constructor configuration", () => {
    expect(
      () =>
        new LinUCBEngine({
          dimensions: 0,
          alpha: 0.4,
          actions: ["TOOL_CONTEXT"],
        }),
    ).toThrow("positive integer");

    expect(
      () =>
        new LinUCBEngine({
          dimensions: 2,
          alpha: Number.NaN,
          actions: ["TOOL_CONTEXT"],
        }),
    ).toThrow("finite non-negative");

    expect(
      () =>
        new LinUCBEngine({
          dimensions: 2,
          alpha: 0.4,
          actions: [],
        }),
    ).toThrow("at least one action");

    expect(
      () =>
        new LinUCBEngine({
          dimensions: 2,
          alpha: 0.4,
          actions: ["TOOL_CONTEXT", "TOOL_CONTEXT"],
        }),
    ).toThrow("unique");

    expect(
      () =>
        new LinUCBEngine({
          dimensions: 2,
          alpha: 0.4,
          actions: [""],
        }),
    ).toThrow("non-empty strings");
  });

  it("initializes each arm with non-singular identity covariance", () => {
    const engine = new LinUCBEngine({
      dimensions: 3,
      alpha: 0.4,
      actions: ["TOOL_CONTEXT", "EDGEKV_MEMORY"],
    });

    const snapshot = engine.snapshot();

    expect(snapshot.aInvDiag.TOOL_CONTEXT).toEqual([1, 1, 1]);
    expect(snapshot.aInvDiag.EDGEKV_MEMORY).toEqual([1, 1, 1]);
    expect(snapshot.thetaHat.TOOL_CONTEXT).toEqual([0, 0, 0]);
    expect(snapshot.thetaHat.EDGEKV_MEMORY).toEqual([0, 0, 0]);
  });

  it("breaks equal-UCB ties toward the least-visited arm", () => {
    const engine = new LinUCBEngine({
      dimensions: 2,
      alpha: 0,
      actions: ["TOOL_CONTEXT", "EDGEKV_MEMORY", "VECTOR_WEIGHTS"],
    });
    const context = [1, 0];

    expect(engine.predictNextAction(context).action).toBe("TOOL_CONTEXT");

    engine.updateWeights("TOOL_CONTEXT", context, 0);
    expect(engine.predictNextAction(context).action).toBe("EDGEKV_MEMORY");

    engine.updateWeights("EDGEKV_MEMORY", context, 0);
    expect(engine.predictNextAction(context).action).toBe("VECTOR_WEIGHTS");
  });

  it("selects the higher-reward arm after closed-form updates", () => {
    const engine = new LinUCBEngine({
      dimensions: 2,
      alpha: 0.01,
      actions: ["NO_OP", "PREFETCH_TOOL_CONTEXT"],
    });
    const context = [1, 0];

    for (let i = 0; i < 12; i++) {
      engine.updateWeights("NO_OP", context, 0);
      engine.updateWeights("PREFETCH_TOOL_CONTEXT", context, 1);
    }

    const prediction = engine.predictNextAction(context);
    const noOp = prediction.ucbBreakdown.find(
      (entry) => entry.action === "NO_OP",
    );
    const prefetch = prediction.ucbBreakdown.find(
      (entry) => entry.action === "PREFETCH_TOOL_CONTEXT",
    );

    expect(prediction.action).toBe("PREFETCH_TOOL_CONTEXT");
    expect(prefetch?.expectedReward).toBeGreaterThan(noOp?.expectedReward ?? 0);
  });

  it("rejects invalid prediction and update inputs", () => {
    const engine = new LinUCBEngine({
      dimensions: 2,
      alpha: 0.4,
      actions: ["TOOL_CONTEXT"],
    });

    expect(() => engine.predictNextAction([1])).toThrow("2 dimensions");
    expect(() => engine.predictNextAction([1, Number.NaN])).toThrow("finite");
    expect(() => engine.updateWeights("UNKNOWN", [1, 0], 0.5)).toThrow(
      "Unknown action",
    );
    expect(() => engine.updateWeights("TOOL_CONTEXT", [1, 0], -0.1)).toThrow(
      "[0, 1]",
    );
    expect(() => engine.updateWeights("TOOL_CONTEXT", [1, 0], 1.1)).toThrow(
      "[0, 1]",
    );
  });

  it("reduces variance for a visited context after an update", () => {
    const engine = new LinUCBEngine({
      dimensions: 3,
      alpha: 0.4,
      actions: ["EDGEKV_MEMORY"],
    });
    const context = [1, 0, 0];

    const before = calculateVariance(context, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);

    engine.updateWeights("EDGEKV_MEMORY", context, 1);

    const after = engine.snapshot().aInvDiag.EDGEKV_MEMORY[0];
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(0.5, 8);
  });

  it("matches full inversion after repeated updates and remains finite", () => {
    const engine = new LinUCBEngine({
      dimensions: 3,
      alpha: 0.25,
      actions: ["EDGEKV_MEMORY"],
    });
    const updates = [
      { context: [1, 0.25, 0], reward: 1 },
      { context: [0.5, 1, 0.1], reward: 0.75 },
      { context: [0.2, 0.4, 1], reward: 0.35 },
      { context: [1, 0.1, 0.8], reward: 0.9 },
    ];
    const covariance = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const accumulator = [0, 0, 0];

    for (const { context, reward } of updates) {
      engine.updateWeights("EDGEKV_MEMORY", context, reward);

      for (let row = 0; row < context.length; row++) {
        accumulator[row] += reward * context[row];
        for (let column = 0; column < context.length; column++) {
          covariance[row][column] += context[row] * context[column];
        }
      }
    }

    const expectedInverse = invertMatrix(covariance);
    const expectedTheta = matrixVectorMultiply(expectedInverse, accumulator);
    const snapshot = engine.snapshot();

    expect(snapshot.aInvDiag.EDGEKV_MEMORY.every(Number.isFinite)).toBe(true);
    expect(snapshot.thetaHat.EDGEKV_MEMORY.every(Number.isFinite)).toBe(true);

    for (let index = 0; index < expectedInverse.length; index++) {
      expect(snapshot.aInvDiag.EDGEKV_MEMORY[index]).toBeCloseTo(
        expectedInverse[index][index],
        8,
      );
      expect(snapshot.thetaHat.EDGEKV_MEMORY[index]).toBeCloseTo(
        expectedTheta[index],
        8,
      );
    }
  });

  it("returns defensive copies and preserves learned state across withAlpha", () => {
    const engine = new LinUCBEngine({
      dimensions: 2,
      alpha: 0.2,
      actions: ["TOOL_CONTEXT", "EDGEKV_MEMORY"],
    });
    const context = [1, 0];

    engine.updateWeights("EDGEKV_MEMORY", context, 1);
    engine.predictNextAction(context);

    const actions = engine.getActions();
    actions.push("MUTATED");
    expect(engine.getActions()).toEqual(["TOOL_CONTEXT", "EDGEKV_MEMORY"]);

    const snapshot = engine.snapshot();
    snapshot.aInvDiag.EDGEKV_MEMORY[0] = 999;
    snapshot.thetaHat.EDGEKV_MEMORY[0] = 999;
    snapshot.lastUcb[0].ucbValue = 999;

    const freshSnapshot = engine.snapshot();
    expect(freshSnapshot.aInvDiag.EDGEKV_MEMORY[0]).not.toBe(999);
    expect(freshSnapshot.thetaHat.EDGEKV_MEMORY[0]).not.toBe(999);
    expect(freshSnapshot.lastUcb[0].ucbValue).not.toBe(999);

    const retuned = engine.withAlpha(0.8);
    expect(retuned.getAlpha()).toBe(0.8);
    expect(retuned.snapshot()).toEqual(freshSnapshot);
    expect(retuned.predictNextAction(context).action).toBe(
      engine.predictNextAction(context).action,
    );
  });

  it("keeps learned state stable across many updates and repeated predictions", () => {
    const actions = [
      "TOOL_CONTEXT",
      "EDGEKV_MEMORY",
      "VECTOR_WEIGHTS",
      "NO_OP",
    ];
    const engine = new LinUCBEngine({
      dimensions: 12,
      alpha: 0.3,
      actions,
    });

    for (let step = 0; step < 240; step++) {
      const context = Array.from({ length: 12 }, (_, index) =>
        Number(Math.sin((step + 1) * (index + 1) * 0.17).toFixed(6)),
      );
      const reward = (step % 11) / 10;
      engine.updateWeights(actions[step % actions.length], context, reward);
    }

    const beforePredict = engine.snapshot();
    const context = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0 ? 0.75 : -0.25,
    );

    for (let i = 0; i < 50; i++) {
      const prediction = engine.predictNextAction(context);
      expect(actions).toContain(prediction.action);
      expect(prediction.ucbBreakdown).toHaveLength(actions.length);
      expect(
        prediction.ucbBreakdown.every((entry) =>
          [entry.expectedReward, entry.explorationBonus, entry.ucbValue].every(
            Number.isFinite,
          ),
        ),
      ).toBe(true);
    }

    const afterPredict = engine.snapshot();
    expect(afterPredict.aInvDiag).toEqual(beforePredict.aInvDiag);
    expect(afterPredict.thetaHat).toEqual(beforePredict.thetaHat);
  });

  it("predicts under the 1.8ms budget at d=12", () => {
    const actions = [
      "TOOL_CONTEXT",
      "EDGEKV_MEMORY",
      "VECTOR_WEIGHTS",
      "NO_OP",
    ];
    const engine = new LinUCBEngine({
      dimensions: 12,
      alpha: 0.35,
      actions,
    });
    const context = Array.from({ length: 12 }, (_, index) =>
      index % 3 === 0 ? 1 : 0.25,
    );

    for (let i = 0; i < 32; i++) {
      engine.updateWeights(
        actions[i % actions.length],
        context,
        i % 2 === 0 ? 1 : 0.25,
      );
    }

    for (let i = 0; i < 25; i++) {
      engine.predictNextAction(context);
    }

    const iterations = 100;
    const start = process.hrtime.bigint();

    for (let i = 0; i < iterations; i++) {
      engine.predictNextAction(context);
    }

    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const averageMs = elapsedMs / iterations;

    expect(averageMs).toBeLessThan(1.8);
  });
});
