// Generates a Dockerfile for repos that don't already have one. Cloud Run
// (2nd gen — the "Cloud Run-backed Cloud Function" the UI advertises for
// this provider) natively reverse-proxies HTTP straight to whatever port
// the container listens on: it injects its own PORT env var into the
// container at start (overriding whatever default is baked into the
// image) and requires nothing else — no adapter binary, no
// event/response-translation glue layer, unlike AWS Lambda's aws-lambda-web-
// adapter (see aws/dockerfile.js). The customer's unmodified app just needs
// to keep listening on an HTTP port like it always did.
const NODE_BASE_IMAGE = 'node:20-slim';
const PORT = 8080; // sane local default only — Cloud Run overrides PORT at runtime to match the service's configured container port

// Same "resolve the real start command from package.json" logic as
// aws/dockerfile.js, so both providers build an unmodified customer repo
// identically: npm start > pkg.main > index.js fallback.
function resolveStartCommand(pkg) {
  const startScript = pkg?.scripts?.start;
  if (startScript) return ['npm', 'start'];
  if (pkg?.main) return ['node', pkg.main];
  return ['node', 'index.js'];
}

export function generateDockerfile(pkg) {
  const cmd = resolveStartCommand(pkg);
  const cmdJson = JSON.stringify(cmd);

  return `FROM ${NODE_BASE_IMAGE}
ENV PORT=${PORT}
EXPOSE ${PORT}
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ${cmdJson}
`;
}
