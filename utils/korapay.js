const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.korapay.com/merchant/api/v1';

const headers = () => ({
  'Authorization': `Bearer ${process.env.KORAPAY_SECRET_KEY}`,
  'Content-Type': 'application/json'
});

// ─── CREATE VIRTUAL ACCOUNT (permanent per user) ─────────────
const createVirtualAccount = async (user) => {
  const res = await axios.post(`${BASE_URL}/virtual-bank-account`, {
    account_name: user.fullName,
    account_reference: `nf_wallet_${user._id}`,
    permanent: true,
    bank_code: '035', // Wema Bank
    customer: {
      name: user.fullName,
      email: user.email
    }
  }, { headers: headers() });

  return res.data;
};

// ─── INITIALIZE CARD PAYMENT ────────────────────────────────
const initializePayment = async ({ email, amount, reference, callbackUrl, metadata }) => {
  const res = await axios.post(`${BASE_URL}/charges/initialize`, {
    reference,
    amount,
    currency: 'NGN',
    redirect_url: callbackUrl,
    customer: { email },
    metadata
  }, { headers: headers() });

  return res.data;
};

// ─── VERIFY PAYMENT ─────────────────────────────────────────
const verifyPayment = async (reference) => {
  const res = await axios.get(`${BASE_URL}/charges/${reference}`, { headers: headers() });
  return res.data;
};

// ─── VERIFY WEBHOOK SIGNATURE ───────────────────────────────
const verifyWebhookSignature = (payload, signature) => {
  const hash = crypto
    .createHmac('sha256', process.env.KORAPAY_SECRET_KEY)
    .update(JSON.stringify(payload))
    .digest('hex');
  return hash === signature;
};

// ─── INITIATE PAYOUT / TRANSFER ─────────────────────────────
const initiateTransfer = async ({ amount, bankCode, accountNumber, accountName, reference, narration }) => {
  const res = await axios.post(`${BASE_URL}/transactions/disburse`, {
    reference,
    destination: {
      type: 'bank_account',
      amount,
      currency: 'NGN',
      narration: narration || 'NairaFlow Withdrawal',
      bank_account: { bank: bankCode, account: accountNumber },
      customer: { name: accountName }
    }
  }, { headers: headers() });

  return res.data;
};

// ─── GET BANKS LIST ─────────────────────────────────────────
const getBanks = async () => {
  const res = await axios.get(`${BASE_URL}/misc/banks?countryCode=NG`, { headers: headers() });
  return res.data;
};

// ─── RESOLVE ACCOUNT ────────────────────────────────────────
const resolveAccount = async (accountNumber, bankCode) => {
  const res = await axios.post(`${BASE_URL}/misc/banks/resolve`, {
    bank: bankCode, account: accountNumber
  }, { headers: headers() });
  return res.data;
};

module.exports = {
  createVirtualAccount, initializePayment, verifyPayment,
  verifyWebhookSignature, initiateTransfer, getBanks, resolveAccount
};
