import express from "express";
import {
  getTree,
  calculateCommission,
  getCapStatus,
  getCommissionLogs,
  updateDailyCapSetting,
  getMlmOverview,
} from "../controller/mlmController.js";

const router = express.Router();

// Get Daily MLM Inflow Pool & Section A / Section B Breakdown
router.get("/overview", getMlmOverview);

// Get Binary Tree structure (Root or by entityId)
router.get("/tree", getTree);
router.get("/tree/:entityId", getTree);

// Calculate & Distribute Commission (Amount / 3.60, with User daily cap ₹25,000)
router.post("/calculate", calculateCommission);

// Get User Daily Commission Cap Status
router.get("/cap-status", getCapStatus);
router.get("/cap-status/:userId", getCapStatus);

// Get Commission Logs / History
router.get("/commissions", getCommissionLogs);

// Admin: Update Daily Cap Setting
router.put("/admin/cap-setting", updateDailyCapSetting);

export default router;
