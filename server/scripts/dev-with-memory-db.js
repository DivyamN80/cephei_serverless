// LOCAL DEV / TESTING CONVENIENCE ONLY — NOT FOR PRODUCTION.
//
// Boots a local MongoDB instance (via mongodb-memory-server, which manages
// its own mongod binary — no separate MongoDB install needed) and then
// starts src/index.js pointed at it.
//
// Despite the package name, this is NOT ephemeral: it points mongod at a
// fixed on-disk data directory (.mongo-data/, gitignored) with the durable
// wiredTiger storage engine, so users/projects/sessions survive a server
// restart. That matters in practice — every earlier version of this script
// used a fresh temp directory per run, which silently invalidated every
// signed-in browser session (and wiped all data) on every restart. If you
// really want a throwaway database, delete .mongo-data/ and restart.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', '.mongo-data');

async function main() {
  fs.mkdirSync(dbPath, { recursive: true });

  const mongod = await MongoMemoryServer.create({
    instance: {
      dbPath,
      storageEngine: 'wiredTiger', // durable — 'ephemeralForTest' (the default) never touches disk
    },
  });
  const uri = mongod.getUri();

  process.env.MONGODB_URI = uri;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret-change-me';
  process.env.SECRETS_ENCRYPTION_KEY =
    process.env.SECRETS_ENCRYPTION_KEY || 'dev-only-insecure-secrets-key-change-me';
  process.env.PORT = process.env.PORT || '4000';

  console.log(`[dev:memory] MongoDB started at ${uri}`);
  console.log(`[dev:memory] Data persists in ${dbPath} across restarts (delete it for a clean slate).`);

  // Import after env vars are set so index.js picks them up.
  await import('../src/index.js');

  const shutdown = async () => {
    console.log('[dev:memory] Shutting down MongoDB (data kept on disk)...');
    await mongod.stop(); // default options never delete a custom dbPath
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
