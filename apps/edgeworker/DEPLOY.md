# VeloxEdge EdgeWorker deploy runbook

This directory builds a deployable Akamai EdgeWorkers bundle for the
VeloxEdge LinUCB predictor. The worker exposes:

- `GET /health` — health check
- `POST /predict` — predict and persist the session engine state
- `POST /update` — apply reward, predict again, and persist state
- `POST /reset` — reset by writing fresh state; no EdgeKV delete is used

The worker stores per-session serialized engine state at:

```text
namespace: veloxedge
group:     sessions
item:      veloxedge_<sessionId>
```

The request body should stay small. VeloxEdge sends a 12-dimensional context
vector and compact serialized matrices, well below typical EdgeWorkers body and
EdgeKV item limits. The vendored EdgeKV helper also contains the documented
large-response handling path for responses above 128 KB.

## Security rules

Do not commit Akamai credentials. The real `edgekv_tokens.js` is gitignored.
Only `edgekv_tokens.example.js` is committed.

Do not activate this worker from an automated agent. Activation is a human
operator step after reviewing the bundle and property association.

## Prerequisites

- Akamai CLI installed and authenticated with an `.edgerc` profile owned by the operator
- EdgeWorkers CLI package installed
- EdgeKV CLI package installed
- A Property Manager property where the EdgeWorker behavior can be associated
- Node.js and pnpm for local bundle generation

Install CLI packages if needed:

```sh
akamai install edgeworkers
akamai install edgekv
```

## 1. Create EdgeKV namespace, group, and token

Initialize EdgeKV for the account or contract/group if it has not been enabled:

```sh
akamai edgekv initialize
```

Create the namespace and group used by the worker:

```sh
akamai edgekv create namespace veloxedge
akamai edgekv create group veloxedge sessions
```

Create an access token for the namespace. Follow the CLI prompts and select
read/write access for namespace `veloxedge`:

```sh
akamai edgekv create token
```

Export the generated token file into this directory as the gitignored file
`edgekv_tokens.js`. It should export `edgekv_access_tokens`, matching
`edgekv_tokens.example.js`:

```js
export const edgekv_access_tokens = {
  "namespace-veloxedge": {
    name: "namespace-veloxedge",
    value: "...secret token value...",
  },
};

export default edgekv_access_tokens;
```

## 2. Build the EdgeWorker bundle

From the repository root:

```sh
pnpm --filter @veloxedge/edgeworker build
```

The build emits:

```text
apps/edgeworker/dist/main.js
apps/edgeworker/dist/bundle.json
apps/edgeworker/dist/edgekv.js
apps/edgeworker/dist/edgekv_tokens.js
apps/edgeworker/dist/bundle.tgz
```

For deployment, place the real generated token module at
`apps/edgeworker/edgekv_tokens.js` before building. The file is gitignored, and
`build.mjs` copies it into `dist/edgekv_tokens.js`. If the real file is absent,
the build writes a harmless placeholder so CI and local validation can run
without secrets.

Validate the archive contents before uploading:

```sh
tar -tzf apps/edgeworker/dist/bundle.tgz
```

Expected entries:

```text
bundle.json
main.js
edgekv.js
edgekv_tokens.js
```

## 3. Register, upload, and validate the EdgeWorker

Register a new EdgeWorker ID in Akamai Control Center or with the CLI:

```sh
akamai edgeworkers register VeloxEdgePredictor --resource-tier 200
```

Upload the generated bundle to the EdgeWorker ID returned by registration:

```sh
akamai edgeworkers upload <edgeworker-id> apps/edgeworker/dist/bundle.tgz
```

Validate the uploaded bundle if your CLI version supports validation:

```sh
akamai edgeworkers validate <edgeworker-id> apps/edgeworker/dist/bundle.tgz
```

## 4. Associate with a Property Manager property

In Property Manager, add or update an EdgeWorkers behavior on the route/path you
want to expose, for example `/veloxedge/*`, and select the uploaded EdgeWorker
ID/version. Save a new property version and activate it to staging first.

Do not activate to production until staging smoke tests pass.

## 5. Activate after human approval

Staging activation example:

```sh
akamai edgeworkers activate <edgeworker-id> <version> staging
```

Production activation example, only after review:

```sh
akamai edgeworkers activate <edgeworker-id> <version> production
```

## 6. Connect the web dashboard

Set the web app proxy target in `.env` or your hosting provider environment:

```sh
VELOX_EDGEWORKER_URL=https://<your-property-hostname>/veloxedge
```

The dashboard's API routes proxy `/api/edge/predict` and `/api/edge/update` to
that origin when `VELOX_EDGEWORKER_URL` is present. Without it, the local web
emulator is used.

## Smoke test payloads

Predict:

```sh
curl -X POST https://<your-property-hostname>/veloxedge/predict \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo","dimensions":12,"alpha":1,"actions":["TOOL_CONTEXT","EDGEKV_MEMORY","VECTOR_WEIGHTS","NO_OP"],"contextVector":[1,0,0,0,0,0,0,0,0,0,0,0]}'
```

Update:

```sh
curl -X POST https://<your-property-hostname>/veloxedge/update \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo","dimensions":12,"alpha":1,"actions":["TOOL_CONTEXT","EDGEKV_MEMORY","VECTOR_WEIGHTS","NO_OP"],"action":"TOOL_CONTEXT","contextVector":[1,0,0,0,0,0,0,0,0,0,0,0],"reward":1}'
```

Both responses include `action`, `ucbBreakdown`, and measured `computeMicros`.
