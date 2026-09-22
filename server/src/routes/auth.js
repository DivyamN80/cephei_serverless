import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { requireAuth } from '../middleware/auth.js';
import {
  issueTokens,
  signAccessToken,
  verifyToken,
  refreshCookieOptions,
} from '../utils/tokens.js';

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later.' },
});

const BCRYPT_COST = 12;

function publicUser(user) {
  return {
    id: user._id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { email, password, name } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await User.create({
      email: email.toLowerCase().trim(),
      passwordHash,
      name,
      role: 'customer',
    });

    const { accessToken, refreshToken } = issueTokens(user);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions());

    res.status(201).json({ accessToken, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const { accessToken, refreshToken } = issueTokens(user);
    res.cookie('refreshToken', refreshToken, refreshCookieOptions());

    res.json({ accessToken, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken;
    if (!token) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }
    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await User.findById(payload.sub);
    if (!user || user.status === 'suspended') {
      return res.status(401).json({ error: 'User not found or suspended' });
    }

    const accessToken = signAccessToken(user);
    res.json({ accessToken, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('refreshToken', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('plan');

    res.json({ user: publicUser(req.user), subscription });
  } catch (err) {
    next(err);
  }
});

export default router;
