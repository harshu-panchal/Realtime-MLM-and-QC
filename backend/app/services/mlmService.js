import MlmTree from "../models/mlmTree.js";
import MlmCommissionLog from "../models/mlmCommissionLog.js";
import Setting from "../models/setting.js";
import User from "../models/customer.js";
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
 * Calculates commission using Amount / 3.60 formula and applies dynamic daily capping (default ₹25,000) ONLY for Users.
 */
export const calculateAndDistributeCommission = async ({
  entityId,
  entityType,
  amount,
  orderId = null,
  remarks = "MLM Commission",
}) => {
  try {
    const rawAmount = Number(amount);
    if (!rawAmount || rawAmount <= 0 || isNaN(rawAmount)) {
      return { success: false, message: "Invalid amount for commission" };
    }

    // 1. Calculate Base Commission: Amount / 3.60
    const requestedAmount = Number((rawAmount / 3.60).toFixed(2));

    // 2. Fetch System Settings for user daily cap
    const setting = (await Setting.findOne().lean()) || {};
    const userDailyCap = Number(setting.userDailyCommissionCap ?? 25000);

    let creditedAmount = requestedAmount;
    let cappedAmount = 0;

    // 3. Apply Daily Commission Cap ONLY for User entity
    if (entityType === "User") {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

      // Aggregate today's total credited commissions for this User
      const todayLogs = await MlmCommissionLog.aggregate([
        {
          $match: {
            entityId: entityId._id || entityId,
            entityType: "User",
            date: { $gte: startOfDay, $lte: endOfDay },
          },
        },
        {
          $group: {
            _id: null,
            totalCredited: { $sum: "$creditedAmount" },
          },
        },
      ]);

      const alreadyCreditedToday = todayLogs.length > 0 ? todayLogs[0].totalCredited : 0;
      const remainingCap = Math.max(0, userDailyCap - alreadyCreditedToday);

      creditedAmount = Math.min(requestedAmount, remainingCap);
      cappedAmount = Number((requestedAmount - creditedAmount).toFixed(2));
    }

    // 4. Fetch tree info for logging
    const treeNode = await MlmTree.findOne({ entityId, entityType }).lean();
    const treeInfo = treeNode
      ? {
          sponsorId: treeNode.sponsorId,
          parentId: treeNode.parentId,
          position: treeNode.position,
          level: treeNode.level,
        }
      : {};

    // 5. Save MlmCommissionLog
    const log = await MlmCommissionLog.create({
      requestedAmount,
      creditedAmount,
      cappedAmount,
      date: new Date(),
      entityId,
      entityType,
      treeInfo,
      sourceOrderId: orderId,
      remarks,
    });

    // 6. Credit entity's wallet if creditedAmount > 0
    if (creditedAmount > 0) {
      const targetId = entityId._id || entityId;

      // Update or Create Wallet
      await Wallet.findOneAndUpdate(
        { ownerType: entityType.toUpperCase(), ownerId: targetId },
        {
          $inc: { availableBalance: creditedAmount, totalCredited: creditedAmount },
        },
        { upsert: true, new: true }
      );

      // If User entity, sync denormalized walletBalance field for compatibility
      if (entityType === "User") {
        await User.findByIdAndUpdate(targetId, {
          $inc: { walletBalance: creditedAmount },
        });
      }

      // Record Transaction
      await Transaction.create({
        user: targetId,
        userModel: entityType === "User" ? "User" : entityType,
        order: orderId,
        type: "Bonus",
        amount: creditedAmount,
        status: "Settled",
        reference: `MLM-COMM-${log._id}`,
        meta: {
          requestedAmount,
          creditedAmount,
          cappedAmount,
          formula: "Amount / 3.60",
        },
      });
    }

    return {
      success: true,
      requestedAmount,
      creditedAmount,
      cappedAmount,
      log,
    };
  } catch (error) {
    console.error("Error in calculateAndDistributeCommission:", error);
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
export const processBinaryCommission = async ({ entityId, entityType, source, amount }) => {
  try {
    const startNode = await MlmTree.findOne({ entityId, entityType });
    if (!startNode) return { success: false, message: "Node not found in MLM tree" };

    const setting = (await Setting.findOne().lean()) || {};
    const PAIR_VALUE = Number(setting.mlmPairValue ?? 3.60);
    const PER_ID_INCOME = Number(setting.mlmPerIdIncome ?? 0.002);
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
        await Wallet.findOneAndUpdate(
          { ownerType: currentNode.entityType.toUpperCase(), ownerId: currentNode.entityId },
          { $inc: { availableBalance: PER_ID_INCOME, totalCredited: PER_ID_INCOME } },
          { upsert: true, new: true }
        );

        await Transaction.create({
          user: currentNode.entityId,
          userModel: currentNode.entityModel,
          type: "Bonus",
          amount: PER_ID_INCOME,
          status: "Settled",
          reference: `MLM-PER-ID-${startNode._id}`,
          meta: { source, amount, note: "Per-ID Income 0.002" },
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
        // Using ownerType "ADMIN" to represent the Admin Wallet within the Wallet collection
        await Wallet.findOneAndUpdate(
          { ownerType: "ADMIN", ownerId: currentNode.entityId },
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
          remarks: `Matched ${pairs} pairs (${pairAmount}) sent to Admin Wallet for source: ${source}`,
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
