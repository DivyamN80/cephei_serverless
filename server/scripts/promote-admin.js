// Promotes a user to the 'admin' role by email.
//
// Usage: node scripts/promote-admin.js someone@example.com
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/promote-admin.js <email>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    console.error(`No user found with email '${email}'.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  user.role = 'admin';
  await user.save();

  console.log(`User ${user.email} is now an admin.`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
