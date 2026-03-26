import { ROLE_HIERARCHY } from "../config/constant.js";
import Prisma from "../db/db.js";
import { ApiError } from "../utils/ApiError.js";
import { CryptoService } from "../utils/cryptoService.js";
import Helper from "../utils/helper.js";
import S3Service from "../utils/S3Service.js";
import { sendCredentialsEmail } from "../utils/sendCredentialsEmail.js";
import AuditLogService from "./auditLog.service.js";

class UserServices {
  // BUSINESS USER REGISTRATION
  static async register(payload, req = null, res = null) {
    const {
      username,
      firstName,
      lastName,
      profileImage,
      email,
      phoneNumber,
      roleId,
      parentId,
      tenantName,
      tenantType,
      tenantLegalName,
    } = payload;

    let profileImageUrl = "";

    try {
      // 🔥 VALIDATION FIRST (before any database operations)
      const existingUser = await Prisma.user.findFirst({
        where: {
          OR: [{ email }, { phoneNumber }, { username }],
        },
      });

      if (existingUser) {
        await AuditLogService.createAuditLog({
          userId: parentId,
          action: "BUSINESS_USER_REGISTRATION_FAILED",
          entityType: "USER",
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "USER_ALREADY_EXISTS",
            roleName: req.user?.role,
            email,
            phoneNumber,
            username,
            registeredBy: parentId,
          },
        });
        throw ApiError.badRequest("User already exists");
      }

      const role = await Prisma.role.findUnique({ where: { id: roleId } });
      if (!role) {
        await AuditLogService.createAuditLog({
          userId: parentId,
          action: "BUSINESS_USER_REGISTRATION_FAILED",
          entityType: "USER",
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "INVALID_ROLE_ID",
            roleName: req.user?.role,
            roleId,
            registeredBy: parentId,
          },
        });
        throw ApiError.badRequest("Invalid roleId");
      }

