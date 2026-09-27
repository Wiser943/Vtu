const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { verifyWebhookSignature } = require('../utils/korapay');
const { sendWalletFundedEmail, sendReferralBonusEmail } = require('../utils/email');

// ─── KORAPAY WEBHOOK ────────────────────────────────────────
router.post('/korapay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-korapay-signature'];
    const payload = JSON.parse(req.body);

    if (!verifyWebhookSignature(payload, signature)) {
      console.warn('⚠️ Invalid Korapay webhook signature');
      return res.status(401).json({ message: 'Invalid signature' });
    }

    const { event, data } = payload;

    // ─── VIRTUAL ACCOUNT TRANSFER (auto wallet funding) ─────
    if (event === 'charge.success' && data.payment_type === 'virtual_bank_account') {
      const { amount, account_reference } = data;

      // Prevent duplicate processing
      const exists = await Transaction.findOne({ reference: data.reference });
      if (exists) return res.sendStatus(200);

      // Find user from account reference
      const userId = account_reference?.replace('nf_wallet_', '');
      const user = await User.findById(userId);
      if (!user) return res.sendStatus(200);

      const balanceBefore = user.walletBalance;
      const balanceAfter = balanceBefore + amount;

      // Credit wallet
      await User.findByIdAndUpdate(userId, { $inc: { walletBalance: amount, totalFunded: amount } });

      // Log transaction
      await Transaction.create({
        userId,
        reference: data.reference || `NF_KORA_${uuidv4().replace(/-/g,'').substr(0,12)}`,
        type: 'wallet_fund',
        category: 'credit',
        amount,
        balanceBefore,
        balanceAfter,
        status: 'success',
        statusMessage: 'Wallet funded via bank transfer',
        externalReference: data.reference,
        processedAt: new Date()
      });

      // Send notification to user
      await User.findByIdAndUpdate(userId, {
        $push: {
          notifications: {
            type: 'credit',
            title: 'Wallet Funded',
            message: `Your wallet has been credited with ₦${amount.toLocaleString()}`,
            isRead: false
          }
        }
      });

      // Send email
      sendWalletFundedEmail(user, amount, balanceAfter).catch(() => {});

      // Handle referral bonus (on first fund)
      if (user.referredBy && user.totalFunded === amount) {
        const bonus = parseInt(process.env.REFERRAL_BONUS) || 200;
        const referrer = await User.findById(user.referredBy);
        if (referrer) {
          await User.findByIdAndUpdate(referrer._id, {
            $inc: { walletBalance: bonus, referralEarnings: bonus, referralCount: 1 }
          });
          await Transaction.create({
            userId: referrer._id,
            reference: `NF_REF_${uuidv4().replace(/-/g,'').substr(0,12)}`,
            type: 'referral_bonus', category: 'credit',
            amount: bonus, status: 'success',
            balanceBefore: referrer.walletBalance,
            balanceAfter: referrer.walletBalance + bonus,
            statusMessage: `Referral bonus for ${user.fullName}`
          });
          sendReferralBonusEmail(referrer, bonus, user.fullName).catch(() => {});
        }
      }

      console.log(`✅ Wallet funded: User ${userId}, Amount: ₦${amount}`);
    }

    // ─── CARD PAYMENT SUCCESS ────────────────────────────────
    if (event === 'charge.success' && data.payment_type === 'card') {
      const exists = await Transaction.findOne({ reference: data.reference });
      if (exists) return res.sendStatus(200);

      const { metadata, amount } = data;
      if (metadata?.type === 'wallet_fund' && metadata?.userId) {
        const user = await User.findById(metadata.userId);
        if (!user) return res.sendStatus(200);
        const balanceBefore = user.walletBalance;
        await User.findByIdAndUpdate(metadata.userId, { $inc: { walletBalance: amount, totalFunded: amount } });
        await Transaction.create({
          userId: metadata.userId, reference: data.reference,
          type: 'wallet_fund', category: 'credit', amount,
          balanceBefore, balanceAfter: balanceBefore + amount,
          status: 'success', processedAt: new Date()
        });
        sendWalletFundedEmail(user, amount, balanceBefore + amount).catch(() => {});
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(500);
  }
});

module.exports = router;
