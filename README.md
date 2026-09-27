# NairaFlow VTU Platform

A full-stack VTU (Virtual Top-Up) platform for Nigeria. Buy data, airtime, pay bills, and manage resellers.

## Tech Stack
- **Frontend:** HTML, CSS, Vanilla JS, EJS Templates
- **Backend:** Node.js + Express
- **Database:** MongoDB (Atlas)
- **Payments:** Korapay (virtual accounts + card)
- **VTU API:** VTpass
- **Email:** Resend
- **Hosting:** Render

## Features
- User dashboard — buy airtime, data, cable TV, electricity, exam pins
- Wallet system with Korapay virtual accounts (auto-funding)
- Transaction PIN security on every purchase
- Reseller system with tiered pricing (Bronze/Silver/Gold/API)
- Admin panel with live stats, refund management, pricing control
- Referral system with automatic bonus crediting
- Cashback & tier system
- Dynamic seasonal banners (Christmas, New Year, promos)
- PWA — installable as mobile app
- Email notifications via Resend
- Rate limiting, helmet security, session management

## Setup

### 1. Clone and install
```bash
git clone <your-repo>
cd nairaflow
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your actual keys
```

### 3. Get your API keys

**MongoDB Atlas** (free):
1. Go to mongodb.com/atlas
2. Create free cluster
3. Get connection string → paste as MONGODB_URI

**Korapay** (free to integrate):
1. Sign up at korapay.com
2. Dashboard → Settings → API Keys
3. Copy Public Key and Secret Key

**VTpass** (free sandbox):
1. Sign up at vtpass.com
2. Dashboard → API → Get keys
3. Use sandbox first, switch to live when ready

**Resend** (3000 free emails/month):
1. Sign up at resend.com
2. Add your domain or use test domain
3. Create API key

### 4. Run locally
```bash
npm run dev
```

### 5. Deploy to Render
1. Push code to GitHub
2. Go to render.com → New Web Service
3. Connect your GitHub repo
4. Add all environment variables from .env
5. Deploy!

## Project Structure
```
nairaflow/
├── server.js              # Entry point
├── routes/
│   ├── auth.js            # Login, register, forgot password
│   ├── user.js            # User dashboard & services
│   ├── reseller.js        # Reseller dashboard & services
│   ├── admin.js           # Admin panel
│   ├── webhook.js         # Korapay webhooks
│   └── landing.js         # Homepage
├── models/
│   ├── User.js            # User model (wallet, PIN, referral, etc.)
│   ├── Transaction.js     # Transaction model
│   └── Pricing.js         # Pricing, Promos, Settings models
├── utils/
│   ├── vtpass.js          # VTpass API
│   ├── korapay.js         # Korapay payment API
│   ├── email.js           # Resend email templates
│   └── transactionChecker.js  # Cron job for pending tx
├── middleware/
│   └── auth.js            # Auth middleware
├── views/
│   ├── auth/              # Login, register pages
│   ├── user/              # User dashboard pages
│   ├── reseller/          # Reseller dashboard pages
│   └── admin/             # Admin panel pages
└── public/
    └── sw.js              # PWA service worker
```

## Adding a Seasonal Banner (Admin)
1. Go to Admin Panel → Promos & Banners
2. Click "Create Banner"
3. Set type: christmas / newyear / promo / info
4. Set icon (Remix Icon class e.g. ri-gift-2-line)
5. Set start/end dates
6. Choose who sees it: all / user / reseller

## Reseller Tiers
| Tier   | Min Wallet | Discount |
|--------|-----------|----------|
| Bronze | ₦5,000    | 5% off   |
| Silver | ₦20,000   | 10% off  |
| Gold   | ₦50,000   | 15% off  |
| API    | ₦100,000  | 18% off  |

## Support
Built with ❤️ for the Nigerian market.
