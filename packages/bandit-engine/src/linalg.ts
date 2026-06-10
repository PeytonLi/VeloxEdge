// ═══════════════════════════════════════════════════════════════
// FROZEN CONTRACT (signatures) — Agent A fills implementations.
// ═══════════════════════════════════════════════════════════════

/**
 * Invert a square matrix using Gauss-Jordan elimination with partial pivoting.
 * Guards against near-singular matrices by returning the identity on failure.
 * @param matrix - d×d input matrix (not mutated)
 */
export function invertMatrix(matrix: number[][]): number[][] {
  const dimension = matrix.length;

  if (dimension === 0) {
    return [];
  }

  if (!isSquareMatrix(matrix)) {
    return createIdentityMatrix(dimension);
  }

  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...createIdentityRow(dimension, rowIndex),
  ]);

  for (let column = 0; column < dimension; column++) {
    const pivotRow = findPivotRow(augmented, column, dimension);
    const pivot = augmented[pivotRow][column];

    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-10) {
      return createIdentityMatrix(dimension);
    }

    if (pivotRow !== column) {
      [augmented[column], augmented[pivotRow]] = [
        augmented[pivotRow],
        augmented[column],
      ];
    }

    const normalizedPivot = augmented[column][column];
    for (let j = 0; j < dimension * 2; j++) {
      augmented[column][j] /= normalizedPivot;
    }

    for (let row = 0; row < dimension; row++) {
      if (row === column) {
        continue;
      }

      const factor = augmented[row][column];
      if (factor === 0) {
        continue;
      }

      for (let j = 0; j < dimension * 2; j++) {
        augmented[row][j] -= factor * augmented[column][j];
      }
    }
  }

  const inverse = augmented.map((row) =>
    row.slice(dimension).map(cleanNearZero),
  );

  if (!inverse.every((row) => row.every(Number.isFinite))) {
    return createIdentityMatrix(dimension);
  }

  return inverse;
}

/**
 * Multiply a matrix by a column vector: result[i] = Σ_j matrix[i][j] * vec[j]
 */
export function matrixVectorMultiply(
  matrix: number[][],
  vec: number[],
): number[] {
  if (matrix.length === 0) {
    return [];
  }

  if (matrix.some((row) => row.length !== vec.length)) {
    throw new Error("Matrix column count must match vector length");
  }

  return matrix.map((row) =>
    row.reduce((sum, value, index) => sum + value * vec[index], 0),
  );
}

/**
 * Dot product of two equal-length vectors.
 */
export function dotProduct(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) {
    throw new Error("Vectors must have the same length");
  }

  return v1.reduce((sum, value, index) => sum + value * v2[index], 0);
}

/**
 * Compute the variance bound xᵀ A⁻¹ x used in the UCB formula.
 * @param vec       - context vector x (length d)
 * @param matrixInv - A⁻¹ (d×d)
 */
export function calculateVariance(
  vec: number[],
  matrixInv: number[][],
): number {
  const projected = matrixVectorMultiply(matrixInv, vec);
  return Math.max(0, dotProduct(vec, projected));
}

function isSquareMatrix(matrix: number[][]): boolean {
  const dimension = matrix.length;
  return matrix.every(
    (row) =>
      row.length === dimension && row.every((value) => Number.isFinite(value)),
  );
}

function createIdentityMatrix(dimension: number): number[][] {
  return Array.from({ length: dimension }, (_, rowIndex) =>
    createIdentityRow(dimension, rowIndex),
  );
}

function createIdentityRow(dimension: number, oneIndex: number): number[] {
  return Array.from({ length: dimension }, (_, columnIndex) =>
    columnIndex === oneIndex ? 1 : 0,
  );
}

function findPivotRow(
  matrix: number[][],
  column: number,
  dimension: number,
): number {
  let pivotRow = column;
  let largestAbsoluteValue = Math.abs(matrix[column][column]);

  for (let row = column + 1; row < dimension; row++) {
    const absoluteValue = Math.abs(matrix[row][column]);
    if (absoluteValue > largestAbsoluteValue) {
      largestAbsoluteValue = absoluteValue;
      pivotRow = row;
    }
  }

  return pivotRow;
}

function cleanNearZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}
