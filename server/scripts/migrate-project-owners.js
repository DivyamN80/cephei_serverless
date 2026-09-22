// Finds Projects with no owner set and assigns them all to a given user.
//
// Usage: node scripts/migrate-project-owners.js --assign-to someone@example.com
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Project from '../src/models/Project.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--assign-to') {
      args.assignTo = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const { assignTo } = parseArgs(process.argv.slice(2));
  if (!assignTo) {
    console.error('Usage: node scripts/migrate-project-owners.js --assign-to <email>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const user = await User.findOne({ email: assignTo.toLowerCase().trim() });
  if (!user) {
    console.error(`No user found with email '${assignTo}'. Aborting — nothing was changed.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const orphaned = await Project.find({ owner: { $exists: false } });
  console.log(`Found ${orphaned.length} project(s) with no owner.`);

  if (orphaned.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const result = await Project.updateMany(
    { owner: { $exists: false } },
    { $set: { owner: user._id } }
  );

  console.log(`Assigned ${result.modifiedCount} project(s) to ${user.email}.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
