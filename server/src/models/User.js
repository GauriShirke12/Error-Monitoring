const { Schema, model, Types } = require('mongoose');

const membershipSchema = new Schema(
  {
    projectId: { type: Types.ObjectId, ref: 'Project', required: true },
    role: { type: String, enum: ['admin', 'developer', 'viewer'], default: 'viewer' },
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    memberships: { type: [membershipSchema], default: [] },
  },
  { timestamps: true }
);

userSchema.methods.getRoleForProject = function getRoleForProject(projectId) {
  if (!projectId) return null;
  const idStr = typeof projectId === 'string' ? projectId : projectId.toString();
  const entry = (this.memberships || []).find((m) => m.projectId && m.projectId.toString() === idStr);
  return entry ? entry.role : null;
};

module.exports = model('User', userSchema);
