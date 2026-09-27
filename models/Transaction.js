const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // ─── IDENTITY ───────────────────────────────────────────
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reference: { type: String, required: true, unique: true },
  externalReference: String, // VTpass or Korapay ref

  // ─── TYPE ───────────────────────────────────────────────
  type: {
    type: String,
    enum: ['airtime', 'data', 'cable', 'electricity', 'exam', 'wallet_fund',
           'wallet_transfer', 'referral_bonus', 'cashback', 'subscription', 'refund'],
    required: true
  },
  category: { type: String, enum: ['debit', 'credit'], required: true },

  // ─── AMOUNTS ────────────────────────────────────────────
  amount: { type: Number, required: true },
  costPrice: Number,       // what we paid VTpass
  sellingPrice: Number,    // what user paid
  profit: Number,          // our margin
  cashbackAwarded: { type: Number, default: 0 },

  // ─── SERVICE DETAILS ────────────────────────────────────
  serviceDetails: {
    network: String,          // MTN, Airtel, Glo, 9mobile
    phone: String,
    dataBundle: String,
    smartCardNumber: String,
    meterNumber: String,
    disco: String,            // electricity distributor
    cablePlan: String,
    examType: String,         // WAEC, JAMB, NECO
    quantity: Number,
    token: String,            // electricity token
    pin: String,              // exam card pin
    serial: String
  },

  // ─── STATUS ─────────────────────────────────────────────
  status: { type: String, enum: ['pending', 'success', 'failed', 'refunded', 'processing'], default: 'pending' },
  statusMessage: String,
  failureReason: String,

  // ─── BALANCE SNAPSHOT ───────────────────────────────────
  balanceBefore: Number,
  balanceAfter: Number,

  // ─── RESELLER INFO ──────────────────────────────────────
  isResellerTransaction: { type: Boolean, default: false },
  resellerUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  resellerProfit: Number,

  // ─── REFUND ─────────────────────────────────────────────
  refundedAt: Date,
  refundReference: String,
  refundedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // ─── META ───────────────────────────────────────────────
  ipAddress: String,
  userAgent: String,
  processedAt: Date,
  retryCount: { type: Number, default: 0 }

}, { timestamps: true });

transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ reference: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
