import asyncHandler from "../utils/AsyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import TenantService from "../services/tenant.service.js";

class TenantController {
  static createTenant = asyncHandler(async (req, res) => {
    const tenant = await TenantService.create(req.body, req.user);

    return res
      .status(201)
      .json(
        ApiResponse.success({ tenant }, "Tenant created successfully", 201)
      );
  });

  static getAllTenants = asyncHandler(async (req, res) => {
    const result = await TenantService.findAll(req.user, req.query);

    return res.status(200).json(
      ApiResponse.success(
        {
          tenants: result.data,
          meta: result.meta,
        },
        "Tenants fetched successfully",
        200
      )
    );
  });

  static getTenantById = asyncHandler(async (req, res) => {
    const tenant = await TenantService.findOne(req.params.id, req.user);

    return res
      .status(200)
      .json(
        ApiResponse.success({ tenant }, "Tenant fetched successfully", 200)
      );
  });

  static updateTenant = asyncHandler(async (req, res) => {
    const tenant = await TenantService.update(
      req.params.id,
      req.body,
      req.user
    );

    return res
      .status(200)
      .json(
        ApiResponse.success({ tenant }, "Tenant updated successfully", 200)
      );
  });

  static getAllDescendants = asyncHandler(async (req, res) => {
    const data = await TenantService.getAllDescendants(
      req.params,
      req.user,
      req.query
    );

    return res
      .status(200)
      .json(
        ApiResponse.success({ data }, "Descendants fetched successfully", 200)
      );
  });
}

export default TenantController;
