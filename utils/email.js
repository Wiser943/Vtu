const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = `${process.env.EMAIL_FROM_NAME || 'NairaFlow'} <${process.env.EMAIL_FROM || 'no-reply@nairaflow.com'}>`;

// ─── BASE EMAIL TEMPLATE ────────────────────────────────────
const baseTemplate = (content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #f0f4ff; margin: 0; padding: 20px; }
    .container { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .header { background: linear-gradient(135deg, #6366f1, #4f46e5); padding: 32px 32px 24px; text-align: center; }
    .logo { color: #fff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .logo span { color: #a5b4fc; }
    .body { padding: 32px; color: #1e293b; line-height: 1.6; }
    .title { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    .text { color: #475569; font-size: 15px; margin-bottom: 16px; }
    .btn { display: inline-block; background: #6366f1; color: #fff !important; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; margin: 8px 0; }
    .amount-box { background: #f0f4ff; border: 2px solid #6366f1; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
    .amount { font-size: 36px; font-weight: 800; color: #6366f1; }
    .amount-label { color: #6366f1; font-size: 13px; font-weight: 600; margin-top: 4px; }
    .info-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .info-label { color: #94a3b8; }
    .info-value { font-weight: 600; color: #1e293b; }
    .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px; border-radius: 0 8px 8px 0; margin: 16px 0; font-size: 14px; color: #92400e; }
    .success-badge { background: #dcfce7; color: #16a34a; display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; }
    .footer { background: #f8fafc; padding: 20px 32px; text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; }
    .social-links { margin: 12px 0; }
    .social-links a { color: #6366f1; text-decoration: none; margin: 0 8px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Naira<span>Flow</span></div>
      <div style="color:#c7d2fe;font-size:12px;margin-top:4px;letter-spacing:2px">VTU PLATFORM</div>
    </div>
    <div class="body">${content}</div>
    <div class="footer">
      <div class="social-links">
        <a href="#">Twitter</a> · <a href="#">Instagram</a> · <a href="#">WhatsApp</a>
      </div>
      <p>© ${new Date().getFullYear()} NairaFlow. All rights reserved.</p>
      <p>You received this email because you have an account on NairaFlow.</p>
    </div>
  </div>
</body>
</html>
`;

// ─── WELCOME + VERIFY EMAIL ──────────────────────────────────
const sendVerificationEmail = async (user, verifyLink) => {
  await resend.emails.send({
    from: FROM, to: user.email,
    subject: '✅ Verify your NairaFlow account',
    html: baseTemplate(`
      <div class="title">Welcome to NairaFlow, ${user.fullName.split(' ')[0]}!</div>
      <p class="text">You're one step away from buying data, airtime and paying bills at the best rates. Please verify your email address to activate your account.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${verifyLink}" class="btn">Verify My Email</a>
      </div>
      <p class="text" style="font-size:13px">This link expires in 24 hours. If you didn't create this account, ignore this email.</p>
    `)
  });
};

// ─── TRANSACTION SUCCESS ────────────────────────────────────
const sendTransactionEmail = async (user, transaction) => {
  const typeLabels = {
    airtime: 'Airtime Purchase', data: 'Data Purchase',
    cable: 'Cable TV Subscription', electricity: 'Electricity Token',
    exam: 'Exam PIN Purchase', wallet_fund: 'Wallet Funded'
  };

  await resend.emails.send({
    from: FROM, to: user.email,
    subject: `Transaction ${transaction.status === 'success' ? 'Successful' : 'Failed'} - ₦${transaction.amount.toLocaleString()}`,
    html: baseTemplate(`
      <div class="title">${transaction.status === 'success' ? 'Transaction Successful!' : 'Transaction Failed'}</div>
      <span class="success-badge">${transaction.status.toUpperCase()}</span>
      <div class="amount-box">
        <div class="amount">₦${transaction.amount.toLocaleString()}</div>
        <div class="amount-label">${typeLabels[transaction.type] || transaction.type}</div>
      </div>
      <div class="info-row"><span class="info-label">Reference</span><span class="info-value">${transaction.reference}</span></div>
      <div class="info-row"><span class="info-label">Date</span><span class="info-value">${new Date(transaction.createdAt).toLocaleString()}</span></div>
      <div class="info-row"><span class="info-label">Wallet Balance</span><span class="info-value">₦${transaction.balanceAfter?.toLocaleString()}</span></div>
      ${transaction.serviceDetails?.token ? `<div class="info-row"><span class="info-label">Token</span><span class="info-value" style="color:#6366f1;font-weight:800">${transaction.serviceDetails.token}</span></div>` : ''}
      ${transaction.cashbackAwarded > 0 ? `<div class="alert">🎉 You earned ₦${transaction.cashbackAwarded} cashback on this transaction!</div>` : ''}
      <p class="text" style="font-size:13px;margin-top:20px">If you did not initiate this transaction, contact support immediately.</p>
    `)
  });
};

// ─── WALLET FUNDED ──────────────────────────────────────────
const sendWalletFundedEmail = async (user, amount, newBalance) => {
  await resend.emails.send({
    from: FROM, to: user.email,
    subject: `💰 Wallet Credited - ₦${amount.toLocaleString()}`,
    html: baseTemplate(`
      <div class="title">Wallet Funded Successfully!</div>
      <div class="amount-box">
        <div class="amount">+₦${amount.toLocaleString()}</div>
        <div class="amount-label">CREDITED TO YOUR WALLET</div>
      </div>
      <div class="info-row"><span class="info-label">New Balance</span><span class="info-value">₦${newBalance.toLocaleString()}</span></div>
      <div class="info-row"><span class="info-label">Time</span><span class="info-value">${new Date().toLocaleString()}</span></div>
      <p class="text">Your wallet has been credited. You can now purchase data, airtime and pay bills.</p>
      <div style="text-align:center"><a href="${process.env.APP_URL}/user/dashboard" class="btn">Go to Dashboard</a></div>
    `)
  });
};

// ─── PASSWORD RESET ─────────────────────────────────────────
const sendPasswordResetEmail = async (user, resetLink) => {
  await resend.emails.send({
    from: FROM, to: user.email,
    subject: '🔐 Reset your NairaFlow password',
    html: baseTemplate(`
      <div class="title">Password Reset Request</div>
      <p class="text">We received a request to reset your password. Click the button below to set a new password.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${resetLink}" class="btn">Reset My Password</a>
      </div>
      <div class="alert">⚠️ This link expires in 1 hour. If you didn't request a password reset, ignore this email — your password won't change.</div>
    `)
  });
};

// ─── LOGIN ALERT ────────────────────────────────────────────
const sendLoginAlertEmail = async (user, ip, device) => {
  await resend.emails.send({
    from: FROM, to: user.email,
    subject: '🔒 New login to your NairaFlow account',
    html: baseTemplate(`
      <div class="title">New Login Detected</div>
      <p class="text">A new login was detected on your account.</p>
      <div class="info-row"><span class="info-label">IP Address</span><span class="info-value">${ip}</span></div>
      <div class="info-row"><span class="info-label">Device</span><span class="info-value">${device}</span></div>
      <div class="info-row"><span class="info-label">Time</span><span class="info-value">${new Date().toLocaleString()}</span></div>
      <div class="alert">If this wasn't you, please <a href="${process.env.APP_URL}/auth/reset-password" style="color:#b45309">reset your password immediately</a> and contact support.</div>
    `)
  });
};

// ─── REFERRAL BONUS ─────────────────────────────────────────
const sendReferralBonusEmail = async (user, amount, referredName) => {
  await resend.emails.send({
    from: FROM, to: user.email,
    subject: `🎁 You earned ₦${amount} referral bonus!`,
    html: baseTemplate(`
      <div class="title">Referral Bonus Earned!</div>
      <p class="text">${referredName} just joined NairaFlow using your referral link and made their first transaction!</p>
      <div class="amount-box">
        <div class="amount">₦${amount.toLocaleString()}</div>
        <div class="amount-label">REFERRAL BONUS CREDITED</div>
      </div>
      <p class="text">Keep sharing your referral link to earn more bonuses. Every active referral earns you ₦${amount}!</p>
      <div style="text-align:center"><a href="${process.env.APP_URL}/user/referrals" class="btn">View Referrals</a></div>
    `)
  });
};

module.exports = {
  sendVerificationEmail, sendTransactionEmail, sendWalletFundedEmail,
  sendPasswordResetEmail, sendLoginAlertEmail, sendReferralBonusEmail
};
