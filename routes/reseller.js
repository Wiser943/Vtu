const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { Pricing, Promo } = require('../models/Pricing');
const { requireAuth, loadUser } = require('../middleware/auth');
const vtpass = require('../utils/vtpass');
const korapay = require('../utils/korapay');
const { sendTransactionEmail } = require('../utils/email');
const crypto = require('crypto');

// Require reseller or admin role
const requireReseller = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const user = await User.findById(req.session.userId);
  if (!user || (user.role !== 'reseller' && user.role !== 'admin')) {
    req.flash('error', 'Reseller access required');
    return res.redirect('/user/dashboard');
  }
  req.user = user;
  res.locals.user = user;
  next();
};

router.use(loadUser, requireReseller);

// ── DASHBOARD ──────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfDay = new Date(now.setHours(0,0,0,0));

  const [recentTx, monthlyStats, dailyStats, promos] = await Promise.all([
    Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(7),
    Transaction.aggregate([
      { $match: { userId: user._id, createdAt: { $gte: startOfMonth }, status: 'success', category: 'debit' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Transaction.aggregate([
      { $match: { userId: user._id, createdAt: { $gte: startOfDay }, status: 'success', category: 'debit' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
    ]),
    Promo.find({ isActive: true, endDate: { $gte: new Date() }, showTo: { $in: ['all', 'reseller'] } })
  ]);

  const tierPriceKey = {
    bronze: 'bronzePrice', silver: 'silverPrice',
    gold: 'goldPrice', api: 'apiPrice'
  }[user.resellerTier || 'bronze'];

  res.render('reseller/dashboard', {
    title: 'Reseller Dashboard', user, recentTx, promos,
    monthlyTotal: monthlyStats[0]?.total || 0,
    monthlyCount: monthlyStats[0]?.count || 0,
    dailyTotal: dailyStats[0]?.total || 0,
    dailyCount: dailyStats[0]?.count || 0,
    tierPriceKey, page: 'dashboard'
  });
});

// ── WALLET ─────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const txHistory = await Transaction.find({ userId: user._id, type: { $in: ['wallet_fund'] } })
    .sort({ createdAt: -1 }).limit(10);
  res.render('reseller/wallet', { title: 'Wallet', user, txHistory, page: 'wallet' });
});

router.post('/wallet/fund', async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.session.userId);
  try {
    const reference = `NF_RS_FUND_${uuidv4().replace(/-/g,'').substr(0,12).toUpperCase()}`;
    const result = await korapay.initializePayment({
      email: user.email, amount: parseFloat(amount), reference,
      callbackUrl: `${process.env.APP_URL}/reseller/wallet/verify?ref=${reference}`,
      metadata: { userId: user._id.toString(), type: 'wallet_fund' }
    });
    if (result.status) return res.json({ success: true, checkoutUrl: result.data.checkout_url });
    res.json({ success: false, message: 'Could not initialize payment' });
  } catch (err) { res.json({ success: false, message: 'Server error' }); }
});

// ── BUY AIRTIME (reseller rate) ─────────────────────
router.post('/airtime', async (req, res) => {
  const { network, phone, amount, pin } = req.body;
  const user = await User.findById(req.session.userId);
  try {
    if (!user.transactionPin) return res.json({ success: false, message: 'Set a transaction PIN first' });
    const pinValid = await user.comparePin(pin);
    if (!pinValid) return res.json({ success: false, message: 'Invalid transaction PIN' });
    const parsedAmount = parseFloat(amount);
    if (user.walletBalance < parsedAmount) return res.json({ success: false, message: 'Insufficient wallet balance' });

    const reference = `NF_RS_AIR_${uuidv4().replace(/-/g,'').substr(0,12).toUpperCase()}`;
    await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: -parsedAmount, totalSpent: parsedAmount } });

    const tx = await Transaction.create({
      userId: user._id, reference, type: 'airtime', category: 'debit',
      amount: parsedAmount, balanceBefore: user.walletBalance,
      balanceAfter: user.walletBalance - parsedAmount,
      serviceDetails: { network, phone }, ipAddress: req.ip,
      status: 'processing', isResellerTransaction: true
    });

    const vtRes = await vtpass.buyAirtime({ phone, amount: parsedAmount, network, requestId: reference });
    const parsed = vtpass.parseVTpassResponse(vtRes);

    if (parsed.success) {
      await Transaction.findByIdAndUpdate(tx._id, { status: 'success', processedAt: new Date() });
      return res.json({ success: true, message: `₦${parsedAmount} airtime sent to ${phone}`, reference });
    } else {
      await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: parsedAmount, totalSpent: -parsedAmount } });
      await Transaction.findByIdAndUpdate(tx._id, { status: 'failed', failureReason: parsed.message });
      return res.json({ success: false, message: parsed.message || 'Transaction failed, wallet refunded' });
    }
  } catch (err) { res.json({ success: false, message: 'Server error' }); }
});

