import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import { verifyToken } from '../utils/tokens.js';

function extractAccessToken(req) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await User.findById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'Account suspended' });
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden — insufficient role' });
    }
    next();
  };
}

export async function requireActiveSubscription(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const subscription = await Subscription.findOne({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('plan');

    if (!subscription || !['active', 'created'].includes(subscription.status)) {
      return res.status(402).json({
        error: 'An active subscription is required for this action',
      });
    }

    req.subscription = subscription;
    next();
  } catch (err) {
    next(err);
  }
}
