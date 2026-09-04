import handleResponse from "../../utils/helper.js";
import getPagination from "../../utils/pagination.js";
import {
  getPendingBusinessTypeChangeRequests,
  approveBusinessTypeChangeRequestById,
  rejectBusinessTypeChangeRequestById,
} from "../../services/admin/sellerBusinessTypeService.js";

export const getBusinessTypeChangeRequests = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 100,
    });

    const data = await getPendingBusinessTypeChangeRequests({ page, limit, skip });
    return handleResponse(res, 200, "Business type change requests fetched", data);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const approveBusinessTypeChangeRequest = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { adminNote } = req.body || {};
    const seller = await approveBusinessTypeChangeRequestById({
      sellerId,
      reviewedBy: req.user.id,
      adminNote,
    });

    if (!seller) {
      return handleResponse(res, 404, "No pending business type change request found for this seller");
    }

    return handleResponse(res, 200, "Business type change approved", seller);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const rejectBusinessTypeChangeRequest = async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { adminNote } = req.body || {};
    const seller = await rejectBusinessTypeChangeRequestById({
      sellerId,
      reviewedBy: req.user.id,
      adminNote,
    });

    if (!seller) {
      return handleResponse(res, 404, "No pending business type change request found for this seller");
    }

    return handleResponse(res, 200, "Business type change rejected", seller);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
