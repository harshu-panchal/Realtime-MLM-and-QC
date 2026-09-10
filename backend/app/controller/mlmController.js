import handleResponse from "../utils/helper.js";
import {
  placeInTree,
  calculateAndDistributeCommission,
  getUserCapStatus,
  getTreeStructure,
} from "../services/mlmService.js";
import MlmCommissionLog from "../models/mlmCommissionLog.js";
import Setting from "../models/setting.js";

/* ===============================
   GET TREE STRUCTURE
================================ */
export const getTree = async (req, res) => {
  try {
    const entityId = req.params.entityId || req.user?.id || null;
    const tree = await getTreeStructure(entityId);
    return handleResponse(res, 200, "MLM Tree structure fetched successfully", tree);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CALCULATE & DISTRIBUTE COMMISSION
================================ */
export const calculateCommission = async (req, res) => {
  try {
    const { entityId, entityType, amount, orderId, remarks } = req.body;
    if (!entityId || !entityType || !amount) {
      return handleResponse(res, 400, "entityId, entityType, and amount are required");
    }

    const result = await calculateAndDistributeCommission({
      entityId,
      entityType,
      amount,
      orderId,
      remarks,
    });

    return handleResponse(res, 200, "Commission processed successfully", result);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET USER DAILY CAP STATUS
================================ */
export const getCapStatus = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?.id;
    if (!userId) {
      return handleResponse(res, 400, "userId is required");
    }

    const capStatus = await getUserCapStatus(userId);
    return handleResponse(res, 200, "User daily cap status fetched", capStatus);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   GET COMMISSION TRANSACTION LOGS
================================ */
export const getCommissionLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, entityId, entityType } = req.query;
    const filter = {};
    if (entityId) filter.entityId = entityId;
    if (entityType) filter.entityType = entityType;

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
    const perPage = Math.min(50, Math.max(1, parseInt(limit, 10)));

    const [logs, total] = await Promise.all([
      MlmCommissionLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(perPage)
        .lean(),
      MlmCommissionLog.countDocuments(filter),
    ]);

    return handleResponse(res, 200, "Commission logs fetched successfully", {
      logs,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / perPage) || 1,
    });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADMIN: UPDATE DAILY CAP SETTING
================================ */
export const updateDailyCapSetting = async (req, res) => {
  try {
    const { userDailyCommissionCap, mlmEnabled } = req.body;
    const update = {};
    if (userDailyCommissionCap !== undefined) update.userDailyCommissionCap = Number(userDailyCommissionCap);
    if (mlmEnabled !== undefined) update.mlmEnabled = Boolean(mlmEnabled);

    const setting = await Setting.findOneAndUpdate({}, { $set: update }, { new: true, upsert: true });
    return handleResponse(res, 200, "MLM Commission settings updated successfully", setting);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
