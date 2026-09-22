import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Subscription from '../models/Subscription.js';
import Project from '../models/Project.js';
import DeployLog from '../models/DeployLog.js';
import CustomerAwsAccount from '../models/CustomerAwsAccount.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

router.get('/overview', async (req, res, next) => {
  try {
    const now = new Date();
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalCustomers,
      activeSubscriptions,
      mrrAgg,
      newSignupsThisWeek,
      newSignupsThisMonth,
      totalProjects,
      deploysLast7d,
      awsConnectedCount,
      awsErrorCount,
      awsRevokedCount,
    ] = await Promise.all([
      User.countDocuments({ role: 'customer' }),
      Subscription.countDocuments({ status: 'active' }),
      Subscription.aggregate([
        { $match: { status: 'active' } },
        {
          $lookup: {
            from: 'plans',
            localField: 'plan',
            foreignField: '_id',
            as: 'planDoc',
          },
        },
        { $unwind: '$planDoc' },
        {
          $group: {
            _id: null,
            mrrInPaise: {
              $sum: {
                $cond: [
                  { $eq: ['$planDoc.interval', 'yearly'] },
                  { $divide: ['$planDoc.priceInPaise', 12] },
                  '$planDoc.priceInPaise',
                ],
              },
            },
          },
        },
      ]),
      User.countDocuments({ role: 'customer', createdAt: { $gte: startOfWeek } }),
      User.countDocuments({ role: 'customer', createdAt: { $gte: startOfMonth } }),
      Project.countDocuments({}),
      DeployLog.countDocuments({ startedAt: { $gte: last7d } }),
      CustomerAwsAccount.countDocuments({ status: 'connected' }),
      CustomerAwsAccount.countDocuments({ status: 'error' }),
      CustomerAwsAccount.countDocuments({ status: 'revoked' }),
    ]);

    res.json({
      totalCustomers,
      activeSubscriptions,
      mrrInPaise: Math.round(mrrAgg[0]?.mrrInPaise || 0),
      newSignupsThisWeek,
      newSignupsThisMonth,
      totalProjects,
      deploysLast7d,
      awsConnections: {
        connected: awsConnectedCount,
        error: awsErrorCount,
        revoked: awsRevokedCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { status, plan, q } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 20;

    const userMatch = { role: 'customer' };
    if (status) userMatch.status = status;
    if (q) {
      userMatch.$or = [
        { email: { $regex: q, $options: 'i' } },
        { name: { $regex: q, $options: 'i' } },
      ];
    }

    const pipeline = [
      { $match: userMatch },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: 'subscriptions',
          let: { userId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$user', '$$userId'] } } },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $lookup: {
                from: 'plans',
                localField: 'plan',
                foreignField: '_id',
                as: 'planDoc',
              },
            },
            { $unwind: { path: '$planDoc', preserveNullAndEmptyArrays: true } },
          ],
          as: 'latestSubscription',
        },
      },
      { $unwind: { path: '$latestSubscription', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'projects',
          localField: '_id',
          foreignField: 'owner',
          as: 'projects',
        },
      },
      {
        $addFields: {
          projectCount: { $size: '$projects' },
        },
      },
    ];

    if (plan) {
      pipeline.push({ $match: { 'latestSubscription.planDoc.key': plan } });
    }

    pipeline.push(
      {
        $project: {
          email: 1,
          name: 1,
          status: 1,
          createdAt: 1,
          lastLoginAt: 1,
          projectCount: 1,
          planName: '$latestSubscription.planDoc.name',
          subscriptionStatus: '$latestSubscription.status',
        },
      },
      { $skip: (page - 1) * pageSize },
      { $limit: pageSize }
    );

    const [users, totalCount] = await Promise.all([
      User.aggregate(pipeline),
      User.countDocuments(userMatch),
    ]);

    res.json({ users, page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) });
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [projects, awsAccounts, subscriptionHistory] = await Promise.all([
      Project.find({ owner: user._id }).sort({ updatedAt: -1 }),
      CustomerAwsAccount.find({ owner: user._id }).sort({ createdAt: -1 }),
      Subscription.find({ user: user._id }).sort({ createdAt: -1 }).populate('plan'),
    ]);

    const projectIds = projects.map((p) => p._id);
    const deployLogs = await DeployLog.find({ project: { $in: projectIds } })
      .sort({ startedAt: -1 })
      .limit(20)
      .populate('project', 'name');

    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      projects,
      deployLogs,
      // No AWS secrets are ever stored in this model — CustomerAwsAccount
      // only holds ARNs and metadata, never raw credentials.
      awsAccounts,
      subscriptionHistory,
    });
  } catch (err) {
    next(err);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.status = status;
    await user.save();

    res.json({ id: user._id, email: user.email, status: user.status });
  } catch (err) {
    next(err);
  }
});

router.get('/system-health', async (req, res, next) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    async function rateSince(since) {
      const [total, success, failed] = await Promise.all([
        DeployLog.countDocuments({ startedAt: { $gte: since } }),
        DeployLog.countDocuments({ startedAt: { $gte: since }, status: 'success' }),
        DeployLog.countDocuments({ startedAt: { $gte: since }, status: 'failed' }),
      ]);
      return {
        total,
        success,
        failed,
        successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : null,
        failureRate: total > 0 ? Math.round((failed / total) * 1000) / 10 : null,
      };
    }

    const [last24hStats, last7dStats, recentFailures] = await Promise.all([
      rateSince(last24h),
      rateSince(last7d),
      DeployLog.find({ status: 'failed' })
        .sort({ startedAt: -1 })
        .limit(10)
        .populate({ path: 'project', select: 'name owner', populate: { path: 'owner', select: 'email' } }),
    ]);

    res.json({
      last24h: last24hStats,
      last7d: last7dStats,
      recentFailures: recentFailures.map((d) => ({
        id: d._id,
        kind: d.kind,
        startedAt: d.startedAt,
        error: d.error,
        projectName: d.project?.name,
        ownerEmail: d.project?.owner?.email,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
