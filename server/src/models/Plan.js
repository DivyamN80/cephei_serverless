import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true }, // 'free' | 'starter' | 'pro'
    name: String,
    priceInPaise: Number, // INR paise
    interval: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
    razorpayPlanId: String,
    maxProjects: Number,
    maxDeploysPerMonth: Number,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Plan', planSchema);
