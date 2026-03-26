import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { getAllRolesByType } from "../../redux/slices/roleSlice";
import { registerUser, updateUserProfile } from "../../redux/slices/userSlice";
import {
  registerEmployee,
  updateEmployeeProfile,
} from "../../redux/slices/employeeSlice";
import HeaderSection from "../ui/HeaderSection";
import InputField from "../ui/InputField";
import ButtonField from "../ui/ButtonField";
import { DropdownField } from "../ui/DropdownField";

export default function AddUser({
  isAdmin = false,
  profileEdit = false,
  onClose,
  onSuccess,
  editData,
  type = "business",
}) {
  const [formData, setFormData] = useState({
    username: "",
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    roleId: "",
    profileImage: null,
  });

  const [step, setStep] = useState(1);

  const [tenantData, setTenantData] = useState({
    tenantName: "",
    tenantLegalName: "",
    tenantType: "",
  });

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState({ type: "", text: "" });
  const [imagePreview, setImagePreview] = useState(null);
  const dispatch = useDispatch();

  const roles = useSelector((state) => state?.roles?.roles || []);

  // Get display text based on type
  const getDisplayText = () => {
    if (type === "employee") {
      return {
        title: profileEdit
          ? "Profile Update"
          : editData
            ? "Edit Employee"
            : "Add New Employee",
        description: editData
          ? "Update existing employee details"
          : "Create a new employee account",
        button: profileEdit
          ? "Update Profile"
          : editData
            ? "Update Employee"
            : "Add Employee",
        loading: profileEdit
          ? "Updating Profile..."
          : editData
            ? "Updating..."
            : "Creating...",
        success: editData
          ? "Employee updated successfully!"
          : "Employee added successfully!",
      };
    } else {
      return {
        title: profileEdit
          ? "Profile Update"
          : editData
            ? "Edit User"
            : "Add New User",
        description: editData
          ? "Update existing user details"
          : "Create a new team user account",
        button: profileEdit
          ? "Update Profile"
          : editData
            ? "Update User"
            : "Add User",
        loading: profileEdit
          ? "Updating Profile..."
          : editData
            ? "Updating..."
            : "Creating...",
        success: editData
          ? "User updated successfully!"
          : "User added successfully!",
      };
    }
  };

  const displayText = getDisplayText();

  useEffect(() => {
    // Fetch roles based on type - only fetch if not in edit mode or if in add mode
    let roleType = "";
    if (type === "employee") roleType = "employee";
    if (type === "business") roleType = "business";

    // Only fetch roles if we need them (not in edit mode or if we need roles for display)
    if (roleType && (!editData || !profileEdit)) {
      dispatch(getAllRolesByType(roleType));
    }

    if (editData) {
      setFormData({
        username: editData.username || "",
        firstName: editData.firstName || "",
        lastName: editData.lastName || "",
        email: editData.email || "",
        phoneNumber: editData.phoneNumber || "",
        roleId: "", // Clear roleId in edit mode
        profileImage: null, // Clear profile image in edit mode
      });

      if (editData.profileImage) {
        setImagePreview(editData.profileImage);
      }

      // 🔥 FIX: Populate tenant data if it exists in editData
      if (editData.tenants && editData.tenants.length > 0) {
        const tenant = editData.tenants[0];
        setTenantData({
          tenantName: tenant.tenantName || "",
          tenantLegalName: tenant.tenantLegalName || "",
          tenantType: tenant.tenantType || "",
        });
      }
    }
  }, [editData, dispatch, type]);

  useEffect(() => {
    // Only reset step and tenant data for new user creation, not for edit mode
    if (!editData) {
      setStep(1);
      setTenantData({
        tenantName: "",
        tenantLegalName: "",
        tenantType: "",
      });
    } else {
      // In edit mode, always show step 2 (the main form)
      setStep(2);
    }
  }, [editData]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    // Auto-generate username from email (only for new User)
    if (name === "email" && !editData) {
      const usernameFromEmail = value.split("@")[0];
      setFormData((prev) => ({
        ...prev,
        username: usernameFromEmail || "",
      }));
    }

    if (errors[name]) setErrors({ ...errors, [name]: "" });
    if (message.text) setMessage({ type: "", text: "" });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        setErrors({ ...errors, profileImage: "Image must be less than 5MB" });
        return;
      }
      setFormData({ ...formData, profileImage: file });
      setImagePreview(URL.createObjectURL(file));
      setErrors({ ...errors, profileImage: "" });
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.email) newErrors.email = "Email is required";
    if (!formData.firstName) newErrors.firstName = "First name is required";
    if (!formData.lastName) newErrors.lastName = "Last name is required";
    if (!formData.phoneNumber)
      newErrors.phoneNumber = "Phone number is required";

    // Only validate role if not in edit mode
    if (!editData && !profileEdit && !formData.roleId)
      newErrors.roleId = "Role is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission based on type
  const handleSubmit = async (e) => {
    e.preventDefault();

    // 🔥 FIX: For edit mode, skip tenant step
    if (
      type === "business" &&
      shouldShowTenantStep &&
      step === 1 &&
      !editData
    ) {
      if (!tenantData.tenantName) {
        setErrors({ tenantName: "Tenant name is required" });
        return;
      }

      setStep(2);
      return;
    }

    if (!validateForm()) {
      setMessage({
        type: "error",
        text: "Please fill the required details before proceeding",
      });
      return;
    }

    setLoading(true);
    setMessage({ type: "", text: "" });
    setErrors({});

    try {
      let res;

      if (editData) {
        // 🔥 FIX: Include tenant data in edit mode for business users
        const submitData = {
          username: formData.username,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phoneNumber: formData.phoneNumber,
          // roleId is intentionally omitted
        };

        // 🔥 Add tenant data for business users in edit mode
        if (type === "business" && shouldShowTenantStep) {
          submitData.tenantName = tenantData.tenantName;
          submitData.tenantLegalName =
            tenantData.tenantLegalName || tenantData.tenantName;
          submitData.tenantType = tenantData.tenantType;
        }

        // Remove undefined fields
        Object.keys(submitData).forEach((key) => {
          if (
            submitData[key] === undefined ||
            submitData[key] === null ||
            submitData[key] === ""
          ) {
            delete submitData[key];
          }
        });

        // Use appropriate update function based on type
        if (type === "employee") {
          res = await dispatch(updateEmployeeProfile(editData.id, submitData));
        } else {
          res = await dispatch(updateUserProfile(editData.id, submitData));
        }
      } else {
        // New User case
        const form = new FormData();
        Object.keys(formData).forEach((key) => {
          if (
            formData[key] !== null &&
            formData[key] !== undefined &&
            formData[key] !== ""
          ) {
            form.append(key, formData[key]);
          }
        });

        if (type === "business" && shouldShowTenantStep) {
          form.append("tenantName", tenantData.tenantName);
          form.append(
            "tenantLegalName",
            tenantData.tenantLegalName || tenantData.tenantName,
          );
          form.append("tenantType", tenantData.tenantType || "PROPRIETORSHIP");
        }

        // Use appropriate register function based on type
        if (type === "employee") {
          res = await dispatch(registerEmployee(form));
        } else {
          res = await dispatch(registerUser(form));
        }
      }

      // Check for success
      if (
        res?.success ||
        res?.status === "success" ||
        res?.data?.success ||
        res?.payload?.success
      ) {
        setMessage({
          type: "success",
          text: displayText.success,
        });

        setTimeout(() => {
          onSuccess();
          onClose();
        }, 1000);
      } else {
        // Handle errors
        const errorData = res?.error || res?.payload || res?.data || {};
        const errorMessage = errorData?.message || "Operation failed";

        setMessage({
          type: "error",
          text: errorMessage,
        });

        // Set field-specific errors if available
        if (errorData?.errors && Array.isArray(errorData.errors)) {
          const formattedErrors = {};
          errorData.errors.forEach((err) => {
            formattedErrors[err.field] = err.message;
          });
          setErrors(formattedErrors);
        }
      }
    } catch (error) {
      const errorData = error?.response?.data || error;

      if (errorData.status === "fail" && Array.isArray(errorData.errors)) {
        const formattedErrors = {};
        errorData.errors.forEach((err) => {
          formattedErrors[err.field] = err.message;
        });
        setErrors(formattedErrors);

        setMessage(formattedErrors);
      } else {
        setMessage({
          type: "error",
          text:
            errorData?.message ||
            error?.message ||
            "Something went wrong. Please try again.",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  // Conditionally determine field visibility/state
  const shouldDisableEmail = editData && !isAdmin;
  const shouldShowTenantStep = isAdmin;
  const isEditMode = editData; // Check if we're in edit mode

  return (
    <div className="fixed inset-0 bg-opacity-50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-fadeIn">
        {/* Header */}
        <HeaderSection
          title={displayText.title}
          tagLine={displayText.description}
          isClose={onClose}
        />

        {/* Body */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-100px)]">
          {message.text && (
            <div
              className={`mb-4 p-4 rounded-lg text-sm font-medium ${
                message.type === "error"
                  ? "bg-red-50 text-red-700 border border-red-200"
                  : "bg-green-50 text-green-700 border border-green-200"
              }`}
            >
              {message.text}
            </div>
          )}

          {/* 🔥 FIX: Show tenant step only for new user creation, not for edit mode */}
          {type === "business" &&
            shouldShowTenantStep &&
            step === 1 &&
            !editData && (
              <div className="space-y-5 mb-6">
                <h3 className="text-lg font-semibold">Tenant Details</h3>

                <InputField
                  label="Tenant Name"
                  value={tenantData.tenantName}
                  onChange={(e) =>
                    setTenantData({ ...tenantData, tenantName: e.target.value })
                  }
                  error={errors.tenantName}
                  required
                />

                <InputField
                  label="Tenant Legal Name"
                  value={tenantData.tenantLegalName}
                  onChange={(e) =>
                    setTenantData({
                      ...tenantData,
                      tenantLegalName: e.target.value,
                    })
                  }
                />

                <DropdownField
                  label="Tenant Type"
                  name="tenantType"
                  value={tenantData.tenantType}
                  onChange={(e) =>
                    setTenantData({
                      ...tenantData,
                      tenantType: e.target.value,
                    })
                  }
                  options={[
                    { id: "PROPRIETORSHIP", label: "Proprietorship" },
                    { id: "PARTNERSHIP", label: "Partnership" },
                    { id: "PRIVATE_LIMITED", label: "Private Limited" },
                    { id: "PUBLIC_LIMITED", label: "Public Limited" },
                    { id: "LLP", label: "Limited Liability Partnership" },
                  ]}
                  placeholder="Select Tenant Type"
                  required
                />

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="
                  flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition
                  bg-linear-to-r from-cyan-500 via-blue-600 to-indigo-700 text-white hover:from-cyan-600 hover:via-blue-700 hover:to-indigo-900"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

          {/* 🔥 FIX: Show tenant edit section for edit mode */}
          {type === "business" && shouldShowTenantStep && isEditMode && (
            <div className="space-y-5  rounded-lg">
              <h3 className="text-lg font-semibold">Tenant Details</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <InputField
                  label="Tenant Name"
                  value={tenantData.tenantName}
                  onChange={(e) =>
                    setTenantData({ ...tenantData, tenantName: e.target.value })
                  }
                  error={errors.tenantName}
                  required
                />

                <InputField
                  label="Tenant Legal Name"
                  value={tenantData.tenantLegalName}
                  onChange={(e) =>
                    setTenantData({
                      ...tenantData,
                      tenantLegalName: e.target.value,
                    })
                  }
                />

                <DropdownField
                  label="Tenant Type"
                  name="tenantType"
                  value={tenantData.tenantType}
                  onChange={(e) =>
                    setTenantData({
                      ...tenantData,
                      tenantType: e.target.value,
                    })
                  }
                  options={[
                    { id: "PROPRIETORSHIP", label: "Proprietorship" },
                    { id: "PARTNERSHIP", label: "Partnership" },
                    { id: "PRIVATE_LIMITED", label: "Private Limited" },
                    { id: "PUBLIC_LIMITED", label: "Public Limited" },
                    { id: "LLP", label: "Limited Liability Partnership" },
                  ]}
                  placeholder="Select Tenant Type"
                  required
                />
              </div>
            </div>
          )}

          {((!shouldShowTenantStep && !isEditMode) ||
            step === 2 ||
            (isEditMode && !shouldShowTenantStep) ||
            (isEditMode && shouldShowTenantStep)) && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Username - Always show in both modes */}
                <InputField
                  label={"Username"}
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  placeholder="Username"
                  error={errors.username}
                />

                {/* Email - Conditionally disabled in edit mode if not admin */}
                <div>
                  <InputField
                    label={"Email"}
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    disabled={shouldDisableEmail}
                    className={`${
                      shouldDisableEmail ? "bg-gray-100 cursor-not-allowed" : ""
                    }`}
                    placeholder="email@example.com"
                    error={errors.email}
                  />
                  {shouldDisableEmail && (
                    <p className="text-gray-500 text-sm mt-1">
                      Only admins can update email address
                    </p>
                  )}
                </div>

                {/* First Name - Always show */}
                <InputField
                  label={"First Name"}
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleChange}
                  error={errors.firstName}
                  placeholder="First name"
                />

                {/* Last Name - Always show */}
                <InputField
                  label={"Last Name"}
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleChange}
                  error={errors.lastName}
                  placeholder="Last name"
                />

                {/* Phone Number - Always show */}
                <InputField
                  label={"Phone Number"}
                  type="tel"
                  name="phoneNumber"
                  value={formData.phoneNumber}
                  onChange={(e) => {
                    const value = e.target.value
                      .replace(/\D/g, "")
                      .slice(0, 10);
                    setFormData({ ...formData, phoneNumber: value });
                    if (errors.phoneNumber)
                      setErrors({ ...errors, phoneNumber: "" });
                  }}
                  maxLength={10}
                  placeholder="10-digit number"
                  error={errors.phoneNumber}
                />

                {/* Role - Completely removed in edit mode */}
                {!isEditMode && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Role *
                    </label>
                    <select
                      name="roleId"
                      value={formData.roleId}
                      onChange={handleChange}
                      className={`w-full px-4 py-3 border rounded-xl focus:outline-none ${
                        errors.roleId
                          ? "border-red-400 focus:ring-red-300 bg-red-50"
                          : "border-gray-300 focus:ring-blue-400"
                      }`}
                    >
                      <option value="">Select a role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name || role.roleName}
                        </option>
                      ))}
                    </select>
                    {errors.roleId && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.roleId}
                      </p>
                    )}
                  </div>
                )}

                {/* Profile Image - Completely removed in edit mode */}
                {!isEditMode && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Profile Image
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        className="w-full"
                        disabled={loading}
                      />
                      {imagePreview && (
                        <img
                          src={imagePreview}
                          alt="Preview"
                          className="w-16 h-16 object-cover rounded-full border border-gray-300"
                        />
                      )}
                    </div>
                    {errors.profileImage && (
                      <p className="text-red-500 text-sm mt-1">
                        {errors.profileImage}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Submit */}
              <div className="pt-3 flex justify-end">
                <ButtonField
                  name={loading ? displayText.loading : displayText.button}
                  type="submit"
                  isLoading={loading}
                />
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