// ── BUY DATA (reseller rate) ────────────────────────
router.post('/data', async (req, res) => {
  const { serviceId, variationCode, phone, pin, planName, amount } = req.body;
  const user = await User.findById(req.session.userId);
  try {
    if (!user.transactionPin) return res.json({ success: false, message: 'Set a transaction PIN first' });
    const pinValid = await user.comparePin(pin);
    if (!pinValid) return res.json({ success: false, message: 'Invalid transaction PIN' });
    const parsedAmount = parseFloat(amount);
    if (user.walletBalance < parsedAmount) return res.json({ success: false, message: 'Insufficient wallet balance' });

    const reference = `NF_RS_DAT_${uuidv4().replace(/-/g,'').substr(0,12).toUpperCase()}`;
    await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: -parsedAmount, totalSpent: parsedAmount } });

    const tx = await Transaction.create({
      userId: user._id, reference, type: 'data', category: 'debit',
      amount: parsedAmount, balanceBefore: user.walletBalance,
      balanceAfter: user.walletBalance - parsedAmount,
      serviceDetails: { phone, dataBundle: planName, network: serviceId },
      ipAddress: req.ip, status: 'processing', isResellerTransaction: true
    });

    const vtRes = await vtpass.buyData({ phone, serviceId, variationCode, requestId: reference });
    const parsed = vtpass.parseVTpassResponse(vtRes);

    if (parsed.success) {
      await Transaction.findByIdAndUpdate(tx._id, { status: 'success', processedAt: new Date() });
      return res.json({ success: true, message: `${planName} sent to ${phone}`, reference });
    } else {
      await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: parsedAmount, totalSpent: -parsedAmount } });
      await Transaction.findByIdAndUpdate(tx._id, { status: 'failed', failureReason: parsed.message });
      return res.json({ success: false, message: parsed.message || 'Transaction failed, wallet refunded' });
    }
  } catch (err) { res.json({ success: false, message: 'Server error' }); }
});

// ── TRANSACTIONS ────────────────────────────────────
router.get('/transactions', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const filter = { userId: user._id };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  const [transactions, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit),
    Transaction.countDocuments(filter)
  ]);

  res.render('reseller/transactions', {
    title: 'Transactions', user, transactions,
    page, totalPages: Math.ceil(total/limit), filter: req.query, totalCount: total
  });
});

// ── EARNINGS ───────────────────────────────────────
router.get('/earnings', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const now = new Date();
  const last30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

  const dailyEarnings = await Transaction.aggregate([
    { $match: { userId: user._id, status: 'success', category: 'debit', createdAt: { $gte: last30 } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);

  res.render('reseller/earnings', { title: 'Earnings', user, dailyEarnings, page: 'earnings' });
});

// ── API KEYS ───────────────────────────────────────
router.get('/api-keys', async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('reseller/api-keys', { title: 'API Keys', user, page: 'api' });
});

router.post('/api-keys/generate', async (req, res) => {
  const apiKey = 'nf_' + crypto.randomBytes(24).toString('hex');
  await User.findByIdAndUpdate(req.session.userId, { apiKey, apiEnabled: true });
  res.json({ success: true, apiKey });
});

router.post('/api-keys/revoke', async (req, res) => {
  await User.findByIdAndUpdate(req.session.userId, { apiKey: null, apiEnabled: false });
  res.json({ success: true, message: 'API key revoked' });
});

// ── PRICE LIST ─────────────────────────────────────
router.get('/price-list', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const plans = await Pricing.find({ isActive: true }).sort({ service: 1, sortOrder: 1 });
  const tierKey = { bronze: 'bronzePrice', silver: 'silverPrice', gold: 'goldPrice', api: 'apiPrice' }[user.resellerTier || 'bronze'];
  res.render('reseller/price-list', { title: 'My Price List', user, plans, tierKey, page: 'pricelist' });
});

// ── SETTINGS ───────────────────────────────────────
router.get('/settings', async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('reseller/settings', { title: 'Settings', user, page: 'settings' });
});

module.exports = router;
