import Transaction from "../models/transaction.js";
import {
  handleCodOrderFinance,
  settleDeliveredOrder,
} from "./finance/orderFinanceService.js";
import { processBinaryCommission } from "./mlmService.js";

/**
 * Financial side effects when order becomes delivered (mirrors orderController).
 */
export async function applyDeliveredSettlement(order, orderIdString) {
  const settled = await settleDeliveredOrder(order._id);

  const method = (order.payment?.method || "").toLowerCase();
  const isCod = settled.paymentMode === "COD" || method === "cash" || method === "cod";
  if (isCod && settled.deliveryBoy && !settled.financeFlags?.codMarkedCollected) {
    await handleCodOrderFinance(settled._id, {
      deliveryPartnerId: settled.deliveryBoy,
    });
  }

  // Legacy transaction compatibility for existing seller/rider dashboards.
  await Transaction.updateMany(
    { reference: orderIdString, userModel: "Seller" },
    { status: "Settled" },
  );

  if (settled.deliveryBoy) {
    const deliveryEarning = Math.round(settled.paymentBreakdown?.riderPayoutTotal || 0);
    const deliveryMeta = {
      tipAmount: Math.round(settled.paymentBreakdown?.riderTipAmount || 0),
      payoutBase: Math.round(settled.paymentBreakdown?.riderPayoutBase || 0),
      payoutDistance: Math.round(settled.paymentBreakdown?.riderPayoutDistance || 0),
      payoutBonus: Math.round(settled.paymentBreakdown?.riderPayoutBonus || 0),
    };
    await Transaction.findOneAndUpdate(
      { reference: `DEL-ERN-${orderIdString}` },
      {
        $set: {
          amount: deliveryEarning,
          status: "Settled",
          meta: deliveryMeta,
        },
        $setOnInsert: {
          user: settled.deliveryBoy,
          userModel: "Delivery",
          order: settled._id,
          type: "Delivery Earning",
          reference: `DEL-ERN-${orderIdString}`,
        },
      },
      { upsert: true, new: true },
    );

    if (isCod) {
      await Transaction.findOneAndUpdate(
        { reference: `CASH-COL-${orderIdString}` },
        {
          $setOnInsert: {
            user: settled.deliveryBoy,
            userModel: "Delivery",
            order: settled._id,
            type: "Cash Collection",
            amount: settled.paymentBreakdown?.grandTotal || settled.pricing?.total || 0,
            status: "Settled",
            reference: `CASH-COL-${orderIdString}`,
          },
        },
        { upsert: true, new: true },
      );
    }
  }

  // Trigger MLM Commission calculation for order entities
  const totalAmount = settled.paymentBreakdown?.grandTotal || settled.pricing?.total || order.total || 0;
  if (totalAmount > 0) {
    const customerId = order.user || order.customer;
    if (customerId) {
      processBinaryCommission({
        entityId: customerId,
        entityType: "User",
        source: "User Commission",
        amount: totalAmount,
        orderId: order._id,
        remarks: `Order #${order.orderId || order._id} User Commission`,
      }).catch((e) => console.error("Error triggering User MLM commission:", e));
    }

    if (settled.seller) {
      processBinaryCommission({
        entityId: settled.seller,
        entityType: "Seller",
        source: "Vendor Commission",
        amount: totalAmount,
        orderId: order._id,
        remarks: `Order #${order.orderId || order._id} Seller Commission`,
      }).catch((e) => console.error("Error triggering Seller MLM commission:", e));
    }

    if (settled.deliveryBoy) {
      processBinaryCommission({
        entityId: settled.deliveryBoy,
        entityType: "Delivery",
        source: "Rider Commission",
        amount: totalAmount,
        orderId: order._id,
        remarks: `Order #${order.orderId || order._id} Delivery Commission`,
      }).catch((e) => console.error("Error triggering Delivery MLM commission:", e));
    }
  }
}
