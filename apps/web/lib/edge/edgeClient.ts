import type {
  EdgePredictRequest,
  EdgePredictResponse,
  EdgeUpdateRequest,
  EdgeUpdateResponse,
} from "@veloxedge/bandit-engine";

export async function predict(
  request: EdgePredictRequest,
): Promise<EdgePredictResponse> {
  void request;
  throw new Error("not implemented");
}

export async function update(
  request: EdgeUpdateRequest,
): Promise<EdgeUpdateResponse> {
  void request;
  throw new Error("not implemented");
}

export const edgeClient = {
  predict,
  update,
};
