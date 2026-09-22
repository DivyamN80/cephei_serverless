// Upserts the three baseline plans (free / starter / pro), then seeds a demo
// customer account with an active Pro subscription, a connected AWS account,
// and a fully-deployed sample project — so a fresh local setup has something
// real to click through (dashboard charts, deploy history, rollback) instead
// of empty states everywhere.
//
// Usage: npm run seed   (requires MONGODB_URI to be set)
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Plan from '../src/models/Plan.js';
import User from '../src/models/User.js';
import Subscription from '../src/models/Subscription.js';
import CustomerAwsAccount from '../src/models/CustomerAwsAccount.js';
import Project from '../src/models/Project.js';
import DeployLog from '../src/models/DeployLog.js';

const plans = [
  {
    key: 'free',
    name: 'Free',
    priceInPaise: 0,
    interval: 'monthly',
    // razorpayPlanId left blank — the free tier has no billing cycle.
    razorpayPlanId: '',
    maxProjects: 1,
    maxDeploysPerMonth: 5,
    isActive: true,
  },
  {
    key: 'starter',
    name: 'Starter',
    priceInPaise: 99900, // ₹999/mo
    interval: 'monthly',
    // TODO: fill in once a real Razorpay Plan has been created for this tier.
    razorpayPlanId: '',
    maxProjects: 5,
    maxDeploysPerMonth: 50,
    isActive: true,
  },
  {
    key: 'pro',
    name: 'Pro',
    priceInPaise: 299900, // ₹2,999/mo
    interval: 'monthly',
    // TODO: fill in once a real Razorpay Plan has been created for this tier.
    razorpayPlanId: '',
    maxProjects: 100,
    maxDeploysPerMonth: 1000,
    isActive: true,
  },
];

// Dev-only demo credentials — not meant for production use.
const DEMO_EMAIL = 'demo@cephei.dev';
const DEMO_PASSWORD = 'Demo12345!';
const DEMO_ADMIN_EMAIL = 'demo-admin@cephei.dev';
const DEMO_ADMIN_PASSWORD = 'DemoAdmin12345!';

