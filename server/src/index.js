import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import billingRouter from './routes/billing.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import customerAwsAccountsRouter from './routes/customerAwsAccounts.js';
import adminRouter from './routes/admin.js';

const app = express();

app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);

// Health check — does NOT touch the DB, so it works even if Mongo is down.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// IMPORTANT: /api/billing is mounted BEFORE the global express.json()
// middleware below, because its /webhook route needs the raw request body
// to verify the Razorpay HMAC signature. billing.js applies express.json()
// itself on its other routes.
app.use('/api/billing', billingRouter);

// Global JSON body parser for everything mounted after this point.
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/customer-aws-accounts', customerAwsAccountsRouter);
app.use('/api/admin', adminRouter);

// 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    // Fail DB-dependent queries immediately instead of buffering for 10s each -
    // makes it obvious right away that MONGODB_URI needs to be set, rather than
    // making every request hang before it errors.
    mongoose.set('bufferCommands', false);
    console.warn(
      '[db] MONGODB_URI is not set — skipping Mongo connection. DB-dependent routes will error until it is configured.'
    );
    return;
  }
  try {
    await mongoose.connect(uri);
    console.log('[db] Connected to MongoDB');
  } catch (err) {
    console.warn('[db] Failed to connect to MongoDB — server will keep running, but DB-dependent routes will error.');
    console.warn(`[db] ${err.message}`);
  }
}

connectDb();

app.listen(PORT, () => {
  console.log(`[server] Cephei Serverless API listening on port ${PORT}`);
});

export default app;
