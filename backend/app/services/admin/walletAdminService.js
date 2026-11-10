import Transaction from "../../models/transaction.js";
import Setting from "../../models/setting.js";
import Notification from "../../models/notification.js";
import { getAdminFinanceSummary } from "../finance/walletService.js";
import { getLedgerEntries } from "../finance/ledgerService.js";

export async function getAdminWalletOverview({ page, limit }) {
  const stats = await getAdminFinanceSummary();
  const ledger = await getLedgerEntries({ page, limit });
  const transactionItems = ledger.items.map((entry) => ({
    id: entry.transactionId || entry.reference || String(entry._id),
    type: entry.type,
    amount:
      entry.direction === "DEBIT"
        ? -Math.abs(entry.amount || 0)
        : Math.abs(entry.amount || 0),
    status: entry.status,
    sender: entry.direction === "DEBIT" ? entry.actorType : "System/Order",
    recipient: entry.direction === "CREDIT" ? entry.actorType : "Platform Wallet",
    date: new Date(entry.createdAt).toLocaleDateString(),
    time: new Date(entry.createdAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    notes: entry.description || entry.type,
    method: entry.paymentMode || "N/A",
  }));

  return {
    stats: {
      totalPlatformEarning: stats.totalPlatformEarning,
      totalAdminEarning: stats.totalAdminEarning,
      availableBalance: stats.availableBalance,
      sellerPendingPayouts: stats.sellerPendingPayouts,
      deliveryPendingPayouts: stats.deliveryPendingPayouts,
      systemFloat: stats.systemFloatCOD,
    },
    transactions: {
      items: transactionItems,
      page: ledger.page,
      limit: ledger.limit,
      total: ledger.total,
      totalPages: ledger.totalPages,
    },
  };
}

export async function getDeliveryTransactionsData({ page, limit, skip }) {
  const query = { userModel: "Delivery" };
  const transactions = await Transaction.find(query)
    .populate("user", "name phone documents")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Transaction.countDocuments(query);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getSellerWithdrawalsData({ page, limit, skip }) {
  const query = { userModel: "Seller", type: "Withdrawal" };

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .populate("user", "name shopName phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(query),
  ]);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getSellerTransactionsData({ page, limit, skip }) {
  const query = { userModel: "Seller" };
  const transactions = await Transaction.find(query)
    .populate("user", "name shopName phone bankDetails")
    .populate({
      path: "order",
      select: "orderId pricing",
      populate: {
        path: "items.product",
        select: "name",
      },
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Transaction.countDocuments(query);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getDeliveryWithdrawalsData({ page, limit, skip }) {
  const query = { userModel: "Delivery", type: "Withdrawal" };

  const [transactions, total] = await Promise.all([
    Transaction.find(query)
      .populate("user", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(query),
  ]);

  return {
    items: transactions,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function updateWithdrawalStatusById({ id, status, reason }) {
  if (!["Settled", "Failed", "Processing"].includes(status)) {
    throw new Error("Invalid status");
  }

  const transaction = await Transaction.findById(id).populate("user", "name");
  if (!transaction) {
    return null;
  }

  transaction.status = status;
  if (reason) {
    transaction.notes = reason;
  }

  await transaction.save();
  return transaction;
}

export async function settleDeliveryTransactionById(id) {
  const transaction = await Transaction.findByIdAndUpdate(
    id,
    { status: "Settled" },
    { new: true },
  ).populate("user", "name");

  if (!transaction) {
    return null;
  }

  await Notification.create({
    recipient: transaction.user._id,
    recipientModel: "Delivery",
    title: "Payment Settled",
    message: `Your payment of \u20B9${transaction.amount} has been settled.`,
    type: "payment",
    data: { transactionId: transaction._id },
  });

  return transaction;
}

export async function bulkSettleDeliveryTransactions() {
  return Transaction.updateMany(
    { userModel: "Delivery", status: "Pending" },
    { status: "Settled" },
  );
}

/**
 * Withdrawal deductions, read from Settings (DB):
 *   TDS % + Service charge % + Admin charge % of the requested amount.
 * The full requested amount leaves the wallet; the user receives netPayable.
 */
export const WITHDRAWAL_TRANSFER_TYPES = ["bank_transfer", "wallet_to_wallet", "quick_transfer"];

export async function computeWithdrawalCharges(amount, transferType = "bank_transfer") {
  if (!WITHDRAWAL_TRANSFER_TYPES.includes(transferType)) transferType = "bank_transfer";
  const setting = (await Setting.findOne()
    .select("withdrawalTdsPercent withdrawalServiceChargePercent withdrawalAdminChargePercent withdrawalQuickTransferPercent")
    .lean()) || {};
  const pct = (v, d) => {
    const n = Number(v ?? d);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const round2 = (n) => Math.round(n * 100) / 100;

  const grossAmount = round2(Math.abs(Number(amount) || 0));
  const tdsPercent = pct(setting.withdrawalTdsPercent, 5);
  const serviceChargePercent = pct(setting.withdrawalServiceChargePercent, 5);
  const adminChargePercent = pct(setting.withdrawalAdminChargePercent, 15);
  // Extra cut only for Quick Transfer.
  const quickTransferPercent = transferType === "quick_transfer" ? pct(setting.withdrawalQuickTransferPercent, 2) : 0;

  const tdsAmount = round2((grossAmount * tdsPercent) / 100);
  const serviceChargeAmount = round2((grossAmount * serviceChargePercent) / 100);
  const adminChargeAmount = round2((grossAmount * adminChargePercent) / 100);
  const quickTransferAmount = round2((grossAmount * quickTransferPercent) / 100);
  const totalDeduction = round2(tdsAmount + serviceChargeAmount + adminChargeAmount + quickTransferAmount);
  const netPayable = round2(Math.max(0, grossAmount - totalDeduction));

  return {
    transferType,
    grossAmount,
    tdsPercent,
    tdsAmount,
    serviceChargePercent,
    serviceChargeAmount,
    adminChargePercent,
    adminChargeAmount,
    quickTransferPercent,
    quickTransferAmount,
    totalDeduction,
    netPayable,
  };
}
