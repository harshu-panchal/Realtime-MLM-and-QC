import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import PosCounter from "../models/posCounter.js";
import PosStaff from "../models/posStaff.js";
import PosShift from "../models/posShift.js";
import PosBill from "../models/posBill.js";
import Product from "../models/product.js";
import Seller from "../models/seller.js";
import Setting from "../models/setting.js";
import StockHistory from "../models/stockHistory.js";
import { reserveStockForItems } from "./stockService.js";

/**
 * POS (in-store counter billing).
 * NOTE: POS sales are intentionally kept OUT of MLM and the seller's online
 * wallet — nothing here calls mlmService or creates seller Transactions.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });
const isId = (id) => mongoose.Types.ObjectId.isValid(String(id || ""));
const cleanPhone = (p) => String(p || "").replace(/\D/g, "").slice(-10);

/* ---------------- Seller: counters ---------------- */
export async function listCounters(sellerId) {
  return PosCounter.find({ seller: sellerId }).sort({ createdAt: 1 }).lean();
}

export async function createCounter(sellerId, { name, code }) {
  name = String(name || "").trim();
  if (name.length < 1) throw httpError(400, "Counter name is required");
  let finalCode = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (!finalCode) {
    const count = await PosCounter.countDocuments({ seller: sellerId });
    finalCode = `C${count + 1}`;
  }
  try {
    return await PosCounter.create({ seller: sellerId, name, code: finalCode });
  } catch (e) {
    if (e.code === 11000) throw httpError(400, `Counter code ${finalCode} already exists`);
    throw e;
  }
}

export async function updateCounter(sellerId, id, { name, isActive }) {
  if (!isId(id)) throw httpError(400, "Invalid counter id");
  const set = {};
  if (name !== undefined) {
    if (!String(name).trim()) throw httpError(400, "Counter name is required");
    set.name = String(name).trim();
  }
  if (isActive !== undefined) set.isActive = Boolean(isActive);
  const counter = await PosCounter.findOneAndUpdate({ _id: id, seller: sellerId }, { $set: set }, { new: true });
  if (!counter) throw httpError(404, "Counter not found");
  return counter;
}

/* ---------------- Seller: staff ---------------- */
export async function listStaff(sellerId) {
  return PosStaff.find({ seller: sellerId }).populate("counter", "name code").sort({ createdAt: 1 }).lean();
}

async function assertOwnCounter(sellerId, counterId) {
  if (!isId(counterId)) throw httpError(400, "Please select a counter");
  const counter = await PosCounter.findOne({ _id: counterId, seller: sellerId }).lean();
  if (!counter) throw httpError(400, "Counter not found");
  return counter;
}

export async function createStaff(sellerId, { name, phone, pin, role, counter }) {
  name = String(name || "").trim();
  phone = cleanPhone(phone);
  pin = String(pin || "").trim();
  if (name.length < 2) throw httpError(400, "Staff name is required");
  if (!/^[6-9]\d{9}$/.test(phone)) throw httpError(400, "Enter a valid 10-digit mobile number");
  if (!/^\d{4,6}$/.test(pin)) throw httpError(400, "PIN must be 4 to 6 digits");
  await assertOwnCounter(sellerId, counter);
  try {
    const staff = await PosStaff.create({
      seller: sellerId,
      name,
      phone,
      pinHash: await bcrypt.hash(pin, 10),
      role: role === "manager" ? "manager" : "cashier",
      counter,
    });
    return PosStaff.findById(staff._id).populate("counter", "name code").lean();
  } catch (e) {
    if (e.code === 11000) throw httpError(400, "This mobile number is already used by another POS staff");
    throw e;
  }
}

