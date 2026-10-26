import MlmTree from "../models/mlmTree.js";
import MlmCommissionLog from "../models/mlmCommissionLog.js";
import Setting from "../models/setting.js";
import User from "../models/customer.js";
const Customer = User;
import Seller from "../models/seller.js";
import Delivery from "../models/delivery.js";
import Wallet from "../models/wallet.js";
import Transaction from "../models/transaction.js";

/**
 * Places a newly registered entity (User, Seller, or Delivery) into the binary tree
 * using strict Level-Order BFS traversal filling LEFT child slot first, then RIGHT.
 */
export const placeInTree = async ({ entityId, entityType, sponsorId = null }) => {
  try {
    if (!entityId || !entityType) {
      throw new Error("entityId and entityType are required for tree placement");
    }

    // 1. Check if node already exists in tree
    let existingNode = await MlmTree.findOne({ entityId, entityType });
    if (existingNode) {
      return existingNode;
    }

    // 2. Find sponsor/start node
    let startNode = null;
    if (sponsorId) {
      startNode = await MlmTree.findOne({
        $or: [{ _id: sponsorId }, { entityId: sponsorId }],
      });
    }

    if (!startNode) {
      // Find the root node of the tree
      startNode = await MlmTree.findOne({ position: "root" });
    }

    // If no root node exists at all, make this entity the Root node
    if (!startNode) {
      const rootNode = await MlmTree.create({
        entityId,
        entityType,
        entityModel: entityType,
        position: "root",
        level: 0,
      });
      return rootNode;
    }

    // 3. Perform Level-Order BFS Traversal (LEFT -> RIGHT) starting from startNode
    const queue = [startNode];
    while (queue.length > 0) {
      const currentNode = queue.shift();

      // Check LEFT slot first
      if (!currentNode.leftId) {
        const newNode = await MlmTree.create({
          entityId,
          entityType,
          entityModel: entityType,
          sponsorId: startNode._id,
          parentId: currentNode._id,
          position: "left",
          level: currentNode.level + 1,
        });

        currentNode.leftId = newNode._id;
        await currentNode.save();
        return newNode;
      }

      // Check RIGHT slot second
      if (!currentNode.rightId) {
        const newNode = await MlmTree.create({
          entityId,
          entityType,
          entityModel: entityType,
          sponsorId: startNode._id,
          parentId: currentNode._id,
          position: "right",
          level: currentNode.level + 1,
        });

        currentNode.rightId = newNode._id;
        await currentNode.save();
        return newNode;
      }

      // Both slots full, enqueue children in LEFT -> RIGHT order
      const [leftNode, rightNode] = await Promise.all([
        MlmTree.findById(currentNode.leftId),
        MlmTree.findById(currentNode.rightId),
      ]);

      if (leftNode) queue.push(leftNode);
      if (rightNode) queue.push(rightNode);
    }

    throw new Error("Unable to place entity in binary tree");
  } catch (error) {
    console.error("Error in placeInTree:", error);
    throw error;
  }
};


/**
 * Returns current daily commission cap usage for a User.
 */
export const getUserCapStatus = async (userId) => {
  const setting = (await Setting.findOne().lean()) || {};
  const userDailyCap = Number(setting.userDailyCommissionCap ?? 25000);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const todayLogs = await MlmCommissionLog.aggregate([
    {
      $match: {
        entityId: userId._id || userId,
        entityType: "User",
        date: { $gte: startOfDay, $lte: endOfDay },
      },
    },
    {
      $group: {
        _id: null,
        totalCredited: { $sum: "$creditedAmount" },
        totalCapped: { $sum: "$cappedAmount" },
      },
    },
  ]);

  const alreadyCreditedToday = todayLogs.length > 0 ? todayLogs[0].totalCredited : 0;
  const alreadyCappedToday = todayLogs.length > 0 ? todayLogs[0].totalCapped : 0;
  const remainingCap = Math.max(0, userDailyCap - alreadyCreditedToday);

  return {
    userDailyCap,
    alreadyCreditedToday,
    alreadyCappedToday,
    remainingCap,
  };
};

/**
 * Fetches hierarchical binary tree structure for visual display.
 */
