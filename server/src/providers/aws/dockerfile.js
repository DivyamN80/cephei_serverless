// Generates a Dockerfile for repos that don't already have one, using the
// AWS Lambda Web Adapter (https://github.com/awslabs/aws-lambda-web-adapter)
// instead of a hand-rolled serverless-express wrapper. The adapter is
// dropped in as a Lambda Extension at /opt/extensions/lambda-adapter — it
// works with any base image (verified against the project's real README
// and its expressjs example), so the customer's app runs completely
// unmodified: it just needs to listen on an HTTP port like it always did.
// No `app.listen()` export contract, no framework-specific glue code.
const ADAPTER_IMAGE = 'public.ecr.aws/awsguru/aws-lambda-adapter:1.1.0';
const NODE_BASE_IMAGE = 'public.ecr.aws/docker/library/node:20-slim';
const DEFAULT_PORT = 3000;

// package.json has no field for this (a build's output directory lives in
// tsconfig.json's compilerOptions.outDir or nest-cli.json, neither of which
// this function reads) — 'dist' is simply the near-universal convention for
// both NestJS and plain tsc projects, so it's the only sane default.
const BUILD_OUTPUT_DIR = 'dist';

// Best-effort extraction of the real *production* start command from
// package.json, without guessing at a specific entry filename.
//
// scripts.start is NOT a safe default once a build step exists: for
// TypeScript/NestJS projects it conventionally runs the dev-mode watcher
// (e.g. `nest start --watch` or `ts-node src/main.ts`), which needs
// devDependencies (the Nest CLI, ts-node, ...) that the runtime image never
// installs (it only runs `npm install --omit=dev`), and it's built for
// reload-on-change, not for running once in a container. scripts['start:prod']
// is the standard Nest/Express-TS convention for the command that actually
// runs the compiled output (typically `node dist/main.js`) — prefer it
// whenever it exists, falling back to scripts.start only when there was no
// build step to begin with (i.e. a plain JS app where start already *is*
// the production command).
function resolveStartCommand(pkg, needsBuild) {
  const startProdScript = pkg?.scripts?.['start:prod'];
  if (startProdScript) return ['npm', 'run', 'start:prod'];
  if (pkg?.main) return ['node', pkg.main];
  if (!needsBuild && pkg?.scripts?.start) return ['npm', 'start'];
  return ['node', needsBuild ? `${BUILD_OUTPUT_DIR}/main.js` : 'index.js'];
}

// listenPort must match the port the customer's own app.listen() call
// actually binds to (see repoIngest.js's detectListenPort) — the Lambda
// Web Adapter proxies to a fixed, pre-configured port baked into the
// image, so a mismatch here means the deploy "succeeds" but every request
// 502s.
export function generateDockerfile(pkg, { listenPort = DEFAULT_PORT } = {}) {
  // Presence of a "build" script is the standard signal for "this needs a
  // compile step" — covers NestJS's `"build": "nest build"` and any other
  // TS project following the same convention.
  const needsBuild = Boolean(pkg?.scripts?.build);
  const cmd = resolveStartCommand(pkg, needsBuild);
  const cmdJson = JSON.stringify(cmd);

  if (!needsBuild) {
    return `FROM ${NODE_BASE_IMAGE}
COPY --from=${ADAPTER_IMAGE} /lambda-adapter /opt/extensions/lambda-adapter
ENV PORT=${listenPort}
EXPOSE ${listenPort}
WORKDIR /var/task
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ${cmdJson}
`;
  }

  // Multi-stage: the builder stage needs the full dependency tree (the
  // Nest CLI/TypeScript compiler live in devDependencies) to run the build,
  // but the runtime image should only ship the compiled output plus
  // production dependencies — keeps the deployed image free of the
  // TypeScript toolchain entirely.
  return `FROM ${NODE_BASE_IMAGE} AS builder
WORKDIR /var/task
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM ${NODE_BASE_IMAGE}
COPY --from=${ADAPTER_IMAGE} /lambda-adapter /opt/extensions/lambda-adapter
ENV PORT=${listenPort}
EXPOSE ${listenPort}
WORKDIR /var/task
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /var/task/${BUILD_OUTPUT_DIR} ./${BUILD_OUTPUT_DIR}
CMD ${cmdJson}
`;
}
