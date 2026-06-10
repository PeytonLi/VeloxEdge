import type {
  EdgePredictRequest,
  EdgePredictResponse,
  EdgeUpdateRequest,
  EdgeUpdateResponse,
} from "@veloxedge/bandit-engine";

export interface EdgeKvEmulator {
  predict(request: EdgePredictRequest): Promise<EdgePredictResponse>;
  update(request: EdgeUpdateRequest): Promise<EdgeUpdateResponse>;
  reset(sessionId: string): Promise<void>;
}

export function createEdgeKvEmulator(): EdgeKvEmulator {
  return {
    async predict(request) {
      void request;
      throw new Error("not implemented");
    },
    async update(request) {
      void request;
      throw new Error("not implemented");
    },
    async reset(sessionId) {
      void sessionId;
      throw new Error("not implemented");
    },
  };
}

export const edgeKvEmulator = createEdgeKvEmulator();