      // Ensure only business roles are assigned
      if (role.type !== "business") {
        await AuditLogService.createAuditLog({
          userId: parentId,
          action: "BUSINESS_USER_REGISTRATION_FAILED",
          entityType: "USER",
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "NON_BUSINESS_ROLE",
            roleName: role.name,
            roleType: role.type,
            registeredBy: parentId,
          },
        });
        throw ApiError.badRequest("Only business type roles can be assigned");
      }

      let hierarchyLevel = 0;
      let hierarchyPath = "";
      let parentWithRole;
      let childRoleName = role.name;

      if (parentId) {
        parentWithRole = await Prisma.user.findUnique({
          where: { id: parentId },
          include: {
            role: true,
            tenants: {
              select: {
                id: true,
                userType: true,
              },
              take: 1,
            },
          },
        });

        if (!parentWithRole) {
          await AuditLogService.createAuditLog({
            userId: parentId,
            action: "BUSINESS_USER_REGISTRATION_FAILED",
            entityType: "USER",
            ipAddress: req ? Helper.getClientIP(req) : null,
            metadata: {
              ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
              reason: "INVALID_PARENT_ID",
              roleName: req.user?.role,
              parentId,
              registeredBy: parentId,
            },
          });
          throw ApiError.badRequest("Invalid parentId");
        }

        // 🔥 parent ka actual business role
        let parentRoleName =
          parentWithRole.role.type === "employee"
            ? parentWithRole.tenants?.[0]?.userType
            : parentWithRole.role.name;

        // 🔥 VALIDATION
        const parentRoleKey = Helper.normalizeRole(parentRoleName);
        const childRoleKey = Helper.normalizeRole(childRoleName);

        if (!ROLE_HIERARCHY[parentRoleKey]) {
          throw ApiError.forbidden(
            `Invalid hierarchy: ${parentRoleName} cannot create roles`
          );
        }

        const allowedRoles = ROLE_HIERARCHY[parentRoleKey];

        if (!allowedRoles.includes(childRoleKey)) {
          throw ApiError.forbidden(
            `${parentRoleName} can only create: ${allowedRoles.join(", ")}`
          );
        }

        hierarchyLevel = parentWithRole.hierarchyLevel + 1;
        hierarchyPath = parentWithRole.hierarchyPath
          ? `${parentWithRole.hierarchyPath}/${parentId}`
          : `${parentId}`;
      }

      // 🔥 Upload profile image if provided
      if (profileImage) {
        try {
          profileImageUrl =
            (await S3Service.upload(profileImage, "profile")) ?? "";
        } catch (uploadErr) {
          console.warn("Profile image upload failed:", uploadErr);
        }
      }

      const formattedFirstName = this.formatName(firstName);
      const formattedLastName = this.formatName(lastName);
      const generatedPassword = Helper.generatePassword();
      const generatedTransactionPin = Helper.generateTransactionPin();
      const hashedPassword = CryptoService.encrypt(generatedPassword);
      const hashedPin = CryptoService.encrypt(generatedTransactionPin);

      // 🔥 USE TRANSACTION FOR ATOMIC OPERATIONS
      const result = await Prisma.$transaction(async (tx) => {
        // Create user
        const user = await tx.user.create({
          data: {
            username,
            firstName: formattedFirstName,
            lastName: formattedLastName,
            profileImage: profileImageUrl,
            email,
            phoneNumber,
            password: hashedPassword,
            transactionPin: hashedPin,
            roleId,
            parentId,
            hierarchyLevel,
            hierarchyPath,
            status: "IN_ACTIVE",
            deactivationReason:
              "Kindly contact the administrator to have your account activated.",
            isKycVerified: false,
            refreshToken: null,
            passwordResetToken: null,
            passwordResetExpires: null,
            emailVerificationToken: null,
            emailVerifiedAt: null,
            emailVerificationTokenExpires: null,
          },
          include: {
            role: {
              select: { id: true, name: true, level: true, description: true },
            },
            parent: {
              select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                email: true,
                phoneNumber: true,
                profileImage: true,
              },
            },
          },
        });

        // 🔥 Create wallets
        const isTopWalletRole =
          childRoleName === "RESELLER" || childRoleName === "WHITE LABEL";

        const walletsToCreate = [
          { walletType: "PRIMARY", userId: user.id },
          { walletType: "COMMISSION", userId: user.id },
        ];

        if (isTopWalletRole) {
          walletsToCreate.push(
            { walletType: "GST", userId: user.id },
            { walletType: "TDS", userId: user.id }
          );
        }

        await tx.wallet.createMany({
          data: walletsToCreate.map((w) => ({
            ...w,
            balance: BigInt(0),
            holdBalance: BigInt(0),
            currency: "INR",
            isActive: true,
            version: 1,
          })),
        });

        // 🔥 Create tenant if needed
        const isTenantRole =
          childRoleName === "RESELLER" || childRoleName === "WHITE LABEL";

        if (isTenantRole) {
          if (!tenantName || !tenantType) {
            throw ApiError.badRequest(
              "tenantName and tenantType are required for tenant roles"
            );
          }

          const tenantPrefix = Helper.generatePrefix("TNT");

          await tx.tenant.create({
            data: {
              tenantNumber: Helper.generateNumber(tenantPrefix),
              tenantName,
              tenantLegalName: tenantLegalName || tenantName,
              tenantType,
              userType: Helper.normalizeRole(childRoleName),
              tenantEmail: email,
              tenantWhatsapp: phoneNumber,
              tenantMobileNumber: phoneNumber,
              parentTenantId: parentWithRole?.tenants?.[0]?.id || null,
              createdByUserId: parentId,
              tenantStatus: "ACTIVE",
            },
          });
        }

        return user;
      });

      // 🔥 Send email (outside transaction)
      await sendCredentialsEmail(
        result,
        generatedPassword,
        generatedTransactionPin,
        "created",
        "Your business account has been successfully created. Here are your login credentials:",
        "business"
      );

      const accessToken = Helper.generateAccessToken({
        id: result.id,
        email: result.email,
        role: result.role.name,
        roleLevel: result.role.level,
      });

      await AuditLogService.createAuditLog({
        userId: parentId,
        action: "BUSINESS_USER_REGISTERED",
        entityType: "USER",
        entityId: result.id,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          businessUserName: `${formattedFirstName} ${formattedLastName}`,
          businessUserEmail: result.email,
          roleName: req.user?.role,
          hierarchyLevel: result.hierarchyLevel,
          hasProfileImage: !!profileImageUrl,
          registeredBy: parentId,
        },
      });

      // 🔥 Fetch complete user data with relations
      const completeUser = await Prisma.user.findUnique({
        where: { id: result.id },
        include: {
          role: {
            select: { id: true, name: true, level: true, description: true },
          },
          wallets: true,
          parent: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
          children: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
              status: true,
              createdAt: true,
            },
          },
          bankAccounts: {
            where: {
              status: "VERIFIED",
            },
            orderBy: {
              isPrimary: "desc",
            },
          },
        },
      });

      return { user: completeUser, accessToken };
    } catch (err) {
      console.error("Business user registration error", {
        email,
        error: err.message,
        stack: err.stack,
      });

      if (err instanceof ApiError) throw err;

      await AuditLogService.createAuditLog({
        userId: parentId,
        action: "BUSINESS_USER_REGISTRATION_FAILED",
        entityType: "USER",
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "UNKNOWN_ERROR",
          roleName: req.user?.role,
          error: err.message,
          registeredBy: parentId,
        },
      });

      throw ApiError.internal(
        "Failed to register business user. Please try again.",
        err?.message
      );
    } finally {
      if (profileImage) {
        Helper.deleteOldImage(profileImage);
      }
    }
  }

  // BUSINESS USER PROFILE UPDATE
  static async updateProfile(
    userId,
    updateData,
    currentUserId,
    req = null,
    res = null
  ) {
    const { username, phoneNumber, firstName, lastName, email } = updateData;

    // 🔥 Fetch users with necessary relations
    const [currentUser, userToUpdate] = await Promise.all([
      Prisma.user.findUnique({
        where: { id: currentUserId },
        include: {
          role: { select: { name: true, type: true } },
          tenants: { select: { id: true, userType: true }, take: 1 },
        },
      }),
      Prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: { select: { name: true, type: true, level: true } },
          tenants: true,
        },
      }),
    ]);

    if (!currentUser) {
      throw ApiError.unauthorized("Current user not found");
    }

    if (!userToUpdate) {
      throw ApiError.notFound("User not found");
    }

    if (userToUpdate.role.type !== "business") {
      throw ApiError.badRequest("Only business users can be updated");
    }

    const isSelf = currentUserId === userId;

    // 🔥 Current role resolution
    const currentRoleName =
      currentUser.role.type === "employee"
        ? currentUser.tenants?.[0]?.userType
        : currentUser.role.name;

    const currentRoleKey = Helper.normalizeRole(currentRoleName);
    const targetRoleKey = Helper.normalizeRole(userToUpdate.role.name);

    const allowedRoles = ROLE_HIERARCHY[currentRoleKey] || [];

    // 🔥 Hierarchy check (only for updating others)
    if (!isSelf && !allowedRoles.includes(targetRoleKey)) {
      throw ApiError.forbidden("You cannot update this user");
    }

    // 🔥 Email change control
    const isEmailChanged = email && email !== userToUpdate.email;
    const canChangeEmail = ["AZZUNIQUE", "RESELLER"].includes(currentRoleKey);

    if (isEmailChanged && !canChangeEmail) {
      throw ApiError.forbidden("Not allowed to change email");
    }

    // 🔥 Unique check
    if (username || phoneNumber || email) {
      const existing = await Prisma.user.findFirst({
        where: {
          id: { not: userId },
          OR: [
            ...(username ? [{ username }] : []),
            ...(phoneNumber ? [{ phoneNumber }] : []),
            ...(email ? [{ email }] : []),
          ],
        },
      });

      if (existing) {
        if (existing.username === username)
          throw ApiError.badRequest("Username already taken");
        if (existing.phoneNumber === phoneNumber)
          throw ApiError.badRequest("Phone already used");
        if (existing.email === email)
          throw ApiError.badRequest("Email already used");
      }
    }

    // 🔥 Format data
    const formattedData = {};
    if (username) formattedData.username = username.trim();
    if (firstName) formattedData.firstName = this.formatName(firstName);
    if (lastName) formattedData.lastName = this.formatName(lastName);
    if (phoneNumber) formattedData.phoneNumber = phoneNumber;
    if (email) formattedData.email = email.trim().toLowerCase();

    // 🔥 Use transaction for atomic updates
    const updatedUser = await Prisma.$transaction(async (tx) => {
      // Update user
      const user = await tx.user.update({
        where: { id: userId },
        data: formattedData,
        include: {
          role: true,
          wallets: true,
        },
      });

      // 🔥 Tenant update
      const isTenantRole =
        targetRoleKey === "RESELLER" || targetRoleKey === "WHITE LABEL";

      if (isTenantRole) {
        if (!updateData.tenantName) {
          throw ApiError.badRequest("tenantName is required for tenant roles");
        }

        if (!updateData.tenantType) {
          throw ApiError.badRequest("tenantType is required for tenant roles");
        }

        const tenantId = userToUpdate.tenants?.[0]?.id;
        if (!tenantId) {
          throw ApiError.badRequest("Tenant not found for this user");
        }

        await tx.tenant.update({
          where: { id: tenantId },
          data: {
            tenantName: updateData.tenantName,
            tenantLegalName:
              updateData.tenantLegalName || updateData.tenantName,
            tenantType: updateData.tenantType,
          },
        });
      }

      // 🔥 Wallet sync
      const isTopWalletRole =
        targetRoleKey === "RESELLER" || targetRoleKey === "WHITE_LABEL";

      const existingWallets = await tx.wallet.findMany({
        where: { userId },
      });

      const walletTypes = existingWallets.map((w) => w.walletType);

      if (isTopWalletRole) {
        const missingWallets = [];
        if (!walletTypes.includes("GST")) missingWallets.push("GST");
        if (!walletTypes.includes("TDS")) missingWallets.push("TDS");

        if (missingWallets.length) {
          await tx.wallet.createMany({
            data: missingWallets.map((type) => ({
              userId,
              walletType: type,
              balance: BigInt(0),
              holdBalance: BigInt(0),
              currency: "INR",
              isActive: true,
              version: 1,
            })),
          });
        }
      } else {
        // 🔥 Remove if role downgraded
        await tx.wallet.deleteMany({
          where: {
            userId,
            walletType: { in: ["GST", "TDS"] },
          },
        });
      }

      return user;
    });

    // 🔥 Email side effect (outside transaction)
    if (isEmailChanged) {
      await this.regenerateCredentialsAndNotify(
        userId,
        email,
        currentUserId,
        req,
        res
      );
    }

    // 🔥 Fetch complete user data with relations
    const completeUser = await Prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          select: { id: true, name: true, level: true, description: true },
        },
        wallets: true,
        parent: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
        children: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
            status: true,
            createdAt: true,
          },
        },
        tenants: true,
        bankAccounts: {
          where: {
            status: "VERIFIED",
          },
          orderBy: {
            isPrimary: "desc",
          },
        },
      },
    });

    // 🔥 Audit log
    await AuditLogService.createAuditLog({
      userId: currentUserId,
      action: "BUSINESS_PROFILE_UPDATED",
      entityType: "USER",
      entityId: userId,
      ipAddress: req ? Helper.getClientIP(req) : null,
      metadata: {
        ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
        updatedBy: currentUserId,
        updatedFields: Object.keys(formattedData),
        role: currentRoleName,
        isEmailChanged,
      },
    });

    return completeUser;
  }

  // BUSINESS USER PROFILE IMAGE UPDATE
  static async updateProfileImage(
    userId,
    profileImageFile,
    req = null,
    res = null
  ) {
    // 🔥 Validate file
    if (!profileImageFile) {
      throw ApiError.badRequest("Profile image is required");
    }

    // Validate file type
    const allowedMimeTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ];
    if (!allowedMimeTypes.includes(profileImageFile.mimetype)) {
      throw ApiError.badRequest(
        "Invalid file type. Only JPEG, PNG, and WEBP images are allowed"
      );
    }

    // Validate file size (e.g., 5MB limit)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (profileImageFile.size > maxSize) {
      throw ApiError.badRequest("File size too large. Maximum size is 5MB");
    }

    try {
      const user = await Prisma.user.findUnique({
        where: { id: userId },
        include: {
          role: {
            select: {
              id: true,
              name: true,
              level: true,
              description: true,
              type: true,
            },
          },
          wallets: true,
        },
      });

      if (!user) {
        await AuditLogService.createAuditLog({
          userId,
          action: "BUSINESS_PROFILE_IMAGE_UPDATE_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "USER_NOT_FOUND",
            roleName: req.user?.role,
            updatedBy: userId,
          },
        });
        throw ApiError.notFound("User not found");
      }

      // Ensure it's a business user
      if (user.role.type !== "business") {
        await AuditLogService.createAuditLog({
          userId,
          action: "BUSINESS_PROFILE_IMAGE_UPDATE_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "NON_BUSINESS_USER",
            userRoleType: user.role.type,
            roleName: req.user?.role,
            updatedBy: userId,
          },
        });
        throw ApiError.badRequest(
          "Can only update business user profile images"
        );
      }

      // 🔥 Upload new image first (to avoid leaving user without image if upload fails)
      let profileImageUrl;
      try {
        profileImageUrl = await S3Service.upload(profileImageFile, "profile");
        if (!profileImageUrl) {
          throw new Error("Upload returned empty URL");
        }
      } catch (uploadErr) {
        console.error("Failed to upload profile image", {
          userId,
          error: uploadErr,
        });
        throw ApiError.internal("Failed to upload profile image");
      }

      // 🔥 Update user with new image URL
      const updatedUser = await Prisma.user.update({
        where: { id: userId },
        data: { profileImage: profileImageUrl },
        include: {
          role: {
            select: { id: true, name: true, level: true, description: true },
          },
          wallets: true,
          parent: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
          children: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      // 🔥 Delete old image after successful update (don't block on failure)
      let oldImageDeleted = false;
      if (user.profileImage) {
        try {
          await S3Service.delete({ fileUrl: user.profileImage });
          oldImageDeleted = true;
        } catch (error) {
          console.error("Failed to delete old profile image", {
            userId,
            profileImage: user.profileImage,
            error,
          });
          // Don't throw error, just log it
        }
      }

      await AuditLogService.createAuditLog({
        userId,
        action: "BUSINESS_PROFILE_IMAGE_UPDATED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          oldImageDeleted,
          newImageUrl: profileImageUrl,
          roleName: req.user?.role,
          updatedBy: userId,
          fileSize: profileImageFile.size,
          fileType: profileImageFile.mimetype,
        },
      });

      return updatedUser;
    } catch (err) {
      console.error("Profile image update error", {
        userId,
        error: err.message,
        stack: err.stack,
      });

      if (err instanceof ApiError) throw err;

      await AuditLogService.createAuditLog({
        userId,
        action: "BUSINESS_PROFILE_IMAGE_UPDATE_FAILED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "UNKNOWN_ERROR",
          roleName: req.user?.role,
          error: err.message,
          updatedBy: userId,
        },
      });

      throw ApiError.internal("Failed to update profile image", err?.message);
    }
  }

  // GET BUSINESS USER BY ID
  static async getUserById(userId, currentUser = null) {
    const user = await Prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            level: true,
            description: true,
            type: true,
          },
        },
        wallets: true,
        parent: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
        children: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
            status: true,
            createdAt: true,
          },
        },
        kycs: {
          include: {
            address: {
              include: {
                state: {
                  select: {
                    id: true,
                    stateName: true,
                    stateCode: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
                city: {
                  select: {
                    id: true,
                    cityName: true,
                    cityCode: true,
                    createdAt: true,
                    updatedAt: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        bankAccounts: {
          where: { status: "VERIFIED" },
          orderBy: { isPrimary: "desc" },
        },
        userPermissions: {
          include: {
            service: {
              select: {
                id: true,
                name: true,
                code: true,
                isActive: true,
              },
            },
          },
        },
        piiConsents: {
          select: {
            id: true,
            piiType: true,
            scope: true,
            providedAt: true,
            expiresAt: true,
            userKycId: true,
          },
          where: { expiresAt: { gt: new Date() } },
        },
      },
    });

    if (!user) throw ApiError.notFound("User not found");

    // Ensure it's a business user
    if (user.role.type !== "business") {
      throw ApiError.badRequest("User is not a business user");
    }

    // 🔥 SELF ACCESS ALWAYS ALLOWED
    if (currentUser?.id === userId) {
      const serialized = Helper.serializeUser(user);

      try {
        if (serialized.password) {
          serialized.password = CryptoService.decrypt(serialized.password);
        }
        if (serialized.transactionPin) {
          serialized.transactionPin = CryptoService.decrypt(
            serialized.transactionPin
          );
        }
      } catch {}

      return serialized;
    }

    // 🔥 current role resolve (SAFE)
    let currentRoleName =
      currentUser?.roleType === "employee"
        ? currentUser?.parentBusinessRole
        : currentUser?.role;

    if (!currentRoleName) {
      throw ApiError.forbidden("Invalid role context");
    }

    const currentRoleKey = Helper.normalizeRole(currentRoleName);
    const targetRoleKey = Helper.normalizeRole(user.role.name);

    // 🔥 hierarchy validation
    const allowedRoles = ROLE_HIERARCHY[currentRoleKey] || [];

    if (!allowedRoles.includes(targetRoleKey)) {
      throw ApiError.forbidden("You are not allowed to view this user");
    }

    // 🔥 transform user (USE THIS — FIXED)
    const transformedUser = {
      ...user,
      kycInfo:
        user.kycs.length > 0
          ? {
              currentStatus: user.kycs[0].status,
              isKycSubmitted: true,
              latestKyc: user.kycs[0],
              kycHistory: user.kycs,
              totalKycAttempts: user.kycs.length,
            }
          : {
              currentStatus: "NOT_SUBMITTED",
              isKycSubmitted: false,
              latestKyc: null,
              kycHistory: [],
              totalKycAttempts: 0,
            },
      bankInfo: {
        totalAccounts: user.bankAccounts.length,
        primaryAccount: user.bankAccounts.find((acc) => acc.isPrimary) || null,
        verifiedAccounts: user.bankAccounts.filter(
          (acc) => acc.status === "VERIFIED"
        ),
      },
      kycs: undefined,
      bankAccounts: undefined,
    };

    const serialized = Helper.serializeUser(transformedUser);

    // 🔥 credential access
    const allowedToSeeCredentials = [
      "AZZUNIQUE",
      "RESELLER",
      "WHITELABEL",
    ].includes(currentRoleKey);

    if (allowedToSeeCredentials) {
      try {
        if (serialized.password) {
          serialized.password = CryptoService.decrypt(serialized.password);
        }
        if (serialized.transactionPin) {
          serialized.transactionPin = CryptoService.decrypt(
            serialized.transactionPin
          );
        }
      } catch {
        serialized.password = "Error decrypting";
        serialized.transactionPin = "Error decrypting";
      }

      return serialized;
    }

    const { password, transactionPin, refreshToken, ...safeUser } = serialized;
    return safeUser;
  }

  // GET ALL BUSINESS USERS BY ROLE
  static async getAllUsersByRole(roleId, currentUser = null) {
    if (!roleId) {
      throw ApiError.badRequest("roleId is required");
    }

    // Verify role is business type
    const role = await Prisma.role.findUnique({
      where: { id: roleId },
      select: { type: true, name: true },
    });

    if (!role || role.type !== "business") {
      throw ApiError.badRequest("Invalid business role");
    }

    // 🔥 current role resolve
    let currentRoleName =
      currentUser?.roleType === "employee"
        ? currentUser?.parentBusinessRole
        : currentUser?.role;

    const currentRoleKey = Helper.normalizeRole(currentRoleName);

    const allowedRoles = ROLE_HIERARCHY[currentRoleKey] || [];

    const targetRoleKey = Helper.normalizeRole(role.name);

    // 🔥 STRICT CHECK
    if (!allowedRoles.includes(targetRoleKey)) {
      throw ApiError.forbidden(
        `${currentRoleName} cannot access ${role.name} users`
      );
    }

    const users = await Prisma.user.findMany({
      where: {
        roleId,
        parentId: currentUser?.id,
        status: "ACTIVE",
      },
      include: {
        role: {
          select: { id: true, name: true, level: true, description: true },
        },
        wallets: true,
        parent: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
        children: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
            status: true,
            createdAt: true,
          },
        },
        bankAccounts: {
          where: {
            status: "VERIFIED",
          },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const allowedToSeeCredentials = [
      "AZZUNIQUE",
      "RESELLER",
      "WHITELABEL",
    ].includes(currentRoleKey);

    const safeUsers = users.map((user) => {
      const serialized = Helper.serializeUser(user);

      if (allowedToSeeCredentials) {
        try {
          if (serialized.password) {
            serialized.password = CryptoService.decrypt(serialized.password);
          }

          if (serialized.transactionPin) {
            serialized.transactionPin = CryptoService.decrypt(
              serialized.transactionPin
            );
          }
        } catch {
          serialized.password = "Error decrypting";
          serialized.transactionPin = "Error decrypting";
        }

        return serialized;
      }

      const { password, transactionPin, refreshToken, ...safeUser } =
        serialized;
      return safeUser;
    });

    return safeUsers;
  }

  // GET ALL BUSINESS USERS BY PARENT ID (FIXED WITH ROLE_HIERARCHY)
  static async getAllRoleTypeUsersByParentId(parentId, options = {}) {
    // Get parent user with role information
    const parent = await Prisma.user.findUnique({
      where: { id: parentId },
      include: {
        role: true,
        tenants: {
          select: {
            userType: true,
          },
          take: 1,
        },
      },
    });

    if (!parent) {
      throw ApiError.notFound("Parent user not found");
    }

    const {
      page = 1,
      limit = 10,
      sort = "desc",
      status = "ALL",
      search = "",
    } = options;

    const skip = (page - 1) * limit;
    const isAll = status === "ALL";

    // 🔥 STEP 1: parent role resolve
    let parentRoleName =
      parent.role.type === "employee"
        ? parent.tenants?.[0]?.userType
        : parent.role.name;

    const parentRoleKey = Helper.normalizeRole(parentRoleName);

    // 🔥 STEP 2: get allowed roles from hierarchy
    const allowedRoles = ROLE_HIERARCHY[parentRoleKey] || [];

    if (!allowedRoles.length) {
      return {
        users: [],
        total: 0,
        meta: {
          parentRole: parentRoleName,
          message: "No child roles allowed",
        },
      };
    }

    // 🔥 STEP 3: map allowed roles → roleIds
    const allowedRoleRecords = await Prisma.role.findMany({
      where: {
        name: {
          in: allowedRoles,
        },
        type: "business",
      },
      select: { id: true, name: true },
    });

    const allowedRoleIds = allowedRoleRecords.map((r) => r.id);

    // 🔥 STEP 4: build query
    let queryWhere = {
      parentId: parentId,
      roleId: {
        in: allowedRoleIds,
      },
      ...(isAll ? {} : { status }),
    };

    // 🔍 SEARCH FILTER
    if (search && search.trim() !== "") {
      const searchTerm = search.toLowerCase();

      queryWhere = {
        ...queryWhere,
        OR: [
          { username: { contains: searchTerm } },
          { firstName: { contains: searchTerm } },
          { lastName: { contains: searchTerm } },
          { email: { contains: searchTerm } },
          { phoneNumber: { contains: searchTerm } },
        ],
      };
    }

    // 🔥 STEP 5: fetch users
    const [users, total] = await Promise.all([
      Prisma.user.findMany({
        where: queryWhere,
        include: {
          role: {
            select: {
              id: true,
              name: true,
              level: true,
              description: true,
              type: true,
            },
          },
          wallets: true,
          parent: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
          children: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: sort },
        skip,
        take: limit,
      }),
      Prisma.user.count({ where: queryWhere }),
    ]);

    // 🔥 SAFETY FILTER
    const filteredUsers = users.filter((user) => user.role.type === "business");

    const allowedToSeeCredentials = [
      "AZZUNIQUE",
      "RESELLER",
      "WHITELABEL",
    ].includes(Helper.normalizeRole(parentRoleName));

    const safeUsers = filteredUsers.map((user) => {
      const serialized = Helper.serializeUser(user);

      if (allowedToSeeCredentials) {
        try {
          if (serialized.password) {
            serialized.password = CryptoService.decrypt(serialized.password);
          }

          if (serialized.transactionPin) {
            serialized.transactionPin = CryptoService.decrypt(
              serialized.transactionPin
            );
          }
        } catch {
          serialized.password = "Error decrypting";
          serialized.transactionPin = "Error decrypting";
        }

        return serialized;
      }

      // 🔥 others → hide
      const { password, transactionPin, refreshToken, ...safeUser } =
        serialized;
      return safeUser;
    });

    return {
      users: safeUsers,
      total,
      meta: {
        parentRole: parentRoleName,
        parentRoleType: parent.role.type,
        allowedRoles,
        currentPage: page,
        limit,
      },
    };
  }

  // BUSINESS USER DEACTIVATION
  static async deactivateUser(
    userId,
    deactivatedBy,
    reason,
    req = null,
    res = null
  ) {
    try {
      const user = await Prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      if (!user) {
        await AuditLogService.createAuditLog({
          userId: deactivatedBy,
          action: "BUSINESS_USER_DEACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "USER_NOT_FOUND",
            roleName: req.user.role,
            deactivatedBy: deactivatedBy,
          },
        });
        throw ApiError.notFound("User not found");
      }

      // Ensure it's a business user
      if (user.role.type !== "business") {
        await AuditLogService.createAuditLog({
          userId: deactivatedBy,
          action: "BUSINESS_USER_DEACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "NON_BUSINESS_USER",
            userRoleType: user.role.type,
            roleName: req.user.role,
            deactivatedBy: deactivatedBy,
          },
        });
        throw ApiError.badRequest("Can only deactivate business users");
      }

      if (user.status === "IN_ACTIVE") {
        await AuditLogService.createAuditLog({
          userId: deactivatedBy,
          action: "BUSINESS_USER_DEACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "ALREADY_DEACTIVATED",
            roleName: req.user.role,
            deactivatedBy: deactivatedBy,
          },
        });
        throw ApiError.badRequest("User is already deactivated");
      }

      const deactivator = await Prisma.user.findUnique({
        where: { id: deactivatedBy },
        include: { role: true },
      });

      if (!deactivator) {
        await AuditLogService.createAuditLog({
          userId: deactivatedBy,
          action: "BUSINESS_USER_DEACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "INVALID_DEACTIVATOR",
            roleName: req.user.role,
            deactivatedBy: deactivatedBy,
          },
        });
        throw ApiError.unauthorized("Invalid deactivator user");
      }

      const isAdmin = deactivator.role.name === "ADMIN";
      const isParent = user.parentId === deactivatedBy;
      const hasHigherRole = deactivator.role.level > user.role.level;

      if (!isAdmin && !isParent && !hasHigherRole) {
        await AuditLogService.createAuditLog({
          userId: deactivatedBy,
          action: "BUSINESS_USER_DEACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "INSUFFICIENT_PERMISSIONS",
            deactivatorRole: deactivator.role.name,
            roleName: req.user.role,
            deactivatedBy: deactivatedBy,
          },
        });
        throw ApiError.forbidden(
          "You don't have permission to deactivate this user"
        );
      }

      const updatedUser = await Prisma.user.update({
        where: { id: userId },
        data: {
          status: "IN_ACTIVE",
          deactivationReason: reason,
          updatedAt: new Date(),
        },
        include: {
          role: {
            select: { id: true, name: true, level: true, description: true },
          },
          wallets: true,
          parent: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
          children: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      await AuditLogService.createAuditLog({
        userId: deactivatedBy,
        action: "BUSINESS_USER_DEACTIVATED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          previousStatus: user.status,
          newStatus: "IN_ACTIVE",
          reason: reason || "No reason provided",
          roleName: req.user.role,
          deactivatedBy: deactivatedBy,
        },
      });

      return updatedUser;
    } catch (error) {
      console.error("Failed to deactivate business user", {
        userId,
        deactivatedBy,
        error: error.message,
      });

      if (error instanceof ApiError) throw error;

      await AuditLogService.createAuditLog({
        userId: deactivatedBy,
        action: "BUSINESS_USER_DEACTIVATION_FAILED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "UNKNOWN_ERROR",
          error: error.message,
          roleName: req.user.role,
          deactivatedBy: deactivatedBy,
        },
      });

      throw ApiError.internal(
        "Failed to deactivate business user. Please try again."
      );
    }
  }

  // BUSINESS USER REACTIVATION
  static async reactivateUser(
    userId,
    reactivatedBy,
    reason,
    req = null,
    res = null
  ) {
    try {
      const user = await Prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      if (!user) {
        await AuditLogService.createAuditLog({
          userId: reactivatedBy,
          action: "BUSINESS_USER_REACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "USER_NOT_FOUND",
            roleName: req.user.role,
            reactivatedBy: reactivatedBy,
          },
        });
        throw ApiError.notFound("User not found");
      }

      // Ensure it's a business user
      if (user.role.type !== "business") {
        await AuditLogService.createAuditLog({
          userId: reactivatedBy,
          action: "BUSINESS_USER_REACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "NON_BUSINESS_USER",
            roleName: req.user.role,
            reactivatedBy: reactivatedBy,
          },
        });
        throw ApiError.badRequest("Can only reactivate business users");
      }

      if (user.status === "DELETE") {
        await AuditLogService.createAuditLog({
          userId: reactivatedBy,
          action: "BUSINESS_USER_REACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "USER_DELETED",
            roleName: req.user.role,
            reactivatedBy: reactivatedBy,
          },
        });
        throw ApiError.badRequest("Cannot reactivate a deleted user");
      }

      if (user.status === "ACTIVE") {
        await AuditLogService.createAuditLog({
          userId: reactivatedBy,
          action: "BUSINESS_USER_REACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "ALREADY_ACTIVE",
            roleName: req.user.role,
            reactivatedBy: reactivatedBy,
          },
        });
        throw ApiError.badRequest("User is already active");
      }

      const activator = await Prisma.user.findUnique({
        where: { id: reactivatedBy },
        include: { role: true },
      });

      if (!activator) {
        await AuditLogService.createAuditLog({
          userId: reactivatedBy,
          action: "BUSINESS_USER_REACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "INVALID_ACTIVATOR",
            roleName: req.user.role,
            reactivatedBy: reactivatedBy,
          },
        });
        throw ApiError.unauthorized("Invalid activator user");
      }

      const isAdmin = activator.role.name === "ADMIN";
      const isParent = user.parentId === reactivatedBy;
      const hasHigherRole = activator.role.level > user.role.level;

      if (!isAdmin && !isParent && !hasHigherRole) {
        await AuditLogService.createAuditLog({
          userId: reactivatedBy,
          action: "BUSINESS_USER_REACTIVATION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "INSUFFICIENT_PERMISSIONS",
            activatorRole: activator.role.name,
            roleName: req.user.role,
            reactivatedBy: reactivatedBy,
          },
        });
        throw ApiError.forbidden(
          "You don't have permission to reactivate this user"
        );
      }

      const updatedUser = await Prisma.user.update({
        where: { id: userId },
        data: {
          status: "ACTIVE",
          deactivationReason: reason,
          updatedAt: new Date(),
        },
        include: {
          role: {
            select: { id: true, name: true, level: true, description: true },
          },
          wallets: true,
          parent: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
          children: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      await AuditLogService.createAuditLog({
        userId: reactivatedBy,
        action: "BUSINESS_USER_REACTIVATED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          previousStatus: user.status,
          newStatus: "ACTIVE",
          reason: reason || "No reason provided",
          roleType: activator.role.type,
          roleName: activator.role.name,
          reactivatedBy: reactivatedBy,
        },
      });

      return updatedUser;
    } catch (error) {
      console.error("Failed to reactivate business user", {
        userId,
        reactivatedBy,
        error: error.message,
      });

      if (error instanceof ApiError) throw error;

      await AuditLogService.createAuditLog({
        userId: reactivatedBy,
        action: "BUSINESS_USER_REACTIVATION_FAILED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "UNKNOWN_ERROR",
          error: error.message,
          reactivatedBy: reactivatedBy,
        },
      });

      throw ApiError.internal(
        "Failed to reactivate business user. Please try again."
      );
    }
  }

  // BUSINESS USER SOFT DELETE
  static async deleteUser(userId, deletedBy, reason, req = null, res = null) {
    try {
      const user = await Prisma.user.findUnique({
        where: { id: userId },
        include: { role: true },
      });

      if (!user) {
        await AuditLogService.createAuditLog({
          userId: deletedBy,
          action: "BUSINESS_USER_DELETION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "USER_NOT_FOUND",
            roleName: req.user.role,
            deletedBy: deletedBy,
          },
        });
        throw ApiError.notFound("User not found");
      }

      // Ensure it's a business user
      if (user.role.type !== "business") {
        await AuditLogService.createAuditLog({
          userId: deletedBy,
          action: "BUSINESS_USER_DELETION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "NON_BUSINESS_USER",
            userRoleType: user.role.type,
            roleName: req.user.role,
            deletedBy: deletedBy,
          },
        });
        throw ApiError.badRequest("Can only delete business users");
      }

      const deleter = await Prisma.user.findUnique({
        where: { id: deletedBy },
        include: { role: true },
      });

      if (!deleter) {
        await AuditLogService.createAuditLog({
          userId: deletedBy,
          action: "BUSINESS_USER_DELETION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "INVALID_DELETER",
            roleName: req.user.role,
            deletedBy: deletedBy,
          },
        });
        throw ApiError.unauthorized("Invalid deleter user");
      }

      const isAdmin =
        deleter.role.name === "ADMIN" || deleter.role.type === "employee";
      if (!isAdmin) {
        await AuditLogService.createAuditLog({
          userId: deletedBy,
          action: "BUSINESS_USER_DELETION_FAILED",
          entityType: "USER",
          entityId: userId,
          ipAddress: req ? Helper.getClientIP(req) : null,
          metadata: {
            ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
            reason: "NON_ADMIN_DELETION",
            roleName: req.user.role,
            deleterRole: deleter.role.name,
            deletedBy: deletedBy,
          },
        });
        throw ApiError.forbidden("Only ADMIN can delete users");
      }

      const updatedUser = await Prisma.user.update({
        where: { id: userId },
        data: {
          status: "DELETE",
          deactivationReason: reason,
          updatedAt: new Date(),
          deletedAt: new Date(),
        },
        include: {
          role: {
            select: { id: true, name: true, level: true, description: true },
          },
          wallets: true,
          parent: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
            },
          },
          children: {
            select: {
              id: true,
              username: true,
              firstName: true,
              lastName: true,
              email: true,
              phoneNumber: true,
              profileImage: true,
              status: true,
              createdAt: true,
            },
          },
        },
      });

      await AuditLogService.createAuditLog({
        userId: deletedBy,
        action: "BUSINESS_USER_DELETED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          previousStatus: user.status,
          newStatus: "DELETE",
          reason: reason || "No reason provided",
          roleName: req.user.role,
          deleterRole: deleter.role.name,
          deletedBy: deletedBy,
        },
      });

      return updatedUser;
    } catch (error) {
      console.error("Failed to delete business user", {
        userId,
        deletedBy,
        error: error.message,
      });

      if (error instanceof ApiError) throw error;

      await AuditLogService.createAuditLog({
        userId: deletedBy,
        action: "BUSINESS_USER_DELETION_FAILED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "UNKNOWN_ERROR",
          roleName: req.user.role,
          error: error.message,
          deletedBy: deletedBy,
        },
      });

      throw ApiError.internal(
        "Failed to delete business user. Please try again."
      );
    }
  }

  // HELPER METHODS
  static async regenerateCredentialsAndNotify(
    userId,
    newEmail,
    currentUserId = null,
    req = null,
    res = null
  ) {
    try {
      const newPassword = Helper.generatePassword();
      const newTransactionPin = Helper.generateTransactionPin();

      const hashedPassword = CryptoService.encrypt(newPassword);
      const hashedTransactionPin = CryptoService.encrypt(newTransactionPin);

      const user = await Prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          transactionPin: hashedTransactionPin,
          email: newEmail,
        },
        include: {
          role: true,
        },
      });

      await sendCredentialsEmail(
        user,
        newPassword,
        newTransactionPin,
        "reset",
        "Your business account credentials have been reset. Here are your new login credentials:",
        "business"
      );

      await AuditLogService.createAuditLog({
        userId: currentUserId || userId,
        action: "BUSINESS_CREDENTIALS_REGENERATED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "EMAIL_UPDATED",
          newEmail: newEmail,
          regeneratedBy: currentUserId || userId,
        },
      });

      return user;
    } catch (error) {
      console.error("Error regenerating business credentials:", error);

      await AuditLogService.createAuditLog({
        userId: currentUserId || userId,
        action: "BUSINESS_CREDENTIALS_REGENERATION_FAILED",
        entityType: "USER",
        entityId: userId,
        ipAddress: req ? Helper.getClientIP(req) : null,
        metadata: {
          ...(req && res ? Helper.generateCommonMetadata(req, res) : {}),
          reason: "REGENERATION_ERROR",
          error: error.message,
          regeneratedBy: currentUserId || userId,
        },
      });

      throw ApiError.internal("Failed to regenerate business credentials");
    }
  }

  static formatName(name) {
    if (!name) return name;

    return name
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
      .trim();
  }

  // BUSINESS SPECIFIC METHODS
  static async getAllUsersByChildrenId(userId) {
    if (!userId) {
      throw ApiError.badRequest("userId is required");
    }

    const user = await Prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, hierarchyPath: true },
    });

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    const users = await Prisma.user.findMany({
      where: {
        hierarchyPath: {
          contains: userId,
        },
        status: "ACTIVE",
        role: {
          type: "business", // Only business users
        },
      },
      include: {
        role: {
          select: { id: true, name: true, level: true, description: true },
        },
        wallets: true,
        parent: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
          },
        },
        children: {
          select: {
            id: true,
            username: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneNumber: true,
            profileImage: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { hierarchyLevel: "asc" },
    });

    const safeUsers = users.map((user) => Helper.serializeUser(user));

    return safeUsers;
  }

  static async getAllUsersCountByParentId(parentId) {
    if (!parentId) {
      throw ApiError.badRequest("parentId is required");
    }

    const count = await Prisma.user.count({
      where: {
        parentId,
        status: "ACTIVE",
        role: {
          type: "business", // Only business users
        },
      },
    });

    return { count };
  }

  static async getAllUsersCountByChildrenId(userId) {
    if (!userId) {
      throw ApiError.badRequest("userId is required");
    }

    const user = await Prisma.user.findUnique({
      where: { id: userId },
      select: { hierarchyPath: true },
    });

    if (!user) {
      throw ApiError.notFound("User not found");
    }

    const count = await Prisma.user.count({
      where: {
        hierarchyPath: {
          contains: userId,
        },
        status: "ACTIVE",
        role: {
          type: "business", // Only business users
        },
      },
    });

    return { count };
  }
}

export default UserServices;
