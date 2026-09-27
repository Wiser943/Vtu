const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // ─── BASIC INFO ─────────────────────────────────────────
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true, minlength: 8 },
  avatar: { type: String, default: null },

  // ─── ROLES ──────────────────────────────────────────────
  role: { type: String, enum: ['user', 'reseller', 'admin'], default: 'user' },
  resellerTier: { type: String, enum: ['bronze', 'silver', 'gold', 'api'], default: null },

  // ─── VERIFICATION ───────────────────────────────────────
  isEmailVerified: { type: Boolean, default: false },
  emailVerifyToken: String,
  emailVerifyExpires: Date,

  // ─── WALLET ─────────────────────────────────────────────
  walletBalance: { type: Number, default: 0 },
  cashbackBalance: { type: Number, default: 0 },
  totalSpent: { type: Number, default: 0 },
  totalFunded: { type: Number, default: 0 },

  // ─── VIRTUAL ACCOUNT (Korapay) ───────────────────────────
  virtualAccount: {
    accountNumber: String,
    bankName: String,
    accountName: String,
    accountReference: String
  },

  // ─── TRANSACTION PIN ────────────────────────────────────
  transactionPin: { type: String, default: null },
  pinSetAt: Date,
  pinAttempts: { type: Number, default: 0 },
  pinLockedUntil: Date,

  // ─── 2FA ────────────────────────────────────────────────
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: String,

  // ─── REFERRAL ───────────────────────────────────────────
  referralCode: { type: String, unique: true },
  referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  referralCount: { type: Number, default: 0 },
  referralEarnings: { type: Number, default: 0 },

  // ─── SUBSCRIPTION ───────────────────────────────────────
  subscriptionPlan: { type: String, enum: ['free', 'silver', 'gold', 'platinum'], default: 'free' },
  subscriptionExpires: Date,
  subscriptionDiscount: { type: Number, default: 0 },

  // ─── TIER / CASHBACK ────────────────────────────────────
  userTier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum'], default: 'bronze' },
  cashbackPercent: { type: Number, default: 0.5 },

  // ─── API ACCESS (resellers) ─────────────────────────────
  apiKey: { type: String, default: null },
  apiEnabled: { type: Boolean, default: false },
  apiCallsToday: { type: Number, default: 0 },
  apiCallsLimit: { type: Number, default: 1000 },

  // ─── FAVOURITES ─────────────────────────────────────────
  favourites: [{
    name: String,
    phone: String,
    network: String,
    serviceType: { type: String, enum: ['airtime', 'data'] }
  }],

  // ─── SECURITY ───────────────────────────────────────────
  loginAttempts: { type: Number, default: 0 },
  lockUntil: Date,
  lastLoginAt: Date,
  lastLoginIp: String,
  loginHistory: [{
    ip: String,
    device: String,
    location: String,
    timestamp: { type: Date, default: Date.now },
    success: Boolean
  }],

  // ─── PASSWORD RESET ─────────────────────────────────────
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // ─── STATUS ─────────────────────────────────────────────
  isActive: { type: Boolean, default: true },
  isSuspended: { type: Boolean, default: false },
  suspendReason: String,

  // ─── NOTIFICATIONS ──────────────────────────────────────
  notifications: [{
    type: { type: String },
    title: String,
    message: String,
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],

  // ─── SETTINGS ───────────────────────────────────────────
  settings: {
    emailNotifications: { type: Boolean, default: true },
    smsNotifications: { type: Boolean, default: false },
    transactionAlerts: { type: Boolean, default: true },
    loginAlerts: { type: Boolean, default: true }
  },

  // ─── KYC ────────────────────────────────────────────────
  kyc: {
    bvn: String,
    nin: String,
    verified: { type: Boolean, default: false },
    submittedAt: Date
  }

}, { timestamps: true });

// ─── INDEXES ────────────────────────────────────────────────
userSchema.index({ email: 1 });
userSchema.index({ phone: 1 });
userSchema.index({ referralCode: 1 });
userSchema.index({ role: 1 });

// ─── HASH PASSWORD ──────────────────────────────────────────
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ─── COMPARE PASSWORD ───────────────────────────────────────
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// ─── COMPARE PIN ────────────────────────────────────────────
userSchema.methods.comparePin = async function(candidatePin) {
  return bcrypt.compare(candidatePin, this.transactionPin);
};

// ─── IS ACCOUNT LOCKED ──────────────────────────────────────
userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// ─── GENERATE REFERRAL CODE ─────────────────────────────────
userSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = this.fullName.split(' ')[0].toLowerCase() +
      Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
