import fs from 'fs/promises';
import fssync from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';

const GITHUB_API = 'https://api.github.com';
const CODELOAD = 'https://codeload.github.com';
const USER_AGENT = 'cephei-serverless-repo-ingest';

const MAX_PACKAGE_JSON_DEPTH = 3;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.cache', '.turbo']);
const SOURCE_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const MAX_FILES_SCANNED = 4000;
const MAX_FILE_SIZE_BYTES = 512 * 1024;

// Thrown for anything the caller did wrong (bad URL, private/missing repo,
// no branch) so the route can surface a real message instead of a generic
// 500 — matches server/src/index.js's centralized error handler, which
// reads err.status/err.message directly.
export class RepoIngestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RepoIngestError';
    this.status = status;
  }
}

// Accepts https://github.com/owner/repo[.git][/tree/branch] and the
// git@github.com:owner/repo.git SSH form. Anything else (other hosts,
// malformed input) is rejected before any network call is made.
export function parseGithubUrl(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new RepoIngestError('repoUrl is required');
  }
  const trimmed = repoUrl.trim();

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(\.git)?\/?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2], branch: null };
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    throw new RepoIngestError('repoUrl must be a valid URL, e.g. https://github.com/owner/repo');
  }

  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') {
    throw new RepoIngestError('Only public GitHub repositories are supported right now');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new RepoIngestError('repoUrl must include an owner and repository name, e.g. https://github.com/owner/repo');
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, '');
  let branch = null;
  if (parts[2] === 'tree' && parts[3]) {
    branch = decodeURIComponent(parts[3]);
  }
  return { owner, repo, branch };
}

function githubHeaders(extra = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json', ...extra };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchRepoMetadata(owner, repo) {
  let res;
  try {
    res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new RepoIngestError(`Could not reach GitHub to look up ${owner}/${repo}: ${err.message}`, 502);
  }

  if (res.status === 404) {
    throw new RepoIngestError(
      `GitHub repo ${owner}/${repo} was not found. Check the URL and make sure the repository is public.`
    );
  }
  if (res.status === 403) {
    throw new RepoIngestError('GitHub API rate limit reached while looking up that repository. Try again in a few minutes.', 429);
  }
  if (!res.ok) {
    throw new RepoIngestError(`GitHub API returned ${res.status} while looking up ${owner}/${repo}.`, 502);
  }

  const data = await res.json();
  if (data.private) {
    throw new RepoIngestError('This repository is private. Only public GitHub repositories are supported right now.');
  }
  return data;
}