async function seedPlans() {
  const byKey = {};
  for (const plan of plans) {
    const result = await Plan.findOneAndUpdate({ key: plan.key }, plan, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    console.log(`Upserted plan: ${result.key} (${result.name})`);
    byKey[result.key] = result;
  }
  return byKey;
}

async function seedDemoUser() {
  let user = await User.findOne({ email: DEMO_EMAIL });
  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    user = await User.create({
      email: DEMO_EMAIL,
      passwordHash,
      name: 'Demo Customer',
      role: 'customer',
    });
    console.log(`Created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } else {
    console.log(`Demo user already exists: ${DEMO_EMAIL}`);
  }
  return user;
}

async function seedDemoAdmin() {
  let user = await User.findOne({ email: DEMO_ADMIN_EMAIL });
  if (!user) {
    const passwordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
    user = await User.create({
      email: DEMO_ADMIN_EMAIL,
      passwordHash,
      name: 'Demo Admin',
      role: 'admin',
    });
    console.log(`Created demo admin: ${DEMO_ADMIN_EMAIL} / ${DEMO_ADMIN_PASSWORD}`);
  } else {
    console.log(`Demo admin already exists: ${DEMO_ADMIN_EMAIL}`);
  }
  return user;
}

async function seedDemoSubscription(user, proPlan) {
  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  await Subscription.findOneAndUpdate(
    { user: user._id },
    {
      user: user._id,
      plan: proPlan._id,
      status: 'active',
      currentPeriodEnd: periodEnd,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log('Demo user is subscribed to the Pro plan (active).');
}

async function seedDemoAwsAccount(user) {
  let awsAccount = await CustomerAwsAccount.findOne({ owner: user._id });
  if (!awsAccount) {
    awsAccount = await CustomerAwsAccount.create({
      owner: user._id,
      externalId: crypto.randomUUID(),
      awsAccountId: '123456789012',
      roleArn: 'arn:aws:iam::123456789012:role/CepheiServerlessAccess',
      executionRoleArn: 'arn:aws:iam::123456789012:role/CepheiServerlessLambdaExecution',
      region: 'us-east-1',
      status: 'connected',
      connectedAt: new Date(),
    });
    console.log('Created a connected demo AWS account.');
  } else {
    console.log('Demo AWS account already exists.');
  }
  return awsAccount;
}

async function seedDemoProject(user, awsAccount) {
  const existing = await Project.findOne({ owner: user._id });
  if (existing) {
    console.log('Demo project already exists — skipping.');
    return;
  }

  const project = await Project.create({
    owner: user._id,
    name: 'order-service-api',
    repoUrl: 'https://github.com/acme-demo/order-service-api',
    status: 'deployed',
    detectedStack: {
      backend: 'NestJS',
      frontend: 'React',
      database: 'postgres',
      versions: { node: '20.x', nest: '10.x', react: '18.x' },
    },
    compatibilityChecklist: [
      { label: 'Uses @nestjs/schedule cron job', severity: 'warning' },
      { label: 'No WebSocket usage detected', severity: 'ok' },
      { label: 'Reads/writes local disk in UploadsService', severity: 'warning' },
      { label: 'Stateless HTTP handlers elsewhere', severity: 'ok' },
    ],
    trafficTier: 'steady_spikes',
    recommendation: {
      target: 'lambda_managed_instances',
      projectedMonthlySavingsUsd: 220,
      diff: [
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
      ],
    },
    customerAwsAccount: awsAccount._id,
    deployResult: {
      invokeUrl: 'https://a1b2c3d4e5.execute-api.us-east-1.amazonaws.com',
      functionName: 'cephei-order-service-api',
      apiId: 'a1b2c3d4e5',
      region: 'us-east-1',
      lambdaLiveVersion: '2',
    },
    frontendDeployResult: {
      bucket: 'cephei-order-service-api-frontend-9f8e7d',
      url: 'https://cephei-order-service-api-frontend-9f8e7d.s3-website-us-east-1.amazonaws.com',
      region: 'us-east-1',
    },
  });
  console.log('Created demo project (deployed): order-service-api');

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const toLog = (lines, startedAt) => lines.map((line, i) => ({ ts: new Date(startedAt + i * 300), line }));

  await DeployLog.create({
    project: project._id,
    kind: 'backend',
    status: 'success',
    startedAt: new Date(now - 2 * day),
    finishedAt: new Date(now - 2 * day + 4000),
    lambdaVersion: '1',
    log: toLog(
      [
        'Assuming cross-account IAM role in customer AWS account...',
        'Building container image from Dockerfile...',
        'Successfully built image cephei/order-service-api:latest',
        'Pushing image to ECR repository...',
        'Creating Lambda function cephei-order-service-api...',
        'Publishing new Lambda version...',
        'Configuring API Gateway HTTP API route...',
        'Deploy complete.',
      ],
      now - 2 * day
    ),
  });

  await DeployLog.create({
    project: project._id,
    kind: 'backend',
    status: 'success',
    startedAt: new Date(now - 1 * day),
    finishedAt: new Date(now - 1 * day + 4000),
    lambdaVersion: '2',
    log: toLog(
      [
        'Assuming cross-account IAM role in customer AWS account...',
        'Building container image from Dockerfile...',
        'Successfully built image cephei/order-service-api:latest',
        'Pushing image to ECR repository...',
        'Updating Lambda function cephei-order-service-api...',
        'Publishing new Lambda version...',
        'Deploy complete.',
      ],
      now - 1 * day
    ),
  });

  await DeployLog.create({
    project: project._id,
    kind: 'frontend',
    status: 'success',
    startedAt: new Date(now - 1 * day + 60000),
    finishedAt: new Date(now - 1 * day + 64000),
    log: toLog(
      [
        'Building frontend production bundle...',
        'Creating S3 bucket cephei-order-service-api-frontend-9f8e7d...',
        'Enabling static website hosting...',
        'Uploading build artifacts to S3...',
        'Frontend deploy complete.',
      ],
      now - 1 * day + 60000
    ),
  });

  console.log('Created 3 demo deploy log entries (backend v1, backend v2, frontend) — rollback to v1 is available.');
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected to MongoDB, seeding plans...');

  const plansByKey = await seedPlans();

  console.log('Seeding demo account...');
  const demoUser = await seedDemoUser();
  await seedDemoSubscription(demoUser, plansByKey.pro);
  const awsAccount = await seedDemoAwsAccount(demoUser);
  await seedDemoProject(demoUser, awsAccount);

  console.log('Seeding demo admin...');
  await seedDemoAdmin();

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
