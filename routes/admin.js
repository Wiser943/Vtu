const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { Pricing, Promo, Settings } = require('../models/Pricing');
const { requireAdmin, loadUser } = require('../middleware/auth');
const { sendTransactionEmail } = require('../utils/email');

router.use(loadUser, requireAdmin);

// ── DASHBOARD ──────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const yesterday = new Date(startOfDay - 24 * 60 * 60 * 1000);

  const [
    todayStats, yesterdayStats, monthStats,
    totalUsers, newTodayUsers,
    pendingTx, recentTx, topUsers,
    networkBreakdown, dailyRevenue
  ] = await Promise.all([
    Transaction.aggregate([{ $match: { createdAt: { $gte: startOfDay }, status: 'success', category: 'debit' } }, { $group: { _id: null, revenue: { $sum: '$amount' }, count: { $sum: 1 }, profit: { $sum: '$profit' } } }]),
    Transaction.aggregate([{ $match: { createdAt: { $gte: yesterday, $lt: startOfDay }, status: 'success', category: 'debit' } }, { $group: { _id: null, revenue: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { createdAt: { $gte: startOfMonth }, status: 'success', category: 'debit' } }, { $group: { _id: null, revenue: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: startOfDay } }),
    Transaction.countDocuments({ status: { $in: ['pending', 'processing'] } }),
    Transaction.find().sort({ createdAt: -1 }).limit(8).populate('userId', 'fullName email'),
    Transaction.aggregate([{ $match: { createdAt: { $gte: startOfDay }, status: 'success', category: 'debit' } }, { $group: { _id: '$userId', total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 5 }, { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } }]),
    Transaction.aggregate([{ $match: { status: 'success', category: 'debit', createdAt: { $gte: startOfMonth } } }, { $group: { _id: '$serviceDetails.network', total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { status: 'success', category: 'debit', createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } } }, { $group: { _id: { $dateToString: { format: '%a', date: '$createdAt' } }, total: { $sum: '$amount' } } }, { $sort: { _id: 1 } }])
  ]);

  res.render('admin/dashboard', {
    title: 'Admin Dashboard', page: 'dashboard',
    todayRevenue: todayStats[0]?.revenue || 0,
    todayCount: todayStats[0]?.count || 0,
    yesterdayRevenue: yesterdayStats[0]?.revenue || 0,
    monthRevenue: monthStats[0]?.revenue || 0,
    totalUsers, newTodayUsers, pendingTx,
    recentTx, topUsers, networkBreakdown, dailyRevenue
  });
});

// ── USERS ──────────────────────────────────────────
router.get('/users', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const search = req.query.search || '';
  const role = req.query.role || '';
  const filter = {};
  if (search) filter.$or = [{ fullName: new RegExp(search, 'i') }, { email: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];
  if (role) filter.role = role;

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit),
    User.countDocuments(filter)
  ]);

  res.render('admin/users', { title: 'Users', page: 'users', users, total, currentPage: page, totalPages: Math.ceil(total/limit), search, role });
});

router.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.redirect('/admin/users');
  const txCount = await Transaction.countDocuments({ userId: user._id });
  const recentTx = await Transaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10);
  res.render('admin/user-detail', { title: 'User Detail', page: 'users', profileUser: user, txCount, recentTx });
});

// Fund user wallet
router.post('/users/:id/fund', async (req, res) => {
  const { amount, note } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) return res.json({ success: false, message: 'User not found' });

  const parsedAmount = parseFloat(amount);
  const balanceBefore = user.walletBalance;
  await User.findByIdAndUpdate(req.params.id, { $inc: { walletBalance: parsedAmount } });

  await Transaction.create({
    userId: user._id, reference: `NF_ADMIN_${Date.now()}`,
    type: 'wallet_fund', category: 'credit', amount: parsedAmount,
    balanceBefore, balanceAfter: balanceBefore + parsedAmount,
    status: 'success', statusMessage: note || 'Admin credit',
    processedAt: new Date()
  });

  // Notify user
  await User.findByIdAndUpdate(req.params.id, {
    $push: { notifications: { type: 'credit', title: 'Wallet Credited', message: `Your wallet was credited with ₦${parsedAmount.toLocaleString()} by admin. ${note || ''}`, isRead: false } }
  });

  res.json({ success: true, message: `Wallet credited with ₦${parsedAmount.toLocaleString()}` });
});

// Suspend / unsuspend user
router.post('/users/:id/suspend', async (req, res) => {
  const { reason } = req.body;
  const user = await User.findById(req.params.id);
  await User.findByIdAndUpdate(req.params.id, {
    isSuspended: !user.isSuspended,
    suspendReason: !user.isSuspended ? reason : ''
  });
  res.json({ success: true, message: user.isSuspended ? 'User unsuspended' : 'User suspended' });
});

// Upgrade to reseller
router.post('/users/:id/make-reseller', async (req, res) => {
  const { tier } = req.body;
  await User.findByIdAndUpdate(req.params.id, { role: 'reseller', resellerTier: tier || 'bronze' });
  res.json({ success: true, message: 'User upgraded to reseller' });
});

