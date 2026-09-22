import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
    razorpaySubscriptionId: String,
    status: {
      type: String,
      enum: [
        'created',
        'authenticated',
        'active',
        'pending',
        'halted',
        'cancelled',
        'completed',
        'expired',
      ],
      default: 'created',
    },
    currentPeriodEnd: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

export default mongoose.model('Subscription', subscriptionSchema);
