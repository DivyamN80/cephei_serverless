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
const PORT = 8080;

// Best-effort extraction of the real start command from package.json so the
// generated image runs the app the same way `npm start` would, without
// guessing at a specific entry filename.
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
COPY --from=${ADAPTER_IMAGE} /lambda-adapter /opt/extensions/lambda-adapter
ENV PORT=${PORT}
EXPOSE ${PORT}
WORKDIR /var/task
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ${cmdJson}
`;
}
