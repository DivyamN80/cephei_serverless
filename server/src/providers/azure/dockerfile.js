// Generates a Linux custom-container image for Azure Functions using the
// real "Custom Handlers" feature (verified against Microsoft Learn,
// 2026-09-22: learn.microsoft.com/azure/azure-functions/functions-custom-handlers
// and .../functions-how-to-custom-container). Custom handlers let the
// Functions host forward raw HTTP requests to the customer's own process
// over loopback HTTP — no SDK, no `app.listen()` contract change, no
// framework-specific glue code. This is the Azure analogue of the AWS
// Lambda Web Adapter approach already used in aws/dockerfile.js.
//
// Base image: mcr.microsoft.com/azure-functions/node:4-node20 — one of
// Microsoft's own maintained Functions-host-for-Node images (confirmed
// current tag via the real MCR tags list for azure-functions/node, Sep
// 2026: "4-node20", "4-node20-appservice", "4-node22", ...). This image
// already bundles BOTH the Azure Functions host runtime AND a Node.js 20
// runtime — no separate host install step is needed. We deliberately use
// the Node-flavored base (not the fully generic mcr.microsoft.com/azure-
// functions/base image meant for languages the host has no worker for)
// because it gives us `npm`/`node` for free to run the app's own start
// command, and we override FUNCTIONS_WORKER_RUNTIME to "Custom" so the
// host uses OUR host.json custom-handler config instead of its built-in
// Node language worker (which would require the customer's code to
// conform to the Functions programming model — exactly what this project
// must not require).
const BASE_IMAGE = 'mcr.microsoft.com/azure-functions/node:4-node20';

// The Functions host is PID 1 in this container (inherited CMD/ENTRYPOINT
// from the base image) and listens on the app-facing port itself. On
// each HTTP request it spawns/forwards to our custom handler process —
// defined in host.json as this shim script — passing the real,
// dynamically-chosen callback port via the FUNCTIONS_CUSTOMHANDLER_PORT
// env var (confirmed exact name via the official custom-handlers doc's
// Go example: `os.LookupEnv("FUNCTIONS_CUSTOMHANDLER_PORT")`). The shim's
// only job is to translate that into the PORT env var most Node HTTP
// frameworks already read by convention, then exec the customer's own
// unmodified start command — same "respects process.env.PORT" convention
// aws/dockerfile.js already relies on for the Lambda Web Adapter path.
const HANDLER_SHIM = 'start-handler.sh';
const FUNCTION_NAME = 'HttpProxy';

// Best-effort extraction of the real start command from package.json —
// identical logic to aws/dockerfile.js's resolveStartCommand, so the
// generated image runs the app exactly the same way `npm start` would.
function resolveStartCommand(pkg) {
  const startScript = pkg?.scripts?.start;
  if (startScript) return ['npm', 'start'];
  if (pkg?.main) return ['node', pkg.main];
  return ['node', 'index.js'];
}

// host.json: the real shape documented for a custom handler that proxies
// raw HTTP (not the trigger/binding request-payload protocol) — the
// `enableProxyingHttpRequest` flag is the exact, current, documented
// setting for this ("HTTP-only function" example in the custom-handlers
// doc). Microsoft's own docs candidly note custom handlers aren't a
// general-purpose reverse proxy and some headers/routes may be
// restricted — real, current caveat, not something this code can paper
// over; flagged here and in the deploy report.
export function generateHostJson() {
  return (
    JSON.stringify(
      {
        version: '2.0',
        customHandler: {
          description: {
            defaultExecutablePath: HANDLER_SHIM,
          },
          enableProxyingHttpRequest: true,
        },
        logging: {
          logLevel: {
            default: 'Information',
          },
        },
      },
      null,
      2
    ) + '\n'
  );
}

// function.json: a single catch-all HTTP trigger. `methods` is
// deliberately omitted (real, documented meaning: all HTTP methods are
// allowed — verified against the httpTrigger binding reference) and
// `route: "{*route}"` is the standard Functions catch-all route syntax,
// so every path on the app gets forwarded, matching AWS's $default/
// AWS_PROXY catch-all route in apiGateway.js.
export function generateFunctionJson() {
  return (
    JSON.stringify(
      {
        bindings: [
          {
            authLevel: 'anonymous',
            type: 'httpTrigger',
            direction: 'in',
            name: 'req',
            route: '{*route}',
          },
          {
            type: 'http',
            direction: 'out',
            name: 'res',
          },
        ],
      },
      null,
      2
    ) + '\n'
  );
}

export function generateHandlerShim(pkg) {
  const cmd = resolveStartCommand(pkg).join(' ');
  // FUNCTIONS_CUSTOMHANDLER_PORT is set by the Functions host itself at
  // container startup — never by us. We only translate it into PORT
  // (falling back to 8080 if the app is ever run outside the Functions
  // host, e.g. `docker run` during local debugging).
  return `#!/bin/sh
set -e
export PORT="\${FUNCTIONS_CUSTOMHANDLER_PORT:-8080}"
exec ${cmd}
`;
}

export function generateDockerfile(pkg) {
  return `FROM ${BASE_IMAGE}

# Standard Azure Functions Linux custom-container env vars (verified
# against Microsoft's own sample custom-handler Dockerfile and the
# functions-how-to-custom-container doc).
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \\
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \\
    FUNCTIONS_WORKER_RUNTIME=Custom

WORKDIR /home/site/wwwroot

COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# host.json, ${FUNCTION_NAME}/function.json and ${HANDLER_SHIM} are
# generated and written into the build context alongside the app's own
# source before \`docker build\` runs (see azure/deploy.js) — this single
# COPY . . above already picks them up. Just make the shim executable.
RUN chmod +x ./${HANDLER_SHIM}

# No CMD/ENTRYPOINT here — we deliberately inherit the base image's own,
# which starts the Azure Functions host (PID 1). The host is what listens
# on the container's public-facing port and spawns ${HANDLER_SHIM} as the
# custom handler per host.json.
`;
}

export const AZURE_FUNCTION_NAME = FUNCTION_NAME;
export const AZURE_HANDLER_SHIM_FILENAME = HANDLER_SHIM;
