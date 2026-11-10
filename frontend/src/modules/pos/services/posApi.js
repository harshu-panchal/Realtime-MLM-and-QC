import axios from "axios";
import { resolveApiBaseUrl } from "@core/api/resolveApiBaseUrl";
import axiosInstance from "@core/api/axios";

/**
 * POS cashier API — its own axios instance + token so it never mixes with the
 * seller/admin/customer sessions handled by the shared axios interceptors.
 */
const POS_TOKEN_KEY = "pos_token";

export const getPosToken = () => {
  try {
    return localStorage.getItem(POS_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};
export const setPosToken = (token) => {
  try {
    if (token) localStorage.setItem(POS_TOKEN_KEY, token);
    else localStorage.removeItem(POS_TOKEN_KEY);
  } catch {
    /* storage blocked */
  }
};

const posHttp = axios.create({ baseURL: resolveApiBaseUrl(), timeout: 30000 });
posHttp.interceptors.request.use((config) => {
  const token = getPosToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const posApi = {
  login: (data) => posHttp.post("/pos/login", data),
  me: () => posHttp.get("/pos/me"),
  openShift: (data) => posHttp.post("/pos/shift/open", data),
  closeShift: (data) => posHttp.post("/pos/shift/close", data),
  searchProducts: (q) => posHttp.get("/pos/products", { params: { q } }),
  createBill: (data) => posHttp.post("/pos/bills", data),
  listBills: (params) => posHttp.get("/pos/bills", { params }),
  getBill: (id) => posHttp.get(`/pos/bills/${id}`),
  cancelBill: (id, reason) => posHttp.post(`/pos/bills/${id}/cancel`, { reason }),
};

/** Seller (shop owner) POS management — uses the normal seller session. */
export const posSellerApi = {
  listCounters: () => axiosInstance.get("/pos/seller/counters"),
  createCounter: (data) => axiosInstance.post("/pos/seller/counters", data),
  updateCounter: (id, data) => axiosInstance.patch(`/pos/seller/counters/${id}`, data),
  listStaff: () => axiosInstance.get("/pos/seller/staff"),
  createStaff: (data) => axiosInstance.post("/pos/seller/staff", data),
  updateStaff: (id, data) => axiosInstance.patch(`/pos/seller/staff/${id}`, data),
  listBills: (params) => axiosInstance.get("/pos/seller/bills", { params }),
  cancelBill: (id, reason) => axiosInstance.post(`/pos/seller/bills/${id}/cancel`, { reason }),
  report: (params) => axiosInstance.get("/pos/seller/report", { params }),
  listShifts: () => axiosInstance.get("/pos/seller/shifts"),
};
