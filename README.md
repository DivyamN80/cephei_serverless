# Cephei Serverless — UI scaffold (landing page, customer portal, admin panel, post-deploy dashboard)

This is a working, runnable implementation of the spec written to your project doc
`product-ui-landing-portal-admin-dashboard-prompt.md`: a public landing page, an
authenticated customer portal (repo ingest → analysis → traffic tier → recommendation/diff →
connect AWS → deploy → central dashboard), an admin panel, and Razorpay-based subscriptions.

**Built as a fresh scaffold, not a merge into your real `cephei-serverless` repo** — this
session didn't have that repo connected. The AWS/Docker deploy mechanics
(`detectStack.js`, `awsDeployer.js`, `customerAwsClients.js`, `cfnTemplate.js`,
`rdsProvisioner.js`, `s3Deployer.js`) are **simulated** here with clearly commented
`// SIMULATED` blocks that return realistic-shaped fake data, so every screen has something
real to render. Swapping the simulated pieces for your production code is the main integration
work left — see "Wiring in your real deploy pipeline" below.

## Stack

- `server/` — Node.js (ESM) + Express + Mongoose (MongoDB), JWT auth, Razorpay subscriptions.
- `client/` — React 18 + Vite + Tailwind CSS + react-router-dom + TanStack Query + recharts.

## Running it locally

You need a MongoDB instance reachable from `server/` (Atlas free tier, a local `mongod`, or
Docker's `mongo` image all work — this sandbox couldn't reach any of those to test with, so
this hasn't been run against a real database yet; the code path has been verified to boot
cleanly and fail gracefully without one).

```bash
# Backend
cd server
cp .env.example .env        # fill in MONGODB_URI at minimum; JWT_SECRET to any random string
npm install
npm run seed                # creates the free/starter/pro Plan documents
npm run dev                 # listens on :4000

# Frontend, in a second terminal
cd client
cp .env.example .env        # VITE_API_URL defaults to http://localhost:4000, fine as-is
npm install
npm run dev                 # listens on :5173
```

Open `http://localhost:5173`, register an account, and click through the flow. To reach the
admin panel, promote your account after registering:

```bash
cd server
node scripts/promote-admin.js you@example.com
```

then log out and back in (the role is read from a fresh token/`\`GET /api/auth/me\``).

### Razorpay

Checkout is wired for real (`razorpay` npm package, subscription creation, webhook signature
verification) but needs real keys to actually charge anything:

```
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

Without them, `POST /api/billing/checkout` returns a clear `501` explaining they're missing —
the Billing page in the UI shows that message inline rather than a broken button, so you can
click through everything else before setting up a real Razorpay account. You'll also need to
create the three plans in your Razorpay dashboard (or via their Plans API) and paste the
resulting `plan_id`s into the seeded `Plan` documents' `razorpayPlanId` field.

## What's real vs. simulated

**Real**: auth (register/login/JWT/refresh), every model and route, ownership scoping
(customers only see their own projects), admin aggregation queries (they run real Mongo
queries — meaningful once you have real data), Razorpay checkout + webhook handling,
deploy-history persistence (`DeployLog`), the rollback endpoint's version-tracking logic, and
the entire React UI against this API contract.

**Simulated** (search each file for `// SIMULATED` to find every instance):
- `POST /api/projects` — stack detection and compatibility checklist are canned, not a real
  repo clone/scan.
- `POST /api/projects/:id/traffic-tier` — the recommendation + diff preview are canned.
- `POST /api/customer-aws-accounts` — no real CloudFormation template is generated or
  published; `quickCreateUrl` is a fake-looking string. No real `sts:AssumeRole` happens on
  connect/verify.
- `POST /api/projects/:id/deploy` and `/deploy-frontend` — no real Docker build, ECR push,
  Lambda, API Gateway, or S3 calls. Returns fake-but-realistic values and log lines.
- `metricsService.js`'s `cost` and `metrics` fields — deterministic mock data seeded from the
  project id (same project always shows the same numbers), not real CloudWatch/Cost Explorer
  data.

## Wiring in your real deploy pipeline

Once you have this connected to your actual `cephei-serverless` repo, the swap points are
narrow and intentional:

1. `server/src/routes/projects.js` — replace `simulateStackDetection()` with a call into your
   real `detectStack.js`; replace the deploy handlers' simulated blocks with calls into
   `runBackendDeploy` / `deployFrontendToS3` from your production `deployOrchestrator.js` /
   `s3Deployer.js`.
2. `server/src/routes/customerAwsAccounts.js` — replace the fake `quickCreateUrl` generation
   with your real `cfnTemplate.js`'s `publishTemplateAndGetQuickCreateUrl`, and the
   connect/verify handlers with your real `customerAwsClients.js`'s `verifyConnection`.
3. `server/src/services/metricsService.js` — replace the `cost`/`metrics` simulation with real
   `cloudwatch.send(new GetMetricDataCommand(...))` / `costexplorer.send(new
   GetCostAndUsageCommand(...))` calls via `buildCustomerClients(customerAwsAccount, ...)`.
4. Apply the IAM policy additions from your project doc's §7 (`Monitoring` and
   `LambdaVersioningForRollback` statements) to `cfnTemplate.js`'s `buildDeployRoleTemplate`,
   and the alias-based rollback change to `awsDeployer.js` (§5.5 of the same doc) — the
   `POST /:id/rollback` route here already assumes an alias exists to repoint.

Every model in `server/src/models/` was written to be a superset-compatible shape with what
your existing `Project.js` already has (per `byoc-and-frontend-deploy-prompt.md`'s
`customerAwsAccount`/`frontendDeployResult` fields) plus the new `owner` field this spec adds
— merging schemas should be closer to "add these fields" than "reconcile two designs."

## Known gaps from the sandbox this was built in

- Full database-backed end-to-end testing (register → deploy → dashboard, with real data
  persisting) hasn't been run — this sandbox's network policy blocks every MongoDB
  download/connection path it tried (Atlas, `mongodb-memory-server`'s binary download, a local
  Docker Mongo). What has been verified: the server boots and serves `/api/health` with no DB
  configured, fails DB-dependent routes cleanly instead of crashing, and the frontend builds
  cleanly and serves its compiled bundle. Every route path and request/response shape was
  cross-checked line-by-line between `client/src/lib` call sites and `server/src/routes` — no
  mismatches found. Point `MONGODB_URI` at any real MongoDB and the rest should just work; if
  something doesn't, it's most likely in a rarely-hit edge case rather than the core wiring.