// ── TRANSACTIONS ───────────────────────────────────
router.get('/transactions', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  const [transactions, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).populate('userId', 'fullName email phone'),
    Transaction.countDocuments(filter)
  ]);

  res.render('admin/transactions', { title: 'Transactions', page: 'transactions', transactions, total, currentPage: page, totalPages: Math.ceil(total/limit), filter: req.query });
});

// Manual refund
router.post('/transactions/:id/refund', async (req, res) => {
  const tx = await Transaction.findById(req.params.id).populate('userId');
  if (!tx || tx.status === 'refunded') return res.json({ success: false, message: 'Cannot refund' });

  await User.findByIdAndUpdate(tx.userId._id, { $inc: { walletBalance: tx.amount } });
  await Transaction.findByIdAndUpdate(req.params.id, { status: 'refunded', refundedAt: new Date(), refundedBy: req.user._id });
  res.json({ success: true, message: `₦${tx.amount.toLocaleString()} refunded to ${tx.userId.fullName}` });
});

// ── PRICING ────────────────────────────────────────
router.get('/pricing', async (req, res) => {
  const plans = await Pricing.find().sort({ service: 1, sortOrder: 1 });
  res.render('admin/pricing', { title: 'Pricing', page: 'pricing', plans });
});

router.post('/pricing', async (req, res) => {
  await Pricing.create(req.body);
  req.flash('success', 'Plan added');
  res.redirect('/admin/pricing');
});

router.put('/pricing/:id', async (req, res) => {
  await Pricing.findByIdAndUpdate(req.params.id, req.body);
  res.json({ success: true });
});

router.delete('/pricing/:id', async (req, res) => {
  await Pricing.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── PROMOS & BANNERS ───────────────────────────────
router.get('/promos', async (req, res) => {
  const promos = await Promo.find().sort({ createdAt: -1 });
  res.render('admin/promos', { title: 'Promos & Banners', page: 'promos', promos });
});

router.post('/promos', async (req, res) => {
  await Promo.create({ ...req.body, startDate: new Date(req.body.startDate), endDate: new Date(req.body.endDate) });
  req.flash('success', 'Banner created');
  res.redirect('/admin/promos');
});

router.delete('/promos/:id', async (req, res) => {
  await Promo.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ── RESELLERS ──────────────────────────────────────
router.get('/resellers', async (req, res) => {
  const resellers = await User.find({ role: 'reseller' }).sort({ totalSpent: -1 });
  res.render('admin/resellers', { title: 'Resellers', page: 'resellers', resellers });
});

// ── SECURITY LOGS ──────────────────────────────────
router.get('/security-logs', async (req, res) => {
  const suspiciousLogins = await User.find({ loginAttempts: { $gt: 3 } }).sort({ loginAttempts: -1 }).limit(20);
  const recentLogins = await User.find({ lastLoginAt: { $exists: true } }).sort({ lastLoginAt: -1 }).limit(20);
  res.render('admin/security-logs', { title: 'Security Logs', page: 'security', suspiciousLogins, recentLogins });
});

// ── SETTINGS ───────────────────────────────────────
router.get('/settings', async (req, res) => {
  res.render('admin/settings', { title: 'Settings', page: 'settings' });
});

// ── PENDING TRANSACTIONS ────────────────────────────
router.get('/pending', async (req, res) => {
  const pending = await Transaction.find({ status: { $in: ['pending', 'processing'] } })
    .sort({ createdAt: -1 }).populate('userId', 'fullName email phone');
  res.render('admin/pending', { title: 'Pending Transactions', page: 'pending', pending });
});

// Manually retry a pending transaction
router.post('/pending/:id/retry', async (req, res) => {
  const tx = await Transaction.findById(req.params.id);
  if (!tx) return res.json({ success: false, message: 'Transaction not found' });
  const vtpass = require('../utils/vtpass');

  try {
    let vtRes;
    if (tx.type === 'airtime') {
      vtRes = await vtpass.buyAirtime({ phone: tx.serviceDetails.phone, amount: tx.amount, network: tx.serviceDetails.network, requestId: tx.reference + '_R' + tx.retryCount });
    } else if (tx.type === 'data') {
      vtRes = await vtpass.buyData({ phone: tx.serviceDetails.phone, serviceId: tx.serviceDetails.network, variationCode: tx.serviceDetails.dataBundle, requestId: tx.reference + '_R' + tx.retryCount });
    }
    const parsed = vtpass.parseVTpassResponse(vtRes);
    await Transaction.findByIdAndUpdate(tx._id, { status: parsed.success ? 'success' : 'failed', retryCount: tx.retryCount + 1, processedAt: new Date() });
    res.json({ success: parsed.success, message: parsed.message });
  } catch (err) { res.json({ success: false, message: 'Retry failed: ' + err.message }); }
});

module.exports = router;
