const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─── REQUIRE LOGIN (SESSION) ────────────────────────────────
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    req.flash('error', 'Please log in to continue');
    return res.redirect('/auth/login');
  }
  next();
};

// ─── REQUIRE ADMIN ──────────────────────────────────────────
const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const user = await User.findById(req.session.userId);
  if (!user || user.role !== 'admin') {
    req.flash('error', 'Access denied');
    return res.redirect('/user/dashboard');
  }
  req.user = user;
  next();
};

// ─── REQUIRE RESELLER ───────────────────────────────────────
const requireReseller = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const user = await User.findById(req.session.userId);
  if (!user || (user.role !== 'reseller' && user.role !== 'admin')) {
    req.flash('error', 'Reseller access required');
    return res.redirect('/user/dashboard');
  }
  req.user = user;
  next();
};

// ─── LOAD USER MIDDLEWARE ────────────────────────────────────
const loadUser = async (req, res, next) => {
  if (req.session.userId) {
    try {
      const user = await User.findById(req.session.userId).lean();
      req.user = user;
      res.locals.user = user;
      res.locals.unreadNotifications = user?.notifications?.filter(n => !n.isRead).length || 0;
    } catch (e) { /* ignore */ }
  }
  next();
};

// ─── API KEY AUTH (for reseller API) ────────────────────────
const requireApiKey = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ success: false, message: 'API key required' });

  const user = await User.findOne({ apiKey, apiEnabled: true, isActive: true });
  if (!user) return res.status(401).json({ success: false, message: 'Invalid or disabled API key' });
  if (user.apiCallsToday >= user.apiCallsLimit) {
    return res.status(429).json({ success: false, message: 'Daily API call limit reached' });
  }

  req.apiUser = user;
  await User.findByIdAndUpdate(user._id, { $inc: { apiCallsToday: 1 } });
  next();
};

// ─── REDIRECT IF LOGGED IN ──────────────────────────────────
const redirectIfAuth = (req, res, next) => {
  if (req.session.userId) {
    return res.redirect('/user/dashboard');
  }
  next();
};

module.exports = { requireAuth, requireAdmin, requireReseller, loadUser, requireApiKey, redirectIfAuth };
