import { Router } from "express";
import AuthMiddleware from "../middlewares/auth.middleware.js";
import EmployeeController from "../controllers/employee.controller.js";
import { validateRequest } from "../middlewares/validateRequest.js";
import upload from "../middlewares/multer.middleware.js";
import EmployeeValidationSchemas from "../validations/employeeValidation.schemas.js";

const employeeRoutes = Router();

// ✅ GET ALL EMPLOYEES BY PARENT ID
employeeRoutes.get(
  "/",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  EmployeeController.getAllEmployeesByParentId
);

// ✅ GET EMPLOYEE BY ID
employeeRoutes.get(
  "/:employeeId",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  EmployeeController.getEmployeeById
);

// ✅ REGISTER EMPLOYEE
employeeRoutes.post(
  "/register",
  upload.single("profileImage"),
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  validateRequest(EmployeeValidationSchemas.register),
  EmployeeController.register
);

// ✅ UPDATE EMPLOYEE PERMISSIONS
employeeRoutes.put(
  "/:employeeId/permissions",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  validateRequest(EmployeeValidationSchemas.updatePermissions),
  EmployeeController.updatePermissions
);

// ✅ UPDATE EMPLOYEE PROFILE
employeeRoutes.put(
  "/:employeeId/profile",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  validateRequest(EmployeeValidationSchemas.updateProfile),
  EmployeeController.updateProfile
);

// ✅ UPDATE EMPLOYEE PROFILE IMAGE
employeeRoutes.put(
  "/:employeeId/profile-image",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  upload.single("profileImage"),
  validateRequest(EmployeeValidationSchemas.updateProfileImage),
  EmployeeController.updateProfileImage
);

// ✅ GET EMPLOYEE PERMISSIONS
employeeRoutes.get(
  "/:employeeId/permissions",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  EmployeeController.getPermissions
);

// ✅ DEACTIVATE EMPLOYEE
employeeRoutes.patch(
  "/:employeeId/deactivate",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  validateRequest(EmployeeValidationSchemas.deactivateEmployee),
  EmployeeController.deactivateEmployee
);

// ✅ REACTIVATE EMPLOYEE
employeeRoutes.patch(
  "/:employeeId/reactivate",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  validateRequest(EmployeeValidationSchemas.reactivateEmployee),
  EmployeeController.reactivateEmployee
);

// ✅ DELETE EMPLOYEE
employeeRoutes.delete(
  "/:employeeId/delete",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize([
    "employee",
    "AZZUNIQUE",
    "RESELLER",
    "WHITE LABEL",
  ]),
  validateRequest(EmployeeValidationSchemas.deleteEmployee),
  EmployeeController.deleteEmployee
);

// ✅ CHECK SINGLE PERMISSION (For employees themselves)
employeeRoutes.post(
  "/check-permission",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize(["employee", "business"]),
  validateRequest(EmployeeValidationSchemas.checkPermission),
  EmployeeController.checkPermission
);

// ✅ CHECK MULTIPLE PERMISSIONS (For employees themselves)
employeeRoutes.post(
  "/check-permissions",
  AuthMiddleware.isAuthenticated,
  AuthMiddleware.authorize(["employee"]),
  validateRequest(EmployeeValidationSchemas.checkPermissions),
  EmployeeController.checkPermissions
);

export default employeeRoutes;