// Downloads the repo tarball (no git binary required) and extracts it into
// a fresh scratch directory under the OS temp dir, stripping the single
// "<repo>-<branch>/" top-level folder codeload tarballs are wrapped in.
async function downloadAndExtract(owner, repo, branch) {
  const dest = path.join(os.tmpdir(), `cephei-ingest-${crypto.randomBytes(8).toString('hex')}`);
  await fs.mkdir(dest, { recursive: true });

  const url = `${CODELOAD}/${owner}/${repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    await fs.rm(dest, { recursive: true, force: true });
    throw new RepoIngestError(`Could not download ${owner}/${repo}@${branch}: ${err.message}`, 502);
  }

  if (!res.ok || !res.body) {
    await fs.rm(dest, { recursive: true, force: true });
    throw new RepoIngestError(
      `Could not download ${owner}/${repo}@${branch} (HTTP ${res.status}). Check that the branch exists.`,
      502
    );
  }

  try {
    await pipeline(Readable.fromWeb(res.body), tar.x({ cwd: dest, strip: 1 }));
  } catch (err) {
    await fs.rm(dest, { recursive: true, force: true });
    throw new RepoIngestError(`Downloaded ${owner}/${repo}@${branch} but could not extract it: ${err.message}`, 502);
  }

  return dest;
}

async function findPackageJsonFiles(root, maxDepth = MAX_PACKAGE_JSON_DEPTH) {
  const results = [];

  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === 'package.json') {
        results.push(full);
      }
    }
  }

  await walk(root, 0);
  return results;
}

const BACKEND_FRAMEWORKS = [
  { dep: '@nestjs/core', name: 'NestJS' },
  { dep: 'fastify', name: 'Fastify' },
  { dep: 'koa', name: 'Koa' },
  { dep: 'express', name: 'Express' },
];

const FRONTEND_FRAMEWORKS = [
  { dep: 'next', name: 'Next.js' },
  { dep: 'react', name: 'React' },
  { dep: 'vue', name: 'Vue' },
  { dep: '@angular/core', name: 'Angular' },
  { dep: 'svelte', name: 'Svelte' },
];

function detectFramework(deps, table) {
  for (const { dep, name } of table) {
    if (deps[dep]) return { name, dep, version: deps[dep] };
  }
  return null;
}

function detectDatabase(deps) {
  if (deps.pg) return 'postgres';
  if (deps.mongoose) return 'mongodb';
  if (deps.mysql2 || deps.mysql) return 'mysql';
  if (deps['@nestjs/typeorm'] || deps.typeorm) return 'postgres';
  return null;
}

const PATTERN_CHECKS = [
  {
    id: 'cron',
    okLabel: 'No background job / cron scheduling detected',
    warnPrefix: 'Background job / cron scheduling found',
    regex: /@nestjs\/schedule|node-cron|node-schedule|setInterval\s*\(/,
  },
  {
    id: 'websocket',
    okLabel: 'No WebSocket usage detected',
    warnPrefix: 'WebSocket usage found',
    regex: /socket\.io|@nestjs\/websockets|new WebSocket\(|require\(['"]ws['"]\)|from ['"]ws['"]/,
  },
  {
    id: 'disk-write',
    okLabel: 'No local disk writes outside /tmp detected',
    warnPrefix: 'Local disk write outside /tmp found (Lambda’s filesystem is read-only except /tmp)',
    regex: /fs\.(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/,
    isRelevant: (line) => !line.includes('/tmp'),
  },
];

async function collectSourceFiles(root) {
  const files = [];

  async function walk(dir) {
    if (files.length >= MAX_FILES_SCANNED) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES_SCANNED) return;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name))) {
        files.push(path.join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return files;
}

// Real greps over the actual extracted source for patterns that are known
// Lambda-incompatibility risks — replaces the four hardcoded checklist
// lines the old simulator always returned. Each result names the real
// file:line it matched, or reports "not detected" if nothing matched.
async function scanForCompatibilityIssues(root) {
  const files = await collectSourceFiles(root);
  const firstMatch = new Map();

  for (const file of files) {
    if (firstMatch.size === PATTERN_CHECKS.length) break;
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_SIZE_BYTES) continue;

    let content;
    try {
      content = await fs.readFile(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n');

    for (const check of PATTERN_CHECKS) {
      if (firstMatch.has(check.id)) continue;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!check.regex.test(line)) continue;
        if (check.isRelevant && !check.isRelevant(line)) continue;
        const rel = path.relative(root, file).split(path.sep).join('/');
        firstMatch.set(check.id, `${rel}:${i + 1}`);
        break;
      }
    }
  }

  return PATTERN_CHECKS.map((check) => {
    const loc = firstMatch.get(check.id);
    return loc
      ? { label: `${check.warnPrefix} in ${loc}`, severity: 'warning' }
      : { label: check.okLabel, severity: 'ok' };
  });
}

// Re-downloads and extracts repoUrl's source into a fresh scratch
// directory — used at deploy time (a separate request, possibly a
// separate server process, from the one that ran analyzeRepo) rather than
// assuming an earlier extraction still exists. Caller owns cleanup of the
// returned directory.
export async function downloadRepoSource(repoUrl) {
  const { owner, repo, branch: branchOverride } = parseGithubUrl(repoUrl);
  const meta = await fetchRepoMetadata(owner, repo);
  const branch = branchOverride || meta.default_branch;
  const dir = await downloadAndExtract(owner, repo, branch);
  return { dir, owner, repo, branch };
}

// Real replacement for simulateStackDetection(): clones (via tarball, no
// git binary needed) and inspects the actual repo pointed at by repoUrl,
// instead of returning the same hardcoded NestJS/React/Postgres result for
// every project.
export async function analyzeRepo(repoUrl) {
  const { owner, repo, branch: branchOverride } = parseGithubUrl(repoUrl);
  const meta = await fetchRepoMetadata(owner, repo);
  const branch = branchOverride || meta.default_branch;
  const dest = await downloadAndExtract(owner, repo, branch);

  try {
    const pkgPaths = await findPackageJsonFiles(dest);

    if (pkgPaths.length === 0) {
      return {
        detectedStack: { backend: null, frontend: null, database: null, versions: {} },
        compatibilityChecklist: [
          {
            label: `No package.json found within the first ${MAX_PACKAGE_JSON_DEPTH} directory levels — only Node.js projects are supported right now`,
            severity: 'blocker',
          },
        ],
        backendCandidates: [],
      };
    }

    const candidates = [];
    for (const pkgPath of pkgPaths) {
      let pkg;
      try {
        pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
      } catch {
        continue;
      }
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const backend = detectFramework(deps, BACKEND_FRAMEWORKS);
      const frontend = detectFramework(deps, FRONTEND_FRAMEWORKS);
      const dir = path.dirname(pkgPath);
      const relDir = path.relative(dest, dir).split(path.sep).join('/') || '.';

      candidates.push({
        path: relDir,
        name: pkg.name || relDir,
        backend,
        frontend,
        database: detectDatabase(deps),
        node: pkg.engines?.node || null,
        hasDockerfile: fssync.existsSync(path.join(dir, 'Dockerfile')),
      });
    }

    const backendCandidates = candidates.filter((c) => c.backend);
    const frontendCandidate = candidates.find((c) => c.frontend);

    let detectedStack;
    const compatibilityChecklist = [];

    if (backendCandidates.length === 0) {
      detectedStack = {
        backend: null,
        frontend: frontendCandidate?.frontend.name || null,
        database: null,
        versions: {},
      };
      compatibilityChecklist.push({
        label: 'No recognized backend framework found (looked for NestJS, Express, Fastify, Koa)',
        severity: 'blocker',
      });
    } else if (backendCandidates.length > 1) {
      detectedStack = {
        backend: 'ambiguous',
        frontend: frontendCandidate?.frontend.name || null,
        database: null,
        versions: {},
      };
      compatibilityChecklist.push({
        label: `Multiple backend candidates found (${backendCandidates.map((c) => c.path).join(', ')}) — this looks like a monorepo; pick one before deploying`,
        severity: 'warning',
      });
    } else {
      const b = backendCandidates[0];
      detectedStack = {
        backend: b.backend.name,
        frontend: frontendCandidate?.frontend.name || null,
        database: b.database,
        versions: {
          node: b.node || undefined,
          [b.backend.dep]: b.backend.version,
        },
      };
      compatibilityChecklist.push({
        label: b.hasDockerfile
          ? `Dockerfile found for ${b.name} (${b.path})`
          : `No Dockerfile found for ${b.name} (${b.path}) — one will be generated from the detected framework at deploy time`,
        severity: b.hasDockerfile ? 'ok' : 'warning',
      });
    }

    compatibilityChecklist.push(...(await scanForCompatibilityIssues(dest)));

    return {
      detectedStack,
      compatibilityChecklist,
      backendCandidates: backendCandidates.map((c) => ({
        path: c.path,
        name: c.name,
        framework: c.backend.name,
        database: c.database,
        hasDockerfile: c.hasDockerfile,
      })),
    };
  } finally {
    await fs.rm(dest, { recursive: true, force: true });
  }
}
