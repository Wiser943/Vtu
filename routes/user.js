const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { Pricing, Promo } = require('../models/Pricing');
const { requireAuth, loadUser } = require('../middleware/auth');
const vtpass = require('../utils/vtpass');
const korapay = require('../utils/korapay');
const { sendTransactionEmail, sendWalletFundedEmail } = require('../utils/email');

router.use(loadUser, requireAuth);

// ─── DASHBOARD ──────────────────────────────────────────────
router.get('/dashboard', async (req, res) => {
  const [user, recentTx, promos] = await Promise.all([
    User.findById(req.session.userId),
    Transaction.find({ userId: req.session.userId }).sort({ createdAt: -1 }).limit(5),
    Promo.find({ isActive: true, endDate: { $gte: new Date() }, showTo: { $in: ['all', 'user'] } })
  ]);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlyStats = await Transaction.aggregate([
    { $match: { userId: user._id, createdAt: { $gte: startOfMonth }, status: 'success', category: 'debit' } },
    { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } }
  ]);

  res.render('user/dashboard', {
    title: 'Dashboard',
    user, recentTx, promos, monthlyStats,
    page: 'dashboard'
  });
});

// ─── BUY AIRTIME ────────────────────────────────────────────
router.get('/airtime', async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('user/airtime', { title: 'Buy Airtime', user, page: 'airtime' });
});

router.post('/airtime', async (req, res) => {
  const { network, phone, amount, pin } = req.body;
  const user = await User.findById(req.session.userId);

  try {
    // Validate PIN
    if (!user.transactionPin) return res.json({ success: false, message: 'Set a transaction PIN first' });
    const pinValid = await user.comparePin(pin);
    if (!pinValid) return res.json({ success: false, message: 'Invalid transaction PIN' });

    const parsedAmount = parseFloat(amount);
    if (user.walletBalance < parsedAmount) return res.json({ success: false, message: 'Insufficient wallet balance' });

    const reference = `NF_AIR_${uuidv4().replace(/-/g,'').substr(0,16).toUpperCase()}`;

    // Debit wallet
    await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: -parsedAmount, totalSpent: parsedAmount } });

    const tx = await Transaction.create({
      userId: user._id, reference, type: 'airtime', category: 'debit',
      amount: parsedAmount, balanceBefore: user.walletBalance,
      balanceAfter: user.walletBalance - parsedAmount,
      serviceDetails: { network, phone },
      ipAddress: req.ip, status: 'processing'
    });

    // Call VTpass
    const vtRes = await vtpass.buyAirtime({ phone, amount: parsedAmount, network, requestId: reference });
    const parsed = vtpass.parseVTpassResponse(vtRes);

    if (parsed.success) {
      await Transaction.findByIdAndUpdate(tx._id, { status: 'success', processedAt: new Date(), statusMessage: parsed.message });
      // Award cashback
      const cashback = Math.floor(parsedAmount * (user.cashbackPercent / 100));
      if (cashback > 0) {
        await User.findByIdAndUpdate(user._id, { $inc: { cashbackBalance: cashback } });
        await Transaction.findByIdAndUpdate(tx._id, { cashbackAwarded: cashback });
      }
      const updatedTx = await Transaction.findById(tx._id);
      sendTransactionEmail(user, updatedTx).catch(() => {});
      return res.json({ success: true, message: `₦${parsedAmount} airtime sent to ${phone}`, reference });
    } else {
      // Refund wallet
      await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: parsedAmount, totalSpent: -parsedAmount } });
      await Transaction.findByIdAndUpdate(tx._id, { status: 'failed', failureReason: parsed.message });
      return res.json({ success: false, message: parsed.message || 'Transaction failed, wallet refunded' });
    }
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Server error, please try again' });
  }
});

// ─── BUY DATA ───────────────────────────────────────────────
router.get('/data', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const plans = await Pricing.find({ service: 'data', isActive: true }).sort({ sortOrder: 1 });
  res.render('user/data', { title: 'Buy Data', user, plans, page: 'data' });
});

router.post('/data', async (req, res) => {
  const { serviceId, variationCode, phone, pin, planName, amount } = req.body;
  const user = await User.findById(req.session.userId);

  try {
    if (!user.transactionPin) return res.json({ success: false, message: 'Set a transaction PIN first' });
    const pinValid = await user.comparePin(pin);
    if (!pinValid) return res.json({ success: false, message: 'Invalid transaction PIN' });

    const parsedAmount = parseFloat(amount);
    if (user.walletBalance < parsedAmount) return res.json({ success: false, message: 'Insufficient wallet balance' });

    const reference = `NF_DAT_${uuidv4().replace(/-/g,'').substr(0,16).toUpperCase()}`;

    await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: -parsedAmount, totalSpent: parsedAmount } });

    const tx = await Transaction.create({
      userId: user._id, reference, type: 'data', category: 'debit',
      amount: parsedAmount, balanceBefore: user.walletBalance,
      balanceAfter: user.walletBalance - parsedAmount,
      serviceDetails: { phone, dataBundle: planName, network: serviceId },
      ipAddress: req.ip, status: 'processing'
    });

    const vtRes = await vtpass.buyData({ phone, serviceId, variationCode, requestId: reference });
    const parsed = vtpass.parseVTpassResponse(vtRes);

    if (parsed.success) {
      await Transaction.findByIdAndUpdate(tx._id, { status: 'success', processedAt: new Date() });
      const cashback = Math.floor(parsedAmount * (user.cashbackPercent / 100));
      if (cashback > 0) await User.findByIdAndUpdate(user._id, { $inc: { cashbackBalance: cashback } });
      return res.json({ success: true, message: `${planName} sent to ${phone}`, reference });
    } else {
      await User.findByIdAndUpdate(user._id, { $inc: { walletBalance: parsedAmount, totalSpent: -parsedAmount } });
      await Transaction.findByIdAndUpdate(tx._id, { status: 'failed', failureReason: parsed.message });
      return res.json({ success: false, message: parsed.message || 'Transaction failed, wallet refunded' });
    }
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Server error, please try again' });
  }
});