export async function updateStaff(sellerId, id, { name, pin, role, counter, isActive }) {
  if (!isId(id)) throw httpError(400, "Invalid staff id");
  const set = {};
  if (name !== undefined) {
    if (String(name).trim().length < 2) throw httpError(400, "Staff name is required");
    set.name = String(name).trim();
  }
  if (pin !== undefined && String(pin).trim() !== "") {
    if (!/^\d{4,6}$/.test(String(pin).trim())) throw httpError(400, "PIN must be 4 to 6 digits");
    set.pinHash = await bcrypt.hash(String(pin).trim(), 10);
  }
  if (role !== undefined) set.role = role === "manager" ? "manager" : "cashier";
  if (counter !== undefined) {
    await assertOwnCounter(sellerId, counter);
    set.counter = counter;
  }
  if (isActive !== undefined) set.isActive = Boolean(isActive);
  const staff = await PosStaff.findOneAndUpdate({ _id: id, seller: sellerId }, { $set: set }, { new: true })
    .populate("counter", "name code")
    .lean();
  if (!staff) throw httpError(404, "Staff not found");
  return staff;
}

/* ---------------- Cashier login / context ---------------- */
function isSellerApproved(seller) {
  const status = seller?.applicationStatus || (seller?.isVerified ? "approved" : "pending");
  return seller?.isVerified === true && seller?.isActive === true && status === "approved";
}

export async function loginStaff({ phone, pin }) {
  phone = cleanPhone(phone);
  pin = String(pin || "").trim();
  if (!phone || !pin) throw httpError(400, "Mobile number and PIN are required");
  const staff = await PosStaff.findOne({ phone }).select("+pinHash");
  if (!staff || !(await bcrypt.compare(pin, staff.pinHash))) throw httpError(401, "Invalid mobile number or PIN");
  if (!staff.isActive) throw httpError(403, "Your POS account is disabled. Contact the shop owner.");
  const [seller, counter] = await Promise.all([
    Seller.findById(staff.seller).select("isVerified isActive applicationStatus shopName").lean(),
    PosCounter.findById(staff.counter).lean(),
  ]);
  if (!isSellerApproved(seller)) throw httpError(403, "This shop is not active right now");
  if (!counter?.isActive) throw httpError(403, "Your counter is disabled. Contact the shop owner.");
  staff.lastLoginAt = new Date();
  await staff.save();
  const token = jwt.sign({ id: staff._id, role: "pos" }, process.env.JWT_SECRET, { expiresIn: "16h" });
  return { token, ...(await getStaffContext(staff._id)) };
}

/** Loads and validates the logged-in cashier on every POS request. */
export async function getStaffContext(staffId) {
  if (!isId(staffId)) throw httpError(401, "Invalid POS session");
  const staff = await PosStaff.findById(staffId).populate("counter", "name code isActive").lean();
  if (!staff || !staff.isActive) throw httpError(401, "POS session is no longer valid");
  const seller = await Seller.findById(staff.seller)
    .select("isVerified isActive applicationStatus shopName name phone address")
    .lean();
  if (!isSellerApproved(seller)) throw httpError(403, "This shop is not active right now");
  if (!staff.counter?.isActive) throw httpError(403, "Your counter is disabled");
  const shift = await PosShift.findOne({ counter: staff.counter._id, status: "open" }).lean();
  return {
    staff: { _id: staff._id, name: staff.name, phone: staff.phone, role: staff.role },
    counter: staff.counter,
    shop: { _id: seller._id, shopName: seller.shopName || seller.name, phone: seller.phone, address: seller.address || "" },
    shift,
  };
}

/* ---------------- Shift ---------------- */
export async function openShift(ctx, { openingCash }) {
  const cash = Number(openingCash ?? 0);
  if (!Number.isFinite(cash) || cash < 0) throw httpError(400, "Opening cash must be 0 or more");
  if (ctx.shift) throw httpError(409, "A shift is already open on this counter");
  try {
    return await PosShift.create({
      seller: ctx.shop._id,
      counter: ctx.counter._id,
      staff: ctx.staff._id,
      openingCash: round2(cash),
    });
  } catch (e) {
    if (e.code === 11000) throw httpError(409, "A shift is already open on this counter");
    throw e;
  }
}

