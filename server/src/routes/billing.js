import express from 'express';
import crypto from 'crypto';
import Plan from '../models/Plan.js';
import Subscription from '../models/Subscription.js';
import { requireAuth } from '../middleware/auth.js';
import razorpay from '../services/razorpay.js';

const router = express.Router();

// NOTE: this router is mounted in index.js BEFORE the global express.json()
// middleware, specifically so that POST /webhook can read the raw request
// body (required to verify the Razorpay HMAC signature). GET/POST routes
// below therefore each declare their own body parser as needed.

router.get('/plans', express.json(), async (req, res, next) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ priceInPaise: 1 });
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

router.get('/subscription', express.json(), requireAuth, async (req, res, next) => {
  try {
    const subscription = await Subscription.findOne({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate('plan');
    res.json(subscription || null);
  } catch (err) {
    next(err);
  }
});

router.post('/checkout', express.json(), requireAuth, async (req, res, next) => {
  try {
    const { planId } = req.body || {};
    if (!planId) {
      return res.status(400).json({ error: 'planId is required' });
    }

    const plan = await Plan.findById(planId);
    if (!plan || !plan.isActive) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (!razorpay) {
      return res.status(501).json({
        error: 'Razorpay not configured — set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET',
      });
    }

    if (!plan.razorpayPlanId) {
      return res.status(501).json({
        error: `Plan '${plan.key}' has no razorpayPlanId configured yet`,
      });
    }

    const razorpaySubscription = await razorpay.subscriptions.create({
      plan_id: plan.razorpayPlanId,
      customer_notify: 1,
      total_count: plan.interval === 'yearly' ? 1 : 12,
      notes: { userId: req.user._id.toString(), planKey: plan.key },
    });

    const subscription = await Subscription.create({
      user: req.user._id,
      plan: plan._id,
      razorpaySubscriptionId: razorpaySubscription.id,
      status: 'created',
    });

    res.status(201).json({ subscription, razorpaySubscription });
  } catch (err) {
    next(err);
  }
});

// Raw-body webhook route — deliberately NOT using express.json() here.
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      return res.status(400).json({ error: 'Missing signature or webhook secret not configured' });
    }

    const rawBody = req.body; // Buffer, thanks to express.raw()
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    const validSignature =
      expectedSignature.length === String(signature).length &&
      crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(String(signature)));

    if (!validSignature) {
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = payload.event;
    const razorpaySubscriptionId =
      payload.payload?.subscription?.entity?.id || payload.payload?.subscription?.entity?.subscription_id;

    if (razorpaySubscriptionId) {
      const subscription = await Subscription.findOne({ razorpaySubscriptionId });
      if (subscription) {
        switch (event) {
          case 'subscription.activated':
            subscription.status = 'active';
            break;
          case 'subscription.charged': {
            subscription.status = 'active';
            const periodEnd = payload.payload?.subscription?.entity?.current_end;
            if (periodEnd) {
              subscription.currentPeriodEnd = new Date(periodEnd * 1000);
            }
            break;
          }
          case 'subscription.pending':
            subscription.status = 'pending';
            break;
          case 'subscription.halted':
            subscription.status = 'halted';
            break;
          case 'subscription.cancelled':
            subscription.status = 'cancelled';
            subscription.cancelledAt = new Date();
            break;
          case 'subscription.completed':
            subscription.status = 'completed';
            break;
          default:
            break; // unhandled event types are ignored
        }
        await subscription.save();
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

export default router;
