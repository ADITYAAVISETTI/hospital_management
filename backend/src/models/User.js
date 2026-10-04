const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { nextSequence } = require('./Counter');

const ROLES = ['patient', 'doctor', 'admin'];
const GENDERS = ['male', 'female', 'other'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'grandparent', 'other'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Optional: family members and some walk-in patients have no email/login.
    // Never store '' here (it would clash with the unique index); leave it unset.
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    password: { type: String, select: false },
    role: { type: String, enum: ROLES, default: 'patient' },
    phone: { type: String, trim: true, default: '' },
    // Stored as YYYY-MM-DD to avoid timezone shifts.
    dateOfBirth: { type: String, default: '' },
    gender: { type: String, enum: [...GENDERS, ''], default: '' },
    bloodGroup: { type: String, enum: [...BLOOD_GROUPS, ''], default: '' },
    address: { type: String, trim: true, default: '', maxlength: 300 },
    // Unique Health ID, assigned to patients only.
    uhid: { type: String, unique: true, sparse: true },
    // Family members are patients managed from another patient's account.
    guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    relation: { type: String, enum: [...RELATIONS, ''], default: '' },
    // Login tokens issued before this time are rejected (set on password change).
    passwordChangedAt: { type: Date },
    // Password reset: only a hash of the emailed token is stored.
    resetTokenHash: { type: String, select: false },
    resetTokenExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (this.email === '') this.email = undefined;
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
    if (!this.isNew) this.passwordChangedAt = new Date();
  }
  if (this.isNew && this.role === 'patient' && !this.uhid) {
    const seq = await nextSequence('uhid');
    this.uhid = `CC${String(seq).padStart(6, '0')}`;
  }
});

userSchema.methods.checkPassword = function (plain) {
  if (!this.password) return Promise.resolve(false); // account without a login
  return bcrypt.compare(plain, this.password);
};

userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    name: this.name,
    email: this.email || '',
    role: this.role,
    phone: this.phone,
    dateOfBirth: this.dateOfBirth,
    gender: this.gender,
    bloodGroup: this.bloodGroup,
    address: this.address,
    uhid: this.uhid,
    guardian: this.guardian || null,
    relation: this.relation,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
module.exports.GENDERS = GENDERS;
module.exports.BLOOD_GROUPS = BLOOD_GROUPS;
module.exports.RELATIONS = RELATIONS;
