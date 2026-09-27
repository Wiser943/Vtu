const mongoose = require('mongoose');

// ─── PRICING TABLE ──────────────────────────────────────────
const pricingSchema = new mongoose.Schema({
  service: { type: String, enum: ['airtime', 'data', 'cable', 'electricity', 'exam'], required: true },
  network: String,        // MTN, Airtel, Glo, 9mobile
  bundleName: String,     // "5GB Monthly", "1GB Daily"
  bundleCode: String,     // vtpass product code
  validity: String,       // "30 days", "1 day"
  dataSize: String,       // "5GB"

  costPrice: Number,      // from VTpass
  // Prices per tier
  retailPrice: Number,    // regular users
  bronzePrice: Number,    // bronze reseller
  silverPrice: Number,    // silver reseller
  goldPrice: Number,      // gold reseller
  apiPrice: Number,       // API resellers

  isActive: { type: Boolean, default: true },
  isFeatured: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });

// ─── SUBSCRIPTION PLANS ─────────────────────────────────────
const subscriptionSchema = new mongoose.Schema({
  name: { type: String, enum: ['silver', 'gold', 'platinum'], required: true },
  price: Number,
  duration: Number,       // days
  discountPercent: Number,
  features: [String],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// ─── SITE SETTINGS ──────────────────────────────────────────
const settingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: mongoose.Schema.Types.Mixed,
  description: String
}, { timestamps: true });

// ─── PROMO / BANNER ─────────────────────────────────────────
const promoSchema = new mongoose.Schema({
  title: String,
  message: String,
  type: { type: String, enum: ['info', 'success', 'warning', 'christmas', 'newyear', 'promo'] },
  startDate: Date,
  endDate: Date,
  isActive: { type: Boolean, default: true },
  showTo: { type: String, enum: ['all', 'user', 'reseller'], default: 'all' },
  ctaText: String,
  ctaLink: String,
  bgColor: String,
  icon: String
}, { timestamps: true });

const Pricing = mongoose.model('Pricing', pricingSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);
const Settings = mongoose.model('Settings', settingsSchema);
const Promo = mongoose.model('Promo', promoSchema);

module.exports = { Pricing, Subscription, Settings, Promo };