async function computeShiftTotals(shiftId) {
  const rows = await PosBill.aggregate([
    { $match: { shift: new mongoose.Types.ObjectId(String(shiftId)), status: "completed" } },
    { $group: { _id: "$paymentMode", amount: { $sum: "$total" }, count: { $sum: 1 } } },
  ]);
  const totals = { billCount: 0, cash: 0, upi: 0, card: 0, grandTotal: 0 };
  for (const r of rows) {
    totals[r._id] = round2(r.amount);
    totals.billCount += r.count;
    totals.grandTotal = round2(totals.grandTotal + r.amount);
  }
  return totals;
}

export async function getShiftSummary(ctx) {
  if (!ctx.shift) return null;
  const totals = await computeShiftTotals(ctx.shift._id);
  return { ...ctx.shift, totals, expectedCash: round2(ctx.shift.openingCash + totals.cash) };
}

export async function closeShift(ctx, { closingCash, note }) {
  if (!ctx.shift) throw httpError(409, "No open shift on this counter");
  const counted = Number(closingCash);
  if (!Number.isFinite(counted) || counted < 0) throw httpError(400, "Enter the cash counted in the drawer");
  const totals = await computeShiftTotals(ctx.shift._id);
  const expectedCash = round2(ctx.shift.openingCash + totals.cash);
  const shift = await PosShift.findOneAndUpdate(
    { _id: ctx.shift._id, status: "open" },
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        totals,
        expectedCash,
        closingCash: round2(counted),
        cashDifference: round2(counted - expectedCash),
        closingNote: String(note || "").trim(),
      },
    },
    { new: true },
  );
  if (!shift) throw httpError(409, "Shift already closed");
  return shift;
}

/* ---------------- Products for billing ---------------- */
function unitPriceOf(product, variant) {
  const src = variant || product;
  const sale = Number(src.salePrice || 0);
  const price = Number(src.price || 0);
  return round2(sale > 0 && (price <= 0 || sale <= price) ? sale : price);
}

export async function searchProducts(sellerId, q) {
  const term = String(q || "").trim();
  const filter = { sellerId };
  if (term) {
    const rx = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ name: rx }, { sku: rx }, { "variants.sku": rx }, { brand: rx }];
  }
  const products = await Product.find(filter)
    .select("name sku price salePrice stock mainImage variants brand status")
    .sort({ name: 1 })
    .limit(30)
    .lean();
  return products.map((p) => ({
    _id: p._id,
    name: p.name,
    sku: p.sku || "",
    image: p.mainImage || "",
    stock: p.stock,
    unitPrice: unitPriceOf(p),
    status: p.status,
    variants: (p.variants || []).map((v) => ({
      sku: v.sku || "",
      name: v.name || "",
      stock: v.stock ?? 0,
      unitPrice: unitPriceOf(p, v),
    })),
  }));
}

