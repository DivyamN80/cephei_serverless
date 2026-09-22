import mongoose from 'mongoose';

// One encrypted environment-variable entry for a project. The plaintext
// value is never stored — only AES-256-GCM ciphertext plus the per-value iv
// and authTag needed to decrypt it (see utils/secretsCrypto.js). There is
// intentionally no route that reads these fields back to a client.
const projectSecretSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true, trim: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    // Last 4 chars only, for the masked "••••••••1a2b" UI preview — not
    // enough to reconstruct the value, just enough for the user to tell
    // their own entries apart.
    previewSuffix: { type: String, required: true },
  },
  { timestamps: true }
);

projectSecretSchema.index({ project: 1, key: 1 }, { unique: true });

export default mongoose.model('ProjectSecret', projectSecretSchema);
