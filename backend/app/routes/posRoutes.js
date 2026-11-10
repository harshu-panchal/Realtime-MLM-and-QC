import express from "express";
import { verifyToken, allowRoles, requireApprovedSeller } from "../middleware/authMiddleware.js";
import { authRouteRateLimiter } from "../middleware/securityMiddlewares.js";
import * as c from "../controller/posController.js";

const router = express.Router();

/* ---------- Seller (shop owner) — manage counters, staff, bills, reports ---------- */
const seller = [verifyToken, allowRoles("seller"), requireApprovedSeller];
router.get("/seller/counters", ...seller, c.sellerListCounters);
router.post("/seller/counters", ...seller, c.sellerCreateCounter);
router.patch("/seller/counters/:id", ...seller, c.sellerUpdateCounter);
router.get("/seller/staff", ...seller, c.sellerListStaff);
router.post("/seller/staff", ...seller, c.sellerCreateStaff);
router.patch("/seller/staff/:id", ...seller, c.sellerUpdateStaff);
router.get("/seller/bills", ...seller, c.sellerListBills);
router.get("/seller/bills/:id", ...seller, c.sellerGetBill);
router.post("/seller/bills/:id/cancel", ...seller, c.sellerCancelBill);
router.get("/seller/report", ...seller, c.sellerReport);
router.get("/seller/shifts", ...seller, c.sellerListShifts);

/* ---------- Cashier — POS billing panel ---------- */
router.post("/login", authRouteRateLimiter, c.posLogin);
const cashier = [verifyToken, allowRoles("pos"), c.requirePosStaff];
router.get("/me", ...cashier, c.posMe);
router.post("/shift/open", ...cashier, c.posOpenShift);
router.post("/shift/close", ...cashier, c.posCloseShift);
router.get("/products", ...cashier, c.posSearchProducts);
router.post("/bills", ...cashier, c.posCreateBill);
router.get("/bills", ...cashier, c.posListBills);
router.get("/bills/:id", ...cashier, c.posGetBill);
router.post("/bills/:id/cancel", ...cashier, c.posCancelBill);

/* ---------- Admin — read-only POS reports across all sellers ---------- */
const admin = [verifyToken, allowRoles("admin")];
router.get("/admin/report", ...admin, c.adminPosReport);
router.get("/admin/sellers", ...admin, c.adminPosSellers);
router.get("/admin/bills", ...admin, c.adminListBills);
router.get("/admin/bills/:id", ...admin, c.adminGetBill);

export default router;
