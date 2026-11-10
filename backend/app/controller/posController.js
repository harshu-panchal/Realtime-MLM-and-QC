import handleResponse from "../utils/helper.js";
import * as pos from "../services/posService.js";

const wrap = (fn, message = "OK", okStatus = 200) => async (req, res) => {
  try {
    const result = await fn(req);
    return handleResponse(res, okStatus, message, result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/** Loads the logged-in POS cashier (role "pos") → req.pos */
export const requirePosStaff = async (req, res, next) => {
  try {
    req.pos = await pos.getStaffContext(req.user?.id);
    next();
  } catch (error) {
    return handleResponse(res, error.statusCode || 401, error.message);
  }
};

/* ---------- Seller (shop owner) ---------- */
export const sellerListCounters = wrap((req) => pos.listCounters(req.user.id), "Counters fetched");
export const sellerCreateCounter = wrap((req) => pos.createCounter(req.user.id, req.body || {}), "Counter created", 201);
export const sellerUpdateCounter = wrap((req) => pos.updateCounter(req.user.id, req.params.id, req.body || {}), "Counter updated");
export const sellerListStaff = wrap((req) => pos.listStaff(req.user.id), "Staff fetched");
export const sellerCreateStaff = wrap((req) => pos.createStaff(req.user.id, req.body || {}), "Staff created", 201);
export const sellerUpdateStaff = wrap((req) => pos.updateStaff(req.user.id, req.params.id, req.body || {}), "Staff updated");
export const sellerListBills = wrap((req) => pos.listBills({ ...req.query, sellerId: req.user.id }), "Bills fetched");
export const sellerGetBill = wrap((req) => pos.getBill(req.user.id, req.params.id), "Bill fetched");
export const sellerCancelBill = wrap(
  (req) => pos.cancelBill({ sellerId: req.user.id, billId: req.params.id, reason: req.body?.reason, cancelledBy: "Shop owner" }),
  "Bill cancelled",
);
export const sellerReport = wrap((req) => pos.getSalesReport(req.user.id, req.query || {}), "POS report fetched");
export const sellerListShifts = wrap((req) => pos.listShifts(req.user.id, req.query || {}), "Shifts fetched");

/* ---------- Cashier (POS panel) ---------- */
export const posLogin = wrap((req) => pos.loginStaff(req.body || {}), "Logged in");
export const posMe = wrap(async (req) => ({ ...req.pos, shift: await pos.getShiftSummary(req.pos) }), "POS session");
export const posOpenShift = wrap((req) => pos.openShift(req.pos, req.body || {}), "Shift opened", 201);
export const posCloseShift = wrap((req) => pos.closeShift(req.pos, req.body || {}), "Shift closed");
export const posSearchProducts = wrap((req) => pos.searchProducts(req.pos.shop._id, req.query.q), "Products fetched");
export const posCreateBill = wrap((req) => pos.createBill(req.pos, req.body || {}), "Bill created", 201);
export const posListBills = wrap(
  // Cashier sees only their own counter's bills (counterId cannot be overridden from the query).
  (req) => pos.listBills({ ...req.query, sellerId: req.pos.shop._id, counterId: req.pos.counter._id }),
  "Bills fetched",
);
export const posGetBill = wrap((req) => pos.getBill(req.pos.shop._id, req.params.id), "Bill fetched");
export const posCancelBill = wrap(async (req) => {
  if (req.pos.staff.role !== "manager") {
    const err = new Error("Only a manager or the shop owner can cancel a bill");
    err.statusCode = 403;
    throw err;
  }
  return pos.cancelBill({
    sellerId: req.pos.shop._id,
    billId: req.params.id,
    reason: req.body?.reason,
    cancelledBy: `Manager: ${req.pos.staff.name}`,
  });
}, "Bill cancelled");

/* ---------- Admin (read-only POS monitoring) ---------- */
export const adminPosReport = wrap((req) => pos.getAdminPosReport(req.query || {}), "POS report fetched");
export const adminPosSellers = wrap(() => pos.listPosSellers(), "POS sellers fetched");
export const adminListBills = wrap(
  (req) => pos.listBills({ ...req.query, sellerId: req.query.sellerId || undefined, withSeller: true }),
  "POS bills fetched",
);
export const adminGetBill = wrap((req) => pos.getAdminBill(req.params.id), "POS bill fetched");