/* ---------------- Bills ---------------- */
export async function createBill(ctx, body = {}) {
  if (!ctx.shift) throw httpError(409, "Open a shift before billing");
  const sellerId = ctx.shop._id;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw httpError(400, "Add at least one product");
  const paymentMode = ["cash", "upi", "card"].includes(body.paymentMode) ? body.paymentMode : null;
  if (!paymentMode) throw httpError(400, "Select a payment mode");

  // Merge duplicate lines, validate quantity.
  const merged = new Map();
  for (const it of rawItems) {
    const qty = Math.floor(Number(it.quantity));
    if (!isId(it.productId) || !Number.isFinite(qty) || qty < 1) throw httpError(400, "Invalid product or quantity");
    const key = `${it.productId}|${String(it.variantSku || "").trim()}`;
    const prev = merged.get(key);
    merged.set(key, { productId: String(it.productId), variantSku: String(it.variantSku || "").trim(), quantity: (prev?.quantity || 0) + qty });
  }

  // Prices always from DB; products must belong to this seller.
  const ids = [...new Set([...merged.values()].map((m) => m.productId))];
  const products = await Product.find({ _id: { $in: ids }, sellerId }).select("name price salePrice variants").lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const lines = [];
  for (const m of merged.values()) {
    const p = byId.get(m.productId);
    if (!p) throw httpError(400, "A product in the cart does not belong to this shop");
    let variant = null;
    if (m.variantSku) {
      variant = (p.variants || []).find((v) => String(v.sku || "").trim() === m.variantSku);
      if (!variant) throw httpError(400, `Variant not found for ${p.name}`);
    }
    const unitPrice = unitPriceOf(p, variant);
    lines.push({
      product: p._id,
      name: p.name,
      variantSku: m.variantSku,
      variantName: variant?.name || "",
      unitPrice,
      quantity: m.quantity,
      lineTotal: round2(unitPrice * m.quantity),
    });
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discount = round2(Math.min(Math.max(0, Number(body.discount) || 0), subtotal));
  const total = round2(subtotal - discount);
  let cashReceived = 0;
  let changeReturned = 0;
  if (paymentMode === "cash") {
    cashReceived = round2(body.cashReceived ?? total);
    if (cashReceived < total) throw httpError(400, "Cash received is less than the bill total");
    changeReturned = round2(cashReceived - total);
  }

  const setting = (await Setting.findOne().select("posCommissionPercent").lean()) || {};
  const commissionPercent = Math.min(100, Math.max(0, Number(setting.posCommissionPercent ?? 0)));
  const commissionAmount = round2((total * commissionPercent) / 100);

  // Per-counter bill number (atomic sequence).
  const counter = await PosCounter.findOneAndUpdate(
    { _id: ctx.counter._id, seller: sellerId },
    { $inc: { billSeq: 1 } },
    { new: true },
  );
  const billNumber = `${counter.code}-${String(counter.billSeq).padStart(5, "0")}`;

  // Stock decrement + bill creation in one DB transaction (no overselling across counters).
  const session = await mongoose.startSession();
  let bill;
  try {
    await session.withTransaction(async () => {
      await reserveStockForItems({
        items: lines.map((l) => ({
          productId: l.product,
          quantity: l.quantity,
          variantSku: l.variantSku,
          productName: l.name,
        })),
        sellerId,
        orderId: `POS ${billNumber}`,
        session,
        paymentMode: "COD", // → StockHistory type "Sale"
      });
      [bill] = await PosBill.create(
        [
          {
            seller: sellerId,
            counter: ctx.counter._id,
            staff: ctx.staff._id,
            shift: ctx.shift._id,
            billNumber,
            items: lines,
            subtotal,
            discount,
            total,
            paymentMode,
            cashReceived,
            changeReturned,
            customerName: String(body.customerName || "").trim().slice(0, 80),
            customerPhone: cleanPhone(body.customerPhone),
            commissionPercent,
            commissionAmount,
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  return bill.toObject();
}

export async function cancelBill({ sellerId, billId, reason, cancelledBy }) {
  if (!isId(billId)) throw httpError(400, "Invalid bill id");
  const session = await mongoose.startSession();
  let bill;
  try {
    await session.withTransaction(async () => {
      bill = await PosBill.findOneAndUpdate(
        { _id: billId, seller: sellerId, status: "completed" },
        {
          $set: {
            status: "cancelled",
            cancelledAt: new Date(),
            cancelReason: String(reason || "").trim() || "Cancelled",
            cancelledBy,
          },
        },
        { new: true, session },
      );
      if (!bill) throw httpError(404, "Bill not found or already cancelled");
      // Return stock.
      for (const l of bill.items) {
        if (l.variantSku) {
          await Product.updateOne(
            { _id: l.product, "variants.sku": l.variantSku },
            { $inc: { stock: l.quantity, "variants.$.stock": l.quantity } },
            { session },
          );
        } else {
          await Product.updateOne({ _id: l.product }, { $inc: { stock: l.quantity } }, { session });
        }
        await StockHistory.create(
          [
            {
              product: l.product,
              seller: sellerId,
              type: "Correction",
              quantity: l.quantity,
              note: `POS ${bill.billNumber} cancelled${l.variantSku ? ` [variant: ${l.variantSku}]` : ""}`,
            },
          ],
          { session },
        );
      }
    });
  } finally {
    await session.endSession();
  }
  return bill.toObject();
}

export async function listBills({ sellerId, counterId, from, to, status, q, page = 1, limit = 20, withSeller = false }) {
  const filter = {};
  if (sellerId) {
    if (!isId(sellerId)) throw httpError(400, "Invalid seller id");
    filter.seller = sellerId;
  }
  if (counterId && isId(counterId)) filter.counter = counterId;
  if (status === "completed" || status === "cancelled") filter.status = status;
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  if (Object.keys(range).length) filter.createdAt = range;
  if (q) {
    const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ billNumber: rx }, { customerPhone: rx }, { customerName: rx }];
  }
  page = Math.max(1, Number(page) || 1);
  limit = Math.min(100, Math.max(1, Number(limit) || 20));
  let billsQuery = PosBill.find(filter).populate("counter", "name code").populate("staff", "name");
  if (withSeller) billsQuery = billsQuery.populate("seller", "shopName name phone");
  const [items, total] = await Promise.all([
    billsQuery.sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    PosBill.countDocuments(filter),
  ]);
  return { items, total, page, limit, totalPages: Math.ceil(total / limit) || 1 };
}

export async function getBill(sellerId, billId) {
  if (!isId(billId)) throw httpError(400, "Invalid bill id");
  const bill = await PosBill.findOne({ _id: billId, seller: sellerId })
    .populate("counter", "name code")
    .populate("staff", "name")
    .lean();
  if (!bill) throw httpError(404, "Bill not found");
  return bill;
}

export async function getSalesReport(sellerId, { from, to }) {
  const match = { seller: new mongoose.Types.ObjectId(String(sellerId)) };
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  if (Object.keys(range).length) match.createdAt = range;

  const [summary, byPayment, byCounter, byStaff] = await Promise.all([
    PosBill.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total: { $sum: "$total" },
          discount: { $sum: "$discount" },
          commission: { $sum: "$commissionAmount" },
        },
      },
    ]),
    PosBill.aggregate([
      { $match: { ...match, status: "completed" } },
      { $group: { _id: "$paymentMode", total: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
    PosBill.aggregate([
      { $match: { ...match, status: "completed" } },
      { $group: { _id: "$counter", total: { $sum: "$total" }, count: { $sum: 1 } } },
      { $lookup: { from: "poscounters", localField: "_id", foreignField: "_id", as: "c" } },
      { $project: { total: 1, count: 1, name: { $arrayElemAt: ["$c.name", 0] }, code: { $arrayElemAt: ["$c.code", 0] } } },
      { $sort: { total: -1 } },
    ]),
    PosBill.aggregate([
      { $match: { ...match, status: "completed" } },
      { $group: { _id: "$staff", total: { $sum: "$total" }, count: { $sum: 1 } } },
      { $lookup: { from: "posstaffs", localField: "_id", foreignField: "_id", as: "s" } },
      { $project: { total: 1, count: 1, name: { $arrayElemAt: ["$s.name", 0] } } },
      { $sort: { total: -1 } },
    ]),
  ]);

  const done = summary.find((s) => s._id === "completed") || {};
  const cancelled = summary.find((s) => s._id === "cancelled") || {};
  return {
    billCount: done.count || 0,
    salesTotal: round2(done.total),
    discountTotal: round2(done.discount),
    commissionTotal: round2(done.commission),
    cancelledCount: cancelled.count || 0,
    cancelledTotal: round2(cancelled.total),
    byPayment: byPayment.map((r) => ({ mode: r._id, total: round2(r.total), count: r.count })),
    byCounter: byCounter.map((r) => ({ counterId: r._id, name: r.name, code: r.code, total: round2(r.total), count: r.count })),
    byStaff: byStaff.map((r) => ({ staffId: r._id, name: r.name, total: round2(r.total), count: r.count })),
  };
}

export async function listShifts(sellerId, { limit = 30 } = {}) {
  return PosShift.find({ seller: sellerId })
    .populate("counter", "name code")
    .populate("staff", "name")
    .sort({ openedAt: -1 })
    .limit(Math.min(100, Number(limit) || 30))
    .lean();
}


/* ---------------- Admin (read-only) ---------------- */
/** Platform-wide POS report across all sellers (or one seller). */
export async function getAdminPosReport({ from, to, sellerId } = {}) {
  const match = {};
  if (sellerId) {
    if (!isId(sellerId)) throw httpError(400, "Invalid seller id");
    match.seller = new mongoose.Types.ObjectId(String(sellerId));
  }
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  if (Object.keys(range).length) match.createdAt = range;

  const [summary, byPayment, bySeller, setup] = await Promise.all([
    PosBill.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: "$total" }, discount: { $sum: "$discount" }, commission: { $sum: "$commissionAmount" } } },
    ]),
    PosBill.aggregate([
      { $match: { ...match, status: "completed" } },
      { $group: { _id: "$paymentMode", total: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
    PosBill.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$seller",
          billCount: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          salesTotal: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$total", 0] } },
          commission: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$commissionAmount", 0] } },
          cancelledCount: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          lastBillAt: { $max: "$createdAt" },
        },
      },
      { $lookup: { from: "sellers", localField: "_id", foreignField: "_id", as: "s" } },
      {
        $project: {
          billCount: 1, salesTotal: 1, commission: 1, cancelledCount: 1, lastBillAt: 1,
          shopName: { $arrayElemAt: ["$s.shopName", 0] },
          ownerName: { $arrayElemAt: ["$s.name", 0] },
          phone: { $arrayElemAt: ["$s.phone", 0] },
        },
      },
      { $sort: { salesTotal: -1 } },
    ]),
    Promise.all([
      PosCounter.countDocuments(sellerId ? { seller: sellerId } : {}),
      PosStaff.countDocuments(sellerId ? { seller: sellerId } : {}),
      PosShift.countDocuments({ ...(sellerId ? { seller: sellerId } : {}), status: "open" }),
      PosCounter.distinct("seller"),
    ]),
  ]);

  const done = summary.find((x) => x._id === "completed") || {};
  const cancelled = summary.find((x) => x._id === "cancelled") || {};
  const [counterCount, staffCount, openShifts, sellersWithPos] = setup;
  return {
    billCount: done.count || 0,
    salesTotal: round2(done.total),
    discountTotal: round2(done.discount),
    commissionTotal: round2(done.commission),
    cancelledCount: cancelled.count || 0,
    cancelledTotal: round2(cancelled.total),
    counterCount,
    staffCount,
    openShifts,
    sellersUsingPos: sellersWithPos.length,
    byPayment: byPayment.map((r) => ({ mode: r._id, total: round2(r.total), count: r.count })),
    bySeller: bySeller.map((r) => ({
      sellerId: r._id,
      shopName: r.shopName || r.ownerName || "-",
      ownerName: r.ownerName || "",
      phone: r.phone || "",
      billCount: r.billCount,
      salesTotal: round2(r.salesTotal),
      commission: round2(r.commission),
      cancelledCount: r.cancelledCount,
      lastBillAt: r.lastBillAt,
    })),
  };
}

/** Sellers that have set up POS (for the admin seller filter). */
export async function listPosSellers() {
  const ids = await PosCounter.distinct("seller");
  return Seller.find({ _id: { $in: ids } }).select("shopName name phone").sort({ shopName: 1 }).lean();
}

export async function getAdminBill(billId) {
  if (!isId(billId)) throw httpError(400, "Invalid bill id");
  const bill = await PosBill.findById(billId)
    .populate("counter", "name code")
    .populate("staff", "name")
    .populate("seller", "shopName name phone address")
    .lean();
  if (!bill) throw httpError(404, "Bill not found");
  return bill;
}
