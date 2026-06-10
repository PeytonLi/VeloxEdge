import { createResponse } from "create-response";

const JSON_HEADERS = {
  "content-type": ["application/json; charset=utf-8"],
};

export async function responseProvider() {
  return createResponse(
    501,
    JSON_HEADERS,
    JSON.stringify({
      error: "VeloxEdge EdgeWorker scaffold is not implemented yet",
    }),
  );
}
