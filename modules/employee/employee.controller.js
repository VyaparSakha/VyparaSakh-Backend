import * as employeeService from "./employee.service.js";
import { ApiResponse } from "../../utils/ApiResponse.js";

export const inviteEmployeeController = async (req, res) => {
  try {
    const { storeId } = req.params;
    const invitedByUserId = req.user._id;
    const employee = await employeeService.inviteEmployee(storeId, invitedByUserId, req.body);
    res.status(201).json(new ApiResponse(employee, "Employee invited successfully", 201));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const getEmployeesController = async (req, res) => {
  try {
    const { storeId } = req.params;
    const employees = await employeeService.getEmployeesByStore(storeId);
    res.status(200).json(new ApiResponse(employees, "Employees fetched successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const getEmployeeByIdController = async (req, res) => {
  try {
    const { storeId, employeeId } = req.params;
    const employee = await employeeService.getEmployeeById(storeId, employeeId);
    res.status(200).json(new ApiResponse(employee, "Employee fetched successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const updateEmployeeRoleController = async (req, res) => {
  try {
    const { storeId, employeeId } = req.params;
    const actorUserId = req.user._id;
    const { roleId } = req.body;
    const employee = await employeeService.updateEmployeeRole(storeId, employeeId, actorUserId, roleId);
    res.status(200).json(new ApiResponse(employee, "Employee role updated successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const updateEmployeeController = async (req, res) => {
  try {
    const { storeId, employeeId } = req.params;
    const actorUserId = req.user._id;
    const employee = await employeeService.updateEmployee(employeeId, storeId, req.body, actorUserId);
    res.status(200).json(new ApiResponse(employee, "Employee updated successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const suspendEmployeeController = async (req, res) => {
  try {
    const { storeId, employeeId } = req.params;
    const actorUserId = req.user._id;
    const employee = await employeeService.suspendEmployee(storeId, employeeId, actorUserId);
    res.status(200).json(new ApiResponse(employee, "Employee suspended successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const reactivateEmployeeController = async (req, res) => {
  try {
    const { storeId, employeeId } = req.params;
    const actorUserId = req.user._id;
    const employee = await employeeService.reactivateEmployee(storeId, employeeId, actorUserId);
    res.status(200).json(new ApiResponse(employee, "Employee reactivated successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const removeEmployeeController = async (req, res) => {
  try {
    const { storeId, employeeId } = req.params;
    const actorUserId = req.user._id;
    const employee = await employeeService.removeEmployee(employeeId, storeId, actorUserId);
    res.status(200).json(new ApiResponse(employee, "Employee removed successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};

export const acceptInviteController = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const userId = req.user._id;
    const employee = await employeeService.acceptInvite(userId, employeeId);
    res.status(200).json(new ApiResponse(employee, "Invitation accepted successfully", 200));
  } catch (error) {
    res.status(error.statusCode || 500).json(
      new ApiResponse(null, error.message || "Internal Server Error", error.statusCode || 500)
    );
  }
};
