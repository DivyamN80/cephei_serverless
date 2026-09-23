import express from 'express';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import Project from '../models/Project.js';
import DeployLog from '../models/DeployLog.js';
import CustomerAwsAccount from '../models/CustomerAwsAccount.js';
import Subscription from '../models/Subscription.js';
import ProjectSecret from '../models/ProjectSecret.js';
import { requireAuth, requireActiveSubscription } from '../middleware/auth.js';
import { getDashboard } from '../services/metricsService.js';
import { encryptSecretValue, maskedPreview } from '../utils/secretsCrypto.js';
import {
  analyzeRepo,
  parseGithubUrl,
  probeIsPrivate,
  downloadRepoSource,
  resolveProjectGithubAuth,
  resolveBackendCandidate,
  RepoIngestError,
} from '../services/repoIngest.js';
import { loadProjectSecretsPlaintext } from '../services/secretSync.js';
import { getProvider } from '../providers/index.js';
import { generateDockerfile } from '../providers/aws/dockerfile.js';

const router = express.Router();

const SECRET_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function publicSecret(doc) {
  return {
    _id: doc._id,
    key: doc.key,
    preview: `${'•'.repeat(8)}${doc.previewSuffix}`,
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
  };
}

router.use(requireAuth);

function slugify(name) {
  return (name || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'project';
}

// SIMULATED — replace with real cost-modeling logic informed by the
// customer's actual AWS billing data (via customerAwsClients.js) once an
// AWS account is connected, instead of these fixed per-tier heuristics.
function simulateRecommendation(trafficTier) {
  const table = {
    steady: {
      target: 'ec2',
      projectedMonthlySavingsUsd: 40,
    },
    steady_spikes: {
      target: 'lambda_managed_instances',
      projectedMonthlySavingsUsd: 220,
    },
    low_spiky: {
      target: 'classic_lambda',
      projectedMonthlySavingsUsd: 310,
    },
  };
  const base = table[trafficTier] || table.low_spiky;

  const diff = [
    {
      file: 'Dockerfile',
      before:
        'FROM node:20-slim\nWORKDIR /app\nCOPY . .\nRUN npm ci --omit=dev\nCMD ["node", "dist/main.js"]\n',
      after:
        'FROM public.ecr.aws/lambda/nodejs:20\nWORKDIR /var/task\nCOPY . .\nRUN npm ci --omit=dev\nCMD ["dist/lambda.handler"]\n',
    },
    {
      file: 'src/lambda.ts',
      before: '// file did not previously exist\n',
      after:
        "import serverlessExpress from '@vendia/serverless-express';\nimport { NestFactory } from '@nestjs/core';\nimport { AppModule } from './app.module';\n\nlet cachedServer;\n\nasync function bootstrap() {\n  const app = await NestFactory.create(AppModule);\n  await app.init();\n  return serverlessExpress({ app: app.getHttpAdapter().getInstance() });\n}\n\nexport const handler = async (event, context) => {\n  cachedServer = cachedServer ?? (await bootstrap());\n  return cachedServer(event, context);\n};\n",
    },
  ];

  return { ...base, diff };
}

// SIMULATED — replace with real per-provider static-site deploy:
//  - aws:   S3 bucket (frontend-s3-deploy-module.js), optionally fronted
//           by CloudFront.
//  - azure: Storage Account static website hosting ($web container).
//  - gcp:   Cloud Storage bucket configured for static website hosting.
function simulateFrontendDeploy(project, account) {
  const slug = slugify(project.name);
  const provider = account?.provider || 'aws';

  if (provider === 'azure') {
    const storageAccount = `cephei${slug}${crypto.randomBytes(3).toString('hex')}`.replace(/[^a-z0-9]/g, '').slice(0, 24);
    const region = account?.region || 'eastus';
    return {
      logLines: [
        'Building frontend production bundle...',
        `Creating Storage Account ${storageAccount}...`,
        'Enabling static website hosting...',
        'Uploading build artifacts to the $web container...',
        'Frontend deploy complete.',
      ],
      frontendDeployResult: {
        provider: 'azure',
        bucket: storageAccount,
        url: `https://${storageAccount}.z13.web.core.windows.net`,
        region,
      },
    };
  }

  if (provider === 'gcp') {
    const bucket = `cephei-${slug}-frontend-${crypto.randomBytes(3).toString('hex')}`;
    const region = account?.region || 'us-central1';
    return {
      logLines: [
        'Building frontend production bundle...',
        `Creating Cloud Storage bucket ${bucket}...`,
        'Enabling static website hosting...',
        'Uploading build artifacts to Cloud Storage...',
        'Frontend deploy complete.',
      ],
      frontendDeployResult: {
        provider: 'gcp',
        bucket,
        url: `https://storage.googleapis.com/${bucket}/index.html`,
        region,
      },
    };
  }

  // aws (default)
  const bucket = `cephei-${slug}-frontend-${crypto.randomBytes(3).toString('hex')}`;
  const region = account?.region || 'us-east-1';
  return {
    logLines: [
      'Building frontend production bundle...',
      'Creating S3 bucket ' + bucket + '...',
      'Enabling static website hosting...',
      'Uploading build artifacts to S3...',
      'Frontend deploy complete.',
    ],
    frontendDeployResult: {
      provider: 'aws',
      bucket,
      url: `https://${bucket}.s3-website-${region}.amazonaws.com`,
      region,
    },
  };
}

router.get('/', async (req, res, next) => {
  try {
    const projects = await Project.find({ owner: req.user._id })
      .select('name repoUrl status updatedAt')
      .sort({ updatedAt: -1 });
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

// Aggregate view across every project the caller owns — powers the
// centralized portal dashboard (cross-project cost/usage totals, a merged
// 14-day trend, per-project summaries, and the most recent deploy activity).
// Registered before GET /:id so Express doesn't treat "overview" as an id.
router.get('/overview', async (req, res, next) => {
  try {
    const projects = await Project.find({ owner: req.user._id })
      .sort({ updatedAt: -1 })
      .populate('customerAwsAccount');

    const subscription = await Subscription.findOne({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('plan');

    const cloudAccounts = await CustomerAwsAccount.find({ owner: req.user._id });

    const dashboards = await Promise.all(projects.map((p) => getDashboard(p)));

    const round2 = (n) => Math.round(n * 100) / 100;

    const totals = dashboards.reduce(
      (acc, d) => {
        acc.projectedMonthlyUsd += d.cost?.projectedMonthlyUsd || 0;
        acc.actualLast30dUsd += d.cost?.actualLast30dUsd || 0;
        acc.invocations += d.metrics?.invocations || 0;
        acc.errors += d.metrics?.errors || 0;
        return acc;
      },
      { projectedMonthlyUsd: 0, actualLast30dUsd: 0, invocations: 0, errors: 0 }
    );

    // Weighted average p95 across projects, weighted by invocation volume —
    // a plain average would let a near-idle project skew the headline number.
    const weightedP95 =
      totals.invocations > 0
        ? dashboards.reduce(
            (sum, d) => sum + (d.metrics?.p95Ms || 0) * (d.metrics?.invocations || 0),
            0
          ) / totals.invocations
        : null;

    // Merge each project's 14-day series into one combined trend, keyed by date.
    const trendByDate = new Map();
    for (const d of dashboards) {
      for (const point of d.metrics?.series || []) {
        const entry = trendByDate.get(point.date) || { date: point.date, invocations: 0, errors: 0 };
        entry.invocations += point.invocations;
        entry.errors += point.errors;
        trendByDate.set(point.date, entry);
      }
    }
    const trend = [...trendByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    const projectSummaries = projects.map((p, i) => ({
      _id: p._id,
      name: p.name,
      status: p.status,
      updatedAt: p.updatedAt,
      cost: dashboards[i]?.cost || null,
      metrics: dashboards[i]?.metrics
        ? {
            invocations: dashboards[i].metrics.invocations,
            errors: dashboards[i].metrics.errors,
            p95Ms: dashboards[i].metrics.p95Ms,
          }
        : null,
    }));

    const projectIds = projects.map((p) => p._id);
    const recentDeployDocs = projectIds.length
      ? await DeployLog.find({ project: { $in: projectIds } })
          .sort({ startedAt: -1 })
          .limit(8)
          .populate('project', 'name')
          .lean()
      : [];

    const countBy = (list, field) =>
      list.reduce((acc, item) => {
        const key = item[field] || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

    const statusCounts = countBy(projects, 'status');
    const accountCounts = countBy(cloudAccounts, 'status');

    res.json({
      subscription,
      counts: {
        totalProjects: projects.length,
        deployed: statusCounts.deployed || 0,
        ready: statusCounts.ready || 0,
        analyzing: statusCounts.analyzing || 0,
        error: statusCounts.error || 0,
      },
      cloudAccounts: {
        total: cloudAccounts.length,
        connected: accountCounts.connected || 0,
        pending: accountCounts.pending || 0,
        error: accountCounts.error || 0,
        revoked: accountCounts.revoked || 0,
      },
      cost: {
        projectedMonthlyUsd: round2(totals.projectedMonthlyUsd),
        actualLast30dUsd: round2(totals.actualLast30dUsd),
      },
      metrics: {
        invocations: totals.invocations,
        errors: totals.errors,
        errorRate: totals.invocations > 0 ? totals.errors / totals.invocations : 0,
        avgP95Ms: weightedP95 != null ? Math.round(weightedP95) : null,
      },
      trend,
      projects: projectSummaries,
      recentDeploys: recentDeployDocs.map((d) => ({
        id: d._id,
        projectId: d.project?._id,
        projectName: d.project?.name || 'Unknown project',
        kind: d.kind,
        status: d.status,
        startedAt: d.startedAt,
        finishedAt: d.finishedAt,
        lambdaVersion: d.lambdaVersion,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { repoUrl, name } = req.body || {};
    if (!repoUrl) {
      return res.status(400).json({ error: 'repoUrl is required' });
    }

    const subscription = await Subscription.findOne({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('plan');

    // Default of 1 free project when the caller has no plan/subscription at
    // all, so the analysis flow isn't a dead end for brand-new signups who
    // haven't picked a plan yet. A real production deployment may want to
    // require an explicit free-tier subscription instead.
    const maxProjects =
      subscription?.plan?.maxProjects != null ? subscription.plan.maxProjects : 1;

    const existingCount = await Project.countDocuments({ owner: req.user._id });
    if (existingCount >= maxProjects) {
      return res.status(403).json({
        error: `Project limit reached for your plan (${maxProjects}). Upgrade to add more projects.`,
      });
    }

    const derivedName =
      name || repoUrl.split('/').filter(Boolean).pop()?.replace(/\.git$/, '') || 'project';

    const project = await Project.create({
      owner: req.user._id,
      name: derivedName,
      repoUrl,
      status: 'analyzing',
    });

    try {
      // Real ingestion: downloads the actual repo (tarball, no git binary
      // needed) and inspects it — replaces simulateStackDetection(), which
      // used to return the same hardcoded NestJS/React/Postgres result
      // regardless of what repoUrl was pasted.
      const { detectedStack, compatibilityChecklist, backendCandidates } = await analyzeRepo(repoUrl);
      project.detectedStack = detectedStack;
      project.compatibilityChecklist = compatibilityChecklist;
      project.backendCandidates = backendCandidates;
      project.status = 'ready';
      await project.save();
      res.status(201).json(project);
    } catch (analysisErr) {
      if (analysisErr instanceof RepoIngestError) {
        // A private repo can't be analyzed without a credential — rather
        // than deleting the project and dead-ending with a generic error,
        // check whether that's actually why analysis failed and, if so,
        // keep the project around (still 'analyzing', no detectedStack
        // yet) so the client can collect a PAT/SSH key via
        // POST /:id/github-auth instead.
        let isPrivate = false;
        try {
          const { owner, repo } = parseGithubUrl(repoUrl);
          isPrivate = await probeIsPrivate(owner, repo);
        } catch {
          // Malformed URL or probe failure — fall through to the generic
          // error response below, same as before private-repo support.
        }
        if (isPrivate) {
          return res.status(201).json({ project, needsGithubCredential: true });
        }

        // Don't leave a broken, permanently-'analyzing' project sitting in
        // the account (and consuming a project-limit slot) when the repo
        // couldn't actually be analyzed — the client has no UI yet for a
        // failed project, so surface this as a request error instead.
        await Project.deleteOne({ _id: project._id });
        return res.status(analysisErr.status).json({ error: analysisErr.message });
      }
      await Project.deleteOne({ _id: project._id });
      throw analysisErr;
    }
  } catch (err) {
    next(err);
  }
});

// Attaches a GitHub credential (PAT or SSH deploy key) to a project that
// couldn't be analyzed as a public repo, then immediately re-runs analysis
// with it so a bad token/key fails fast here rather than only being
// discovered at the next deploy. Nothing is persisted unless analysis
// actually succeeds with this credential.
router.post('/:id/github-auth', async (req, res, next) => {
  try {
    const { method, credential } = req.body || {};
    if (method !== 'pat' && method !== 'ssh') {
      return res.status(400).json({ error: "method must be 'pat' or 'ssh'" });
    }
    if (typeof credential !== 'string' || !credential.trim()) {
      return res.status(400).json({ error: 'credential is required' });
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    let analysis;
    try {
      analysis = await analyzeRepo(project.repoUrl, { method, token: credential });
    } catch (analysisErr) {
      if (analysisErr instanceof RepoIngestError) {
        return res.status(analysisErr.status).json({ error: analysisErr.message });
      }
      throw analysisErr;
    }

    const { ciphertext, iv, authTag } = encryptSecretValue(credential);
    project.githubAuth = { method, ciphertext, iv, authTag };
    project.detectedStack = analysis.detectedStack;
    project.compatibilityChecklist = analysis.compatibilityChecklist;
    project.backendCandidates = analysis.backendCandidates;
    project.status = 'ready';
    await project.save();

    res.json(project);
  } catch (err) {
    next(err);
  }
});

// Lets the customer pick which backendCandidates[] entry actually gets
// built/deployed when analyzeRepo() found more than one (a monorepo) —
// every provider's prepareBuildSource() resolves the deploy target via
// resolveBackendCandidate(project), which prefers this over candidates[0].
router.post('/:id/select-backend', async (req, res, next) => {
  try {
    const { path: backendPath } = req.body || {};
    if (typeof backendPath !== 'string' || !backendPath) {
      return res.status(400).json({ error: 'path is required' });
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const candidatePaths = (project.backendCandidates || []).map((c) => c.path);
    if (!candidatePaths.includes(backendPath)) {
      return res.status(400).json({
        error: `path must be one of this project's backendCandidates (${candidatePaths.join(', ') || 'none'})`,
      });
    }

    project.selectedBackendPath = backendPath;
    await project.save();

    res.json(project);
  } catch (err) {
    next(err);
  }
});

// Read-only preview of the Dockerfile the deploy path would actually use —
// same generateDockerfile(pkg, { listenPort }) call prepareBuildSource()
// (providers/aws/deploy.js) makes, but without writing anything or running
// a build. Re-downloads the repo source purely to read package.json (and
// the candidate's own Dockerfile, if any) and discards it immediately.
router.get('/:id/dockerfile-preview', async (req, res, next) => {
  let dir;
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const candidate = resolveBackendCandidate(project);
    if (!candidate) {
      return res.status(400).json({
        error: 'No backend was detected for this project — re-run repo analysis before previewing a Dockerfile',
      });
    }

    ({ dir } = await downloadRepoSource(project.repoUrl, resolveProjectGithubAuth(project)));
    const sourceDir = candidate.path && candidate.path !== '.' ? path.join(dir, candidate.path) : dir;

    const pkg = JSON.parse(await fs.readFile(path.join(sourceDir, 'package.json'), 'utf8'));
    const generated = generateDockerfile(pkg, { listenPort: candidate.listenPort ?? 3000 });

    const existing = await fs
      .readFile(path.join(sourceDir, 'Dockerfile'), 'utf8')
      .catch(() => null);

    if (existing !== null) {
      // The repo's own Dockerfile is what deploy actually uses unmodified
      // (see prepareBuildSource's `if (!hasDockerfile)` guard) — `dockerfile`
      // here is what Cephei *would* generate, returned alongside the real
      // one purely so the client can diff them for the customer's own review.
      res.json({ dockerfile: generated, wasGenerated: false, existingDockerfile: existing });
    } else {
      res.json({ dockerfile: generated, wasGenerated: true });
    }
  } catch (err) {
    next(err);
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id }).populate(
      'customerAwsAccount'
    );
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/traffic-tier', async (req, res, next) => {
  try {
    const { trafficTier } = req.body || {};
    const validTiers = ['steady', 'steady_spikes', 'low_spiky'];
    if (!validTiers.includes(trafficTier)) {
      return res.status(400).json({ error: `trafficTier must be one of ${validTiers.join(', ')}` });
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    project.trafficTier = trafficTier;
    // SIMULATED — replace with real cost-modeling / recommendation logic.
    project.recommendation = simulateRecommendation(trafficTier);
    await project.save();

    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/aws-account', async (req, res, next) => {
  try {
    const { customerAwsAccountId } = req.body || {};
    if (!customerAwsAccountId) {
      return res.status(400).json({ error: 'customerAwsAccountId is required' });
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const awsAccount = await CustomerAwsAccount.findOne({
      _id: customerAwsAccountId,
      owner: req.user._id,
    });
    if (!awsAccount) {
      return res.status(404).json({ error: 'Cloud account not found' });
    }
    if (awsAccount.status !== 'connected') {
      return res.status(400).json({ error: 'Cloud account is not connected yet' });
    }

    project.customerAwsAccount = awsAccount._id;
    await project.save();

    res.json(project);
  } catch (err) {
    next(err);
  }
});

// Encrypted per-project environment variables ("secrets"). See
// utils/secretsCrypto.js for what these guarantees actually are — real
// AES-256-GCM at rest, and by design no route below (or anywhere else)
// ever sends a decrypted value back to a client once it's been saved.

router.get('/:id/secrets', async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const secrets = await ProjectSecret.find({ project: project._id }).sort({ key: 1 });
    res.json(secrets.map(publicSecret));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/secrets', async (req, res, next) => {
  try {
    const { key, value } = req.body || {};
    if (!key || !SECRET_KEY_PATTERN.test(key)) {
      return res.status(400).json({
        error: 'key is required and must look like an env var name (letters, digits, underscores; not starting with a digit)',
      });
    }
    if (value === undefined || value === null || value === '') {
      return res.status(400).json({ error: 'value is required' });
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { ciphertext, iv, authTag } = encryptSecretValue(value);
    const previewSuffix = String(value).slice(-4);

    const secret = await ProjectSecret.findOneAndUpdate(
      { project: project._id, key },
      { project: project._id, key, ciphertext, iv, authTag, previewSuffix },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(201).json(publicSecret(secret));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/secrets/:secretId', async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await ProjectSecret.deleteOne({ _id: req.params.secretId, project: project._id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Secret not found' });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/deploy', requireActiveSubscription, async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id }).populate(
      'customerAwsAccount'
    );
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const deployLog = await DeployLog.create({
      project: project._id,
      kind: 'backend',
      status: 'running',
      startedAt: new Date(),
      log: [],
    });

    // Streamed as Server-Sent Events so the client can render each log line
    // as it happens instead of showing a spinner for the couple of minutes
    // a CodeBuild-based deploy can take. DeployLog.log is still built up in
    // memory exactly as before and saved once at the end, so /deploy-logs
    // and a page refresh keep working unchanged.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    // A client that navigates away mid-deploy closes the socket; the deploy
    // itself keeps running server-side, but writes to the now-dead response
    // must not crash the process.
    res.on('error', () => {});

    const sendEvent = (payload) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const onLog = (line) => {
      deployLog.log.push({ ts: new Date(), line });
      sendEvent({ line });
    };

    try {
      const providerKey = project.customerAwsAccount?.provider || 'aws';
      const provider = getProvider(providerKey);
      const secrets = await loadProjectSecretsPlaintext(project);

      const deployResult = await provider.deployBackend(
        project,
        project.customerAwsAccount,
        secrets,
        onLog
      );

      deployLog.status = 'success';
      deployLog.lambdaVersion = deployResult.lambdaLiveVersion;
      deployLog.finishedAt = new Date();
      await deployLog.save();

      project.deployResult = deployResult;
      project.status = 'deployed';
      await project.save();

      sendEvent({ done: true, project, deployLog });
    } catch (deployErr) {
      deployLog.status = 'failed';
      deployLog.error = deployErr.message;
      deployLog.finishedAt = new Date();
      await deployLog.save();

      sendEvent({ done: true, error: deployErr.message, deployLog });
    } finally {
      res.end();
    }
  } catch (err) {
    next(err);
  }
});

router.post('/:id/deploy-frontend', requireActiveSubscription, async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id }).populate(
      'customerAwsAccount'
    );
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (!project.deployResult?.invokeUrl) {
      return res.status(400).json({
        error: 'Backend must be deployed before the frontend can be deployed',
      });
    }

    const deployLog = await DeployLog.create({
      project: project._id,
      kind: 'frontend',
      status: 'running',
      startedAt: new Date(),
      log: [],
    });

    try {
      // SIMULATED — replace with real per-provider static-site deploy (see
      // simulateFrontendDeploy above).
      const { logLines, frontendDeployResult } = simulateFrontendDeploy(project, project.customerAwsAccount);
      const now = Date.now();
      deployLog.log = logLines.map((line, i) => ({ ts: new Date(now + i * 300), line }));
      deployLog.status = 'success';
      deployLog.finishedAt = new Date();
      await deployLog.save();

      project.frontendDeployResult = frontendDeployResult;
      project.frontendDeployError = undefined;
      await project.save();

      res.json({ project, deployLog });
    } catch (deployErr) {
      deployLog.status = 'failed';
      deployLog.error = deployErr.message;
      deployLog.finishedAt = new Date();
      await deployLog.save();

      project.frontendDeployError = deployErr.message;
      await project.save();

      res.status(500).json({ error: deployErr.message, deployLog });
    }
  } catch (err) {
    next(err);
  }
});

router.get('/:id/dashboard', async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id }).populate(
      'customerAwsAccount'
    );
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const dashboard = await getDashboard(project);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

router.get('/:id/deploy-logs', async (req, res, next) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id });
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Full log lines included (unlike the lighter recentDeploys projection
    // in getDashboard) — this is what powers the expandable log viewer and
    // the deploy-activity calendar in the Deploy history panel.
    const logs = await DeployLog.find({ project: project._id }).sort({ startedAt: -1 }).limit(200);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/rollback', requireActiveSubscription, async (req, res, next) => {
  try {
    const { toVersion } = req.body || {};
    if (!toVersion) {
      return res.status(400).json({ error: 'toVersion is required' });
    }

    const project = await Project.findOne({ _id: req.params.id, owner: req.user._id }).populate(
      'customerAwsAccount'
    );
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const pastDeploy = await DeployLog.findOne({
      project: project._id,
      kind: 'backend',
      status: 'success',
      lambdaVersion: toVersion,
    });
    if (!pastDeploy) {
      return res.status(400).json({
        error: `Version '${toVersion}' was not found among this project's successful backend deploys`,
      });
    }

    const deployLog = await DeployLog.create({
      project: project._id,
      kind: 'rollback',
      status: 'running',
      startedAt: new Date(),
      lambdaVersion: toVersion,
      log: [],
    });

    const onLog = (line) => {
      deployLog.log.push({ ts: new Date(), line });
    };

    try {
      const providerKey = project.deployResult?.provider || project.customerAwsAccount?.provider || 'aws';
      const provider = getProvider(providerKey);
      await provider.rollback(project, project.customerAwsAccount, toVersion, onLog);

      deployLog.status = 'success';
      deployLog.finishedAt = new Date();
      await deployLog.save();

      project.deployResult = project.deployResult || {};
      project.deployResult.lambdaLiveVersion = toVersion;
      await project.save();

      res.json({ project, deployLog });
    } catch (rollbackErr) {
      deployLog.status = 'failed';
      deployLog.error = rollbackErr.message;
      deployLog.finishedAt = new Date();
      await deployLog.save();

      res.status(rollbackErr.status || 500).json({ error: rollbackErr.message, deployLog });
    }
  } catch (err) {
    next(err);
  }
});

export default router;