// ─── WALLET ─────────────────────────────────────────────────
router.get('/wallet', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const txHistory = await Transaction.find({ userId: user._id, type: { $in: ['wallet_fund', 'cashback'] } })
    .sort({ createdAt: -1 }).limit(10);
  res.render('user/wallet', { title: 'Wallet', user, txHistory, page: 'wallet' });
});

// ─── FUND WALLET (Korapay checkout) ─────────────────────────
router.post('/wallet/fund', async (req, res) => {
  const { amount } = req.body;
  const user = await User.findById(req.session.userId);
  try {
    const reference = `NF_FUND_${uuidv4().replace(/-/g,'').substr(0,16).toUpperCase()}`;
    const result = await korapay.initializePayment({
      email: user.email,
      amount: parseFloat(amount),
      reference,
      callbackUrl: `${process.env.APP_URL}/user/wallet/verify?ref=${reference}`,
      metadata: { userId: user._id.toString(), type: 'wallet_fund' }
    });
    if (result.status) {
      return res.json({ success: true, checkoutUrl: result.data.checkout_url, reference });
    }
    res.json({ success: false, message: 'Could not initialize payment' });
  } catch (err) {
    res.json({ success: false, message: 'Server error' });
  }
});

// ─── TRANSACTIONS ───────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.status) filter.status = req.query.status;

  const [transactions, total] = await Promise.all([
    Transaction.find({ userId: user._id, ...filter }).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit),
    Transaction.countDocuments({ userId: user._id, ...filter })
  ]);

  res.render('user/transactions', {
    title: 'Transactions', user, transactions,
    page, totalPages: Math.ceil(total/limit),
    filter: req.query, totalCount: total
  });
});

// ─── SET TRANSACTION PIN ────────────────────────────────────
router.post('/set-pin', async (req, res) => {
  const { pin, confirmPin, currentPassword } = req.body;
  const user = await User.findById(req.session.userId);
  if (pin !== confirmPin) return res.json({ success: false, message: 'PINs do not match' });
  if (!/^\d{4,6}$/.test(pin)) return res.json({ success: false, message: 'PIN must be 4-6 digits' });
  const pwValid = await user.comparePassword(currentPassword);
  if (!pwValid) return res.json({ success: false, message: 'Incorrect password' });
  const hashed = await bcrypt.hash(pin, 12);
  await User.findByIdAndUpdate(user._id, { transactionPin: hashed, pinSetAt: new Date() });
  res.json({ success: true, message: 'Transaction PIN set successfully' });
});

// ─── REFERRALS ──────────────────────────────────────────────
router.get('/referrals', async (req, res) => {
  const user = await User.findById(req.session.userId);
  const referrals = await User.find({ referredBy: user._id }).select('fullName createdAt totalSpent').sort({ createdAt: -1 });
  res.render('user/referrals', { title: 'Referrals', user, referrals, page: 'referrals' });
});

// ─── FAVOURITES ─────────────────────────────────────────────
router.post('/favourites/add', async (req, res) => {
  const { name, phone, network, serviceType } = req.body;
  await User.findByIdAndUpdate(req.session.userId, {
    $push: { favourites: { name, phone, network, serviceType } }
  });
  res.json({ success: true, message: 'Added to favourites' });
});

router.delete('/favourites/:id', async (req, res) => {
  await User.findByIdAndUpdate(req.session.userId, {
    $pull: { favourites: { _id: req.params.id } }
  });
  res.json({ success: true });
});

// ─── NOTIFICATIONS ──────────────────────────────────────────
router.post('/notifications/mark-read', async (req, res) => {
  await User.updateMany(
    { _id: req.session.userId },
    { $set: { 'notifications.$[].isRead': true } }
  );
  res.json({ success: true });
});

// ─── SETTINGS ───────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  const user = await User.findById(req.session.userId);
  res.render('user/settings', { title: 'Settings', user, page: 'settings' });
});

router.post('/settings/profile', async (req, res) => {
  const { fullName, phone } = req.body;
  await User.findByIdAndUpdate(req.session.userId, { fullName, phone });
  req.flash('success', 'Profile updated');
  res.redirect('/user/settings');
});

router.post('/settings/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.session.userId);
  const valid = await user.comparePassword(currentPassword);
  if (!valid) { req.flash('error', 'Current password incorrect'); return res.redirect('/user/settings'); }
  user.password = newPassword;
  await user.save();
  req.flash('success', 'Password changed successfully');
  res.redirect('/user/settings');
});

module.exports = router;
