require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const methodOverride = require('method-override');
const path = require('path');
const cron = require('node-cron');

const app = express();

// ─── DATABASE ──────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ─── SECURITY MIDDLEWARE ────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "js.korapay.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "fonts.gstatic.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "api.korapay.com"],
    }
  }
}));

// ─── RATE LIMITING ──────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.'
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts, please try again later.'
});
app.use('/api/', generalLimiter);
app.use('/auth/', authLimiter);

// ─── GENERAL MIDDLEWARE ─────────────────────────────────────
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

// ─── SESSION ────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));
app.use(flash());

// ─── VIEW ENGINE ────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── GLOBAL TEMPLATE VARS ───────────────────────────────────
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.appName = process.env.APP_NAME || 'NairaFlow';
  res.locals.appUrl = process.env.APP_URL || 'http://localhost:3000';
  next();
});

// ─── ROUTES ─────────────────────────────────────────────────
app.use('/', require('./routes/landing'));
app.use('/auth', require('./routes/auth'));
app.use('/user', require('./routes/user'));
app.use('/reseller', require('./routes/reseller'));
app.use('/admin', require('./routes/admin'));
app.use('/api/webhook', require('./routes/webhook'));
//app.use('/api', require('./routes/api'));

// ─── PWA MANIFEST ───────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.json({
    name: 'NairaFlow VTU',
    short_name: 'NairaFlow',
    description: 'Buy Data, Airtime & Pay Bills Instantly',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0d14',
    theme_color: '#6366f1',
    orientation: 'portrait',
    icons: [
      { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png' }
    ]
  });
});

// ─── 404 ────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found' });
});

// ─── ERROR HANDLER ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('500', { title: 'Server Error', error: process.env.NODE_ENV === 'development' ? err : {} });
});

// ─── CRON JOBS ──────────────────────────────────────────────
// Check pending transactions every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  const { checkPendingTransactions } = require('./utils/transactionChecker');
  await checkPendingTransactions();
});

// Daily stats update at midnight
cron.schedule('0 0 * * *', async () => {
  const { updateDailyStats } = require('./utils/statsUpdater');
  await updateDailyStats();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 NairaFlow running on port ${PORT}`));

module.exports = app;
