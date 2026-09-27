const Transaction = require('../models/Transaction');
const User = require('../models/User');
const vtpass = require('./vtpass');

const checkPendingTransactions = async () => {
  const pending = await Transaction.find({
    status: { $in: ['pending', 'processing'] },
    createdAt: { $gt: new Date(Date.now() - 2 * 60 * 60 * 1000) } // last 2 hours
  }).limit(20);

  for (const tx of pending) {
    try {
      const result = await vtpass.checkTransactionStatus(tx.reference);
      const parsed = vtpass.parseVTpassResponse(result);
      if (parsed.success) {
        await Transaction.findByIdAndUpdate(tx._id, { status: 'success', processedAt: new Date() });
      } else if (result.code && result.code !== '099') {
        // Definitive failure — refund
        await User.findByIdAndUpdate(tx.userId, { $inc: { walletBalance: tx.amount, totalSpent: -tx.amount } });
        await Transaction.findByIdAndUpdate(tx._id, { status: 'failed', failureReason: parsed.message });
      }
    } catch (e) { /* skip */ }
  }
};

const updateDailyStats = async () => {
  // Reset daily API call counters
  await User.updateMany({ apiEnabled: true }, { $set: { apiCallsToday: 0 } });
};

module.exports = { checkPendingTransactions, updateDailyStats };
