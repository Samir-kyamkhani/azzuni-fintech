import { Router } from "express";
import AuthMiddleware from "../middlewares/auth.middleware.js";
import TenantController from "../controllers/tenant.controller.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import TenantValidationSchemas from "../validations/tenantValidation.schemas.js";

const tenantRoutes = Router();

// CREATE TENANT
tenantRoutes.post(
  "/create",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorizeRoleTypes(["AZZUNIQUE", "employee"]),
  validateRequest(TenantValidationSchemas.createTenant),
  TenantController.createTenant
);

// GET ALL TENANTS (UNDER CURRENT TENANT)
tenantRoutes.get(
  "/",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorizeRoleTypes(["business", "employee"]),
  TenantController.getAllTenants
);

// GET TENANT BY ID
tenantRoutes.get(
  "/:id",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorizeRoleTypes(["business", "employee"]),
  TenantController.getTenantById
);

// UPDATE TENANT
tenantRoutes.put(
  "/:id",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorizeRoleTypes(["business", "employee"]),
  validateRequest(TenantValidationSchemas.updateTenant),
  TenantController.updateTenant
);

// GET DESCENDANTS (CHILD TENANTS)
tenantRoutes.get(
  "/:tenantId/children",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorizeRoleTypes(["business", "employee"]),
  TenantController.getAllDescendants
);

export default tenantRoutes;
