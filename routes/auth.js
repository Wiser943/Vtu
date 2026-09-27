const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { redirectIfAuth, loadUser } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail, sendLoginAlertEmail } = require('../utils/email');
const { createVirtualAccount } = require('../utils/korapay');

router.use(loadUser);

// ─── REGISTER ───────────────────────────────────────────────
router.get('/register', redirectIfAuth, (req, res) => {
  res.render('auth/register', { title: 'Create Account', ref: req.query.ref || '' });
});

router.post('/register', [
  body('fullName').trim().isLength({ min: 2 }).withMessage('Full name required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').matches(/^0[789][01]\d{8}$/).withMessage('Valid Nigerian phone required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirmPassword').custom((v, { req }) => v === req.body.password).withMessage('Passwords do not match'),
  body('terms').equals('on').withMessage('Accept terms to continue')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('auth/register', {
      title: 'Create Account',
      errors: errors.array(),
      data: req.body,
      ref: req.body.ref || ''
    });
  }

  try {
    const { fullName, email, phone, password, ref } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      return res.render('auth/register', {
        title: 'Create Account',
        errors: [{ msg: existingUser.email === email ? 'Email already registered' : 'Phone already registered' }],
        data: req.body, ref
      });
    }

    // Create user
    const user = new User({ fullName, email, phone, password });

    // Handle referral
    if (ref) {
      const referrer = await User.findOne({ referralCode: ref });
      if (referrer) user.referredBy = referrer._id;
    }

    // Email verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    user.emailVerifyToken = verifyToken;
    user.emailVerifyExpires = Date.now() + 24 * 60 * 60 * 1000;

    await user.save();

    // Create Korapay virtual account
    try {
      const vaResult = await createVirtualAccount(user);
      if (vaResult.status) {
        await User.findByIdAndUpdate(user._id, {
          virtualAccount: {
            accountNumber: vaResult.data.account_number,
            bankName: vaResult.data.bank_name,
            accountName: vaResult.data.account_name,
            accountReference: vaResult.data.unique_id
          }
        });
      }
    } catch (e) { console.error('VA creation failed:', e.message); }

    // Send verification email
    const verifyLink = `${process.env.APP_URL}/auth/verify-email/${verifyToken}`;
    await sendVerificationEmail(user, verifyLink);

    req.flash('success', 'Account created! Check your email to verify.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error(err);
    res.render('auth/register', { title: 'Create Account', errors: [{ msg: 'Server error, try again' }], data: req.body, ref: '' });
  }
});

// ─── VERIFY EMAIL ───────────────────────────────────────────
router.get('/verify-email/:token', async (req, res) => {
  const user = await User.findOne({
    emailVerifyToken: req.params.token,
    emailVerifyExpires: { $gt: Date.now() }
  });
  if (!user) {
    req.flash('error', 'Invalid or expired verification link');
    return res.redirect('/auth/login');
  }
  await User.findByIdAndUpdate(user._id, {
    isEmailVerified: true,
    emailVerifyToken: null,
    emailVerifyExpires: null
  });
  req.flash('success', 'Email verified! You can now log in.');
  res.redirect('/auth/login');
});

// ─── LOGIN ──────────────────────────────────────────────────
router.get('/login', redirectIfAuth, (req, res) => {
  res.render('auth/login', { title: 'Login' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      if (user) await User.findByIdAndUpdate(user._id, { $inc: { loginAttempts: 1 } });
      return res.render('auth/login', { title: 'Login', error: 'Invalid email or password', email });
    }
    if (user.isSuspended) {
      return res.render('auth/login', { title: 'Login', error: `Account suspended: ${user.suspendReason}`, email });
    }
    if (!user.isEmailVerified) {
      return res.render('auth/login', { title: 'Login', error: 'Please verify your email first', email });
    }

    const ip = req.ip || req.connection.remoteAddress;
    const device = req.headers['user-agent']?.substring(0, 100) || 'Unknown';

    await User.findByIdAndUpdate(user._id, {
      loginAttempts: 0,
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      $push: { loginHistory: { $each: [{ ip, device, success: true }], $slice: -10 } }
    });

    req.session.userId = user._id;
    req.session.userRole = user.role;

    if (user.settings?.loginAlerts) {
      sendLoginAlertEmail(user, ip, device).catch(() => {});
    }

    const redirectMap = { admin: '/admin/dashboard', reseller: '/reseller/dashboard', user: '/user/dashboard' };
    res.redirect(redirectMap[user.role] || '/user/dashboard');
  } catch (err) {
    console.error(err);
    res.render('auth/login', { title: 'Login', error: 'Server error, try again', email });
  }
});

// ─── FORGOT PASSWORD ────────────────────────────────────────
router.get('/forgot-password', redirectIfAuth, (req, res) => {
  res.render('auth/forgot-password', { title: 'Reset Password' });
});

router.post('/forgot-password', async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (!user) return res.render('auth/forgot-password', { title: 'Reset Password', success: true });

  const token = crypto.randomBytes(32).toString('hex');
  await User.findByIdAndUpdate(user._id, {
    resetPasswordToken: token,
    resetPasswordExpires: Date.now() + 60 * 60 * 1000
  });

  const resetLink = `${process.env.APP_URL}/auth/reset-password/${token}`;
  await sendPasswordResetEmail(user, resetLink);
  res.render('auth/forgot-password', { title: 'Reset Password', success: true });
});

// ─── RESET PASSWORD ─────────────────────────────────────────
router.get('/reset-password/:token', async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) {
    req.flash('error', 'Invalid or expired reset link');
    return res.redirect('/auth/forgot-password');
  }
  res.render('auth/reset-password', { title: 'New Password', token: req.params.token });
});

router.post('/reset-password/:token', async (req, res) => {
  const user = await User.findOne({
    resetPasswordToken: req.params.token,
    resetPasswordExpires: { $gt: Date.now() }
  });
  if (!user) return res.redirect('/auth/forgot-password');

  user.password = req.body.password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  await user.save();

  req.flash('success', 'Password reset successful. Please log in.');
  res.redirect('/auth/login');
});

// ─── LOGOUT ─────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