export const getTreeStructure = async (rootEntityId = null, depth = 4) => {
  let rootNode = null;
  if (rootEntityId) {
    rootNode = await MlmTree.findOne({ entityId: rootEntityId })
      .populate("entityId", "name email phone shopName vehicleType")
      .lean();
  }
  if (!rootNode) {
    rootNode = await MlmTree.findOne({ position: "root" })
      .populate("entityId", "name email phone shopName vehicleType")
      .lean();
  }

  if (!rootNode) return null;

  const buildSubtree = async (node, currentDepth) => {
    if (!node || currentDepth >= depth) return null;

    const [left, right] = await Promise.all([
      node.leftId
        ? MlmTree.findById(node.leftId).populate("entityId", "name email phone shopName vehicleType").lean()
        : null,
      node.rightId
        ? MlmTree.findById(node.rightId).populate("entityId", "name email phone shopName vehicleType").lean()
        : null,
    ]);

    return {
      id: node._id,
      entityId: node.entityId?._id || node.entityId,
      entityType: node.entityType,
      name: node.entityId?.name || node.entityId?.shopName || "Unknown",
      position: node.position,
      level: node.level,
      left: left ? await buildSubtree(left, currentDepth + 1) : null,
      right: right ? await buildSubtree(right, currentDepth + 1) : null,
    };
  };

  return await buildSubtree(rootNode, 0);
};

/**
 * Common MLM Binary Commission Engine
 * Handles Vendor Registration, Delivery Registration and other sources based on the PDF.
 */
export const processBinaryCommission = async ({ entityId, entityType, source, amount, orderId = null, remarks = null }) => {
  try {
    const startNode = await MlmTree.findOne({ entityId, entityType });
    if (!startNode) return { success: false, message: "Node not found in MLM tree" };

    const setting = (await Setting.findOne().lean()) || {};
    const PAIR_VALUE = Number(setting.mlmPairValue ?? 3.60);
    const PER_ID_INCOME = Number(setting.mlmPerIdIncome ?? 0.0002);
    const DAILY_CAP = Number(setting.userDailyCommissionCap ?? 10000);

    let currentNode = await MlmTree.findById(startNode.parentId);
    let childNodeId = startNode._id;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Traverse up the tree to update Left/Right balances and process pairs
    while (currentNode) {
      // --- DAILY CAPPING & WEEKLY ACCUMULATION LOGIC ---
      // Check today's earnings from Transactions to enforce Daily Cap
      const todayLogs = await Transaction.aggregate([
        {
          $match: {
            user: currentNode.entityId,
            type: "Bonus",
            createdAt: { $gte: startOfDay }
          }
        },
        { $group: { _id: null, totalCredited: { $sum: "$amount" } } }
      ]);
      const alreadyCreditedToday = todayLogs.length > 0 ? todayLogs[0].totalCredited : 0;

      // Only credit Per-ID income if within Daily Cap
      if (alreadyCreditedToday + PER_ID_INCOME <= DAILY_CAP) {
        // 1. Give Per-ID Income (0.002) to currentNode
        const normalizedOwnerType = currentNode.entityType === "User" ? "CUSTOMER" : (currentNode.entityType === "Delivery" ? "DELIVERY_PARTNER" : currentNode.entityType.toUpperCase());
        await Wallet.findOneAndUpdate(
          { ownerType: normalizedOwnerType, ownerId: currentNode.entityId },
          { $inc: { availableBalance: PER_ID_INCOME, totalCredited: PER_ID_INCOME } },
          { upsert: true, new: true }
        );

        if (currentNode.entityType === "User") {
          await User.findByIdAndUpdate(currentNode.entityId, {
            $inc: { walletBalance: PER_ID_INCOME }
          }).catch(() => null);
        }

        await Transaction.create({
          user: currentNode.entityId,
          userModel: currentNode.entityModel,
          order: orderId,
          type: "Bonus",
          amount: PER_ID_INCOME,
          status: "Settled",
          reference: `MLM-PER-ID-${startNode._id}`,
          meta: { source, amount, note: "Per-ID Income 0.0002", remarks },
        });

        // Weekly accumulation update
        currentNode.weeklyAccumulatedIncome += PER_ID_INCOME;
      }

      // 2. Add volume to Left or Right based on where the child is
      if (currentNode.leftId?.toString() === childNodeId.toString()) {
        currentNode.leftBalance += amount;
      } else if (currentNode.rightId?.toString() === childNodeId.toString()) {
        currentNode.rightBalance += amount;
      }

      // 3. Process Pair Matching (1:1 example. Pair Value 3.60)
      const matchedVolume = Math.min(currentNode.leftBalance, currentNode.rightBalance);
      const pairs = Math.floor(matchedVolume / PAIR_VALUE);

      if (pairs > 0) {
        const pairAmount = pairs * PAIR_VALUE;
        currentNode.leftBalance -= pairAmount;
        currentNode.rightBalance -= pairAmount;
        currentNode.carryForward = currentNode.leftBalance + currentNode.rightBalance;
        currentNode.totalEarning += pairAmount;

        // Admin Wallet Credit
        // Using ownerType "ADMIN" with a centralized ownerId "SYSTEM"
        await Wallet.findOneAndUpdate(
          { ownerType: "ADMIN", ownerId: "ADMIN_SYSTEM_WALLET" },
          { $inc: { availableBalance: pairAmount, totalCredited: pairAmount } },
          { upsert: true }
        );

        await MlmCommissionLog.create({
          requestedAmount: amount,
          creditedAmount: pairAmount,
          cappedAmount: 0,
          date: new Date(),
          entityId: currentNode.entityId,
          entityType: currentNode.entityType,
          sourceOrderId: orderId,
          source: source || "General",
          section: "B",
          generatedIds: pairs,
          unitValue: PAIR_VALUE,
          remarks: remarks || `Matched ${pairs} pairs (${pairAmount}) sent to Admin Wallet for source: ${source}`,
        });
      }

      await currentNode.save();

      // Move up the tree
      childNodeId = currentNode._id;
      currentNode = await MlmTree.findById(currentNode.parentId);
    }

    return { success: true, message: "Binary commission processed" };
  } catch (error) {
    console.error("Error in processBinaryCommission:", error);
    throw error;
  }
};

