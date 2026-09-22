import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: String,
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastLoginAt: Date,
    razorpayCustomerId: String,
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
