import mongoose from 'mongoose';

const deployLogSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    kind: { type: String, enum: ['backend', 'frontend', 'rollback'], required: true },
    status: { type: String, enum: ['running', 'success', 'failed'], default: 'running' },
    startedAt: { type: Date, default: Date.now },
    finishedAt: Date,
    lambdaVersion: String,
    log: [{ ts: Date, line: String }],
    error: String,
  },
  { timestamps: true }
);

export default mongoose.model('DeployLog', deployLogSchema);