/**
 * Calculates MLM Daily Inflow Pool (User subscriptions + Vendor Onboarding + Rider Subscriptions)
 * and returns:
 * - Total Inflow Collection
 * - Divisor (3.60 pair value)
 * - Total Generated IDs (e.g. 413 / 3.60 = 114.72)
 * - Section B: Generated IDs (Entities whose pairs were generated)
 * - Section A: Pending IDs (Entities whose pairs are still waiting / unmatched balance)
 */
export const getPoolAndSectionsOverview = async (queryDate = null) => {
  try {
    const setting = (await Setting.findOne().lean()) || {};
    const PAIR_VALUE = Number(setting.mlmPairValue ?? 3.60);

    let startOfDay, endOfDay;
    if (queryDate && typeof queryDate === "string" && queryDate.includes("-")) {
      const parts = queryDate.split("-").map(Number);
      // Give safe window covering IST (+5:30) and UTC (server)
      startOfDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0) - 6 * 3600 * 1000);
      endOfDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999) + 6 * 3600 * 1000);
    } else {
      const now = new Date();
      startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }

    // 1. Calculate Collections from Transaction, Seller/Delivery onboarding, and Subscription logs
    // A: Customer Weekly Subscriptions (Direct collection matching wallet calculation)
    const [customerSubsDate, allActiveCustomerSubs] = await Promise.all([
      Customer.find({
        $or: [
          { "weeklySubscription.paidAt": { $gte: startOfDay, $lte: endOfDay } },
          {
            "weeklySubscription.status": { $in: ["active", "completed", "due"] },
            updatedAt: { $gte: startOfDay, $lte: endOfDay }
          },
          {
            "weeklySubscription.status": { $in: ["active", "completed", "due"] },
            createdAt: { $gte: startOfDay, $lte: endOfDay }
          }
        ]
      }).select("name phone weeklySubscription"),
      Customer.find({
        "weeklySubscription.status": { $in: ["active", "due", "completed"] },
        "weeklySubscription.amount": { $gt: 0 }
      }).select("name phone weeklySubscription")
    ]);

    const dateCustomerSubAmount = customerSubsDate.reduce(
      (sum, c) => sum + (Number(c.weeklySubscription?.amount) || 0),
      0
    );
    const allCustomerSubAmount = allActiveCustomerSubs.reduce(
      (sum, c) => sum + (Number(c.weeklySubscription?.amount) || 0),
      0
    );
    const totalCustomerSubAmount = dateCustomerSubAmount > 0 ? dateCustomerSubAmount : allCustomerSubAmount;

    // B: Vendor Onboarding Fees (Tracked for records)
    const [vendorSellersDate, allPaidSellers, vendorLogs] = await Promise.all([
      Seller.find({
        "onboardingPayment.status": { $in: ["completed", "exempt"] },
        $or: [
          { "onboardingPayment.paidAt": { $gte: startOfDay, $lte: endOfDay } },
          { createdAt: { $gte: startOfDay, $lte: endOfDay } },
          { updatedAt: { $gte: startOfDay, $lte: endOfDay } }
        ]
      }).select("onboardingPayment name phone shopName"),
      Seller.find({
        "onboardingPayment.status": { $in: ["completed", "exempt"] },
        "onboardingPayment.amount": { $gt: 0 }
      }).select("onboardingPayment name phone shopName"),
      MlmCommissionLog.find({
        date: { $gte: startOfDay, $lte: endOfDay },
        source: "Vendor Registration Fee",
      })
    ]);

    const dateSellerSum = vendorSellersDate.reduce(
      (sum, s) => sum + (Number(s.onboardingPayment?.amount) || 0),
      0
    );
    const allSellerSum = allPaidSellers.reduce(
      (sum, s) => sum + (Number(s.onboardingPayment?.amount) || 0),
      0
    );
    const vendorLogsSum = vendorLogs.reduce(
      (sum, v) => sum + (Number(v.requestedAmount) || 0),
      0
    );
    const candidateVendorSum = Math.max(dateSellerSum, vendorLogsSum);
    const totalVendorFeeAmount = candidateVendorSum > 0 ? candidateVendorSum : allSellerSum;

    // C: Rider Subscriptions / Fees
    const [riderDeliveryDate, allPaidDelivery, riderLogs] = await Promise.all([
      Delivery.find({
        "onboardingPayment.status": { $in: ["completed", "exempt"] },
        $or: [
          { "onboardingPayment.paidAt": { $gte: startOfDay, $lte: endOfDay } },
          { createdAt: { $gte: startOfDay, $lte: endOfDay } },
          { updatedAt: { $gte: startOfDay, $lte: endOfDay } }
        ]
      }).select("onboardingPayment name phone"),
      Delivery.find({
        "onboardingPayment.status": { $in: ["completed", "exempt"] },
        "onboardingPayment.amount": { $gt: 0 }
      }).select("onboardingPayment name phone"),
      MlmCommissionLog.find({
        date: { $gte: startOfDay, $lte: endOfDay },
        source: "Rider Registration Fee",
      })
    ]);
    const dateRiderSum = riderDeliveryDate.reduce(
      (sum, r) => sum + (Number(r.onboardingPayment?.amount) || 0),
      0
    );
    const allRiderSum = allPaidDelivery.reduce(
      (sum, r) => sum + (Number(r.onboardingPayment?.amount) || 0),
      0
    );
    const riderLogsSum = riderLogs.reduce(
      (sum, r) => sum + (Number(r.requestedAmount) || 0),
      0
    );
    const candidateRiderSum = Math.max(dateRiderSum, riderLogsSum);
    const totalRiderFeeAmount = candidateRiderSum > 0 ? candidateRiderSum : allRiderSum;

    // D: Order Commissions & other user sources
    const orderLogs = await MlmCommissionLog.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      source: { $nin: ["Vendor Registration Fee", "Rider Registration Fee"] },
    });
    const totalOrderCommissionAmount = orderLogs.reduce(
      (sum, o) => sum + (Number(o.requestedAmount) || 0),
      0
    );

    // Strictly USER MLM POOL: Inflow comes from Customer weekly subscriptions and Customer order commissions
    const grandTotalInflow = totalCustomerSubAmount + totalOrderCommissionAmount;

    // Formula: Total Inflow / 3.60 = Total Generated IDs
    // e.g. ₹36 / 3.60 = 10 IDs and ₹0 remaining
    const totalGeneratedPoolIds = grandTotalInflow > 0
      ? Number((grandTotalInflow / PAIR_VALUE).toFixed(2))
      : 0;
    const integerIds = Math.floor(totalGeneratedPoolIds);
    const remainingBalance = grandTotalInflow > 0
      ? Number((grandTotalInflow - (integerIds * PAIR_VALUE)).toFixed(2))
      : 0;

    // 2. Fetch Section B: Customer/User Nodes with Generated IDs
    const completedCommissionLogs = await MlmCommissionLog.find({
      date: { $gte: startOfDay, $lte: endOfDay },
      section: "B",
      entityType: "User",
    })
      .populate("entityId", "name phone")
      .sort({ createdAt: -1 })
      .lean();

    const sectionB = completedCommissionLogs.map((log) => ({
      id: log._id,
      entityId: log.entityId?._id || log.entityId,
      name: log.entityId?.name || "Customer",
      phone: log.entityId?.phone || "-",
      entityType: "User",
      source: log.source,
      requestedAmount: log.requestedAmount,
      creditedAmount: log.creditedAmount,
      generatedIds: log.generatedIds || (log.creditedAmount > 0 ? Math.floor(log.creditedAmount / PAIR_VALUE) : 0),
      unitValue: log.unitValue || PAIR_VALUE,
      status: "ID Generated (Section B)",
      date: log.date,
      remarks: log.remarks,
    }));

    // Show User Pool Generated distribution cleanly
    if (integerIds > 0 && sectionB.length === 0) {
      // Find active user in tree to attribute the generated IDs
      const firstUserNode = await MlmTree.findOne({ entityType: "User" }).populate("entityId", "name phone").lean();
      const userName = firstUserNode?.entityId?.name || "Customer Pool";
      const userPhone = firstUserNode?.entityId?.phone || "-";
      const PER_ID_INCOME = Number(setting.mlmPerIdIncome ?? 0.0002);
      const totalPoolIncomeCredited = Number((integerIds * PER_ID_INCOME).toFixed(4));

      sectionB.push({
        id: "pool-daily-generated",
        entityId: firstUserNode?.entityId?._id || "USER_POOL",
        name: userName,
        phone: userPhone,
        entityType: "User",
        source: `Weekly Subscriptions (₹${totalCustomerSubAmount})`,
        requestedAmount: grandTotalInflow,
        creditedAmount: totalPoolIncomeCredited,
        generatedIds: integerIds,
        unitValue: PAIR_VALUE,
        status: "ID Generated (Section B)",
        date: new Date(),
        remarks: `${integerIds} IDs Generated from Pool (@ ₹${PAIR_VALUE} each)`,
      });
    }

    // 3. Fetch Section A: Only User/Customer Nodes (Filter out Seller & Delivery)
    // Make sure all registered users in tree appear so Sandeep Kurne and Gaurav both are visible
    const allUserNodes = await MlmTree.find({
      entityType: "User",
    })
      .populate("entityId", "name phone")
      .lean();

    // Also check if any Customers exist who are not yet in MlmTree (auto-place them)
    const allCustomers = await Customer.find({ isActive: { $ne: false } }).select("name phone").lean();
    const existingEntityIds = new Set(allUserNodes.map((n) => n.entityId?._id?.toString() || n.entityId?.toString()));

    for (const cust of allCustomers) {
      if (!existingEntityIds.has(cust._id.toString())) {
        try {
          const placedNode = await placeInTree({ entityId: cust._id, entityType: "User" });
          if (placedNode) {
            allUserNodes.push({
              _id: placedNode._id,
              entityId: cust,
              entityType: "User",
              leftBalance: 0,
              rightBalance: 0,
              level: placedNode.level || 1,
              position: placedNode.position || "left",
            });
          }
        } catch (e) {
          console.error("Auto place user in tree failed:", e);
        }
      }
    }

    const sectionA = allUserNodes.map((node) => {
      // In User MLM: volume comes strictly from Users (not Vendor)
      const left = Number(node.leftBalance) > 100 ? 0 : (Number(node.leftBalance) || 0);
      const right = Number(node.rightBalance) > 100 ? 0 : (Number(node.rightBalance) || 0);
      const pendingVolume = Math.abs(left - right);
      const matchedPotential = Math.min(left, right);
      return {
        id: node._id,
        entityId: node.entityId?._id || node.entityId,
        name: node.entityId?.name || "Customer",
        phone: node.entityId?.phone || "-",
        entityType: "User",
        leftBalance: left,
        rightBalance: right,
        unmatchedBalance: pendingVolume,
        potentialPairs: Math.floor(matchedPotential / PAIR_VALUE),
        status: left > 0 && right > 0 ? "Ready for Match" : "Pending Match (Section A)",
        level: node.level || 0,
        position: node.position || "root",
      };
    });

    return {
      poolSummary: {
        date: startOfDay.toISOString().split("T")[0],
        totalCustomerSubAmount,
        totalVendorFeeAmount,
        totalRiderFeeAmount,
        totalOrderCommissionAmount,
        grandTotalInflow,
        pairValue: PAIR_VALUE,
        totalGeneratedPoolIds,
        integerIds,
        remainingBalance,
      },
      sectionA: {
        title: "Section A - Pending (ID Not Generated / Waiting Balance)",
        count: sectionA.length,
        items: sectionA,
      },
      sectionB: {
        title: "Section B - Completed (ID Generated & Credited)",
        count: sectionB.length,
        items: sectionB,
      },
    };
  } catch (error) {
    console.error("Error in getPoolAndSectionsOverview:", error);
    throw error;
  }
};

