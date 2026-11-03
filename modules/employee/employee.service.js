import mongoose from "mongoose";
import { Employee, User, Role, Store } from "../../models/index.js";
import { ApiError } from "../../utils/ApiError.js";
import { logAudit } from "../../utils/auditLogger.js";
import * as invitationService from "../invitation/invitation.service.js";

/**
 * Invite an employee to a store.
 * Delegates to the secure invitation service separating Invitation from Employee.
 */
export const inviteEmployee = async (storeId, invitedByUserId, employeeData) => {
  return invitationService.createInvitation(storeId, invitedByUserId, employeeData);
};

/**
 * Get all employees in a store.
 */
export const getEmployeesByStore = async (storeId) => {
  return Employee.find({ store: storeId })
    .populate("user", "name email profilePicture phone")
    .populate("role", "name permissions isSystem");
};

/**
 * Get single employee details in a store.
 */
export const getEmployeeById = async (storeId, employeeId) => {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError("Invalid employee ID format", 400);
  }

  const employee = await Employee.findOne({ _id: employeeId, store: storeId })
    .populate("user", "name email profilePicture phone")
    .populate("role", "name permissions isSystem")
    .populate("invitedBy", "name email");

  if (!employee) {
    throw new ApiError("Employee record not found", 404);
  }

  return employee;
};

/**
 * Updates an employee's assigned role.
 * Strictly checks role existence, store ownership, and prevents privilege escalation.
 */
export const updateEmployeeRole = async (storeId, employeeId, actorUserId, newRoleId) => {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError("Invalid employee ID format", 400);
  }

  if (!newRoleId) {
    throw new ApiError("New role ID is required", 400);
  }

  const employee = await Employee.findOne({ _id: employeeId, store: storeId });
  if (!employee) {
    throw new ApiError("Employee record not found", 404);
  }

  // Prevent employee from modifying their own role
  if (actorUserId && employee.user.toString() === actorUserId.toString()) {
    throw new ApiError("Employees cannot modify their own roles", 403);
  }

  const role = await Role.findById(newRoleId);
  if (!role) {
    throw new ApiError("New role not found", 404);
  }

  if (role.store && role.store.toString() !== storeId.toString()) {
    throw new ApiError("Role does not belong to this store", 403);
  }

  // Explicit assignment - no mass assignment
  employee.role = newRoleId;
  await employee.save();

  await logAudit({
    storeId,
    actorUserId,
    targetUserId: employee.user,
    employeeId: employee._id,
    action: "employee.role_updated",
    metadata: {
      newRoleId: role._id.toString(),
      newRoleName: role.name,
    },
  });

  return employee.populate("role", "name permissions");
};

/**
 * Update an employee's role or status (backward compatible wrapper).
 * Avoids unrestricted mass assignment.
 */
export const updateEmployee = async (employeeId, storeId, updateData, actorUserId) => {
  if (updateData.role) {
    return updateEmployeeRole(storeId, employeeId, actorUserId, updateData.role);
  }

  const employee = await Employee.findOne({ _id: employeeId, store: storeId });
  if (!employee) {
    throw new ApiError("Employee record not found", 404);
  }

  // Only allow updating permitted fields
  if (updateData.status) {
    const allowedStatuses = ["active", "suspended", "rejected"];
    if (!allowedStatuses.includes(updateData.status)) {
      throw new ApiError("Invalid status value", 400);
    }
    employee.status = updateData.status;
  }

  await employee.save();
  return employee;
};

/**
 * Suspends an employee membership.
 */
export const suspendEmployee = async (storeId, employeeId, actorUserId) => {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError("Invalid employee ID format", 400);
  }

  const employee = await Employee.findOne({ _id: employeeId, store: storeId });
  if (!employee) {
    throw new ApiError("Employee record not found", 404);
  }

  if (actorUserId && employee.user.toString() === actorUserId.toString()) {
    throw new ApiError("Cannot suspend yourself", 400);
  }

  employee.status = "suspended";
  await employee.save();

  await logAudit({
    storeId,
    actorUserId,
    targetUserId: employee.user,
    employeeId: employee._id,
    action: "employee.suspended",
  });

  return employee;
};

/**
 * Reactivates a suspended employee membership.
 */
export const reactivateEmployee = async (storeId, employeeId, actorUserId) => {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError("Invalid employee ID format", 400);
  }

  const employee = await Employee.findOne({ _id: employeeId, store: storeId });
  if (!employee) {
    throw new ApiError("Employee record not found", 404);
  }

  employee.status = "active";
  await employee.save();

  await logAudit({
    storeId,
    actorUserId,
    targetUserId: employee.user,
    employeeId: employee._id,
    action: "employee.reactivated",
  });

  return employee;
};

/**
 * Removes an employee membership from a store.
 * NOTE: Removes the store Employee membership; preserves the global User account.
 */
export const removeEmployee = async (employeeId, storeId, actorUserId) => {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    throw new ApiError("Invalid employee ID format", 400);
  }

  const employee = await Employee.findOne({ _id: employeeId, store: storeId });
  if (!employee) {
    throw new ApiError("Employee record not found", 404);
  }

  if (actorUserId && employee.user.toString() === actorUserId.toString()) {
    throw new ApiError("Cannot remove yourself from your own store", 400);
  }

  await Employee.deleteOne({ _id: employeeId, store: storeId });

  await logAudit({
    storeId,
    actorUserId,
    targetUserId: employee.user,
    employeeId: employee._id,
    action: "employee.removed",
  });

  return employee;
};

/**
 * Accept invite (called by the employee themselves - legacy support).
 */
export const acceptInvite = async (userId, employeeId) => {
  const employee = await Employee.findOne({ _id: employeeId, user: userId });
  if (!employee) {
    throw new ApiError("Invitation not found", 404);
  }
  if (employee.status !== "pending") {
    throw new ApiError(`Invitation is already ${employee.status}`, 400);
  }

  employee.status = "active";
  employee.joinedAt = new Date();
  await employee.save();

  return employee;
};
