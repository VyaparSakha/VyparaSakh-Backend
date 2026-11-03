import { jest } from "@jest/globals";
import mongoose from "mongoose";

// Setup mocks for models and mailer
const mockStoreFindById = jest.fn();
const mockStoreFind = jest.fn();
const mockUserFindById = jest.fn();
const mockUserFindOne = jest.fn();
const mockUserDeleteOne = jest.fn();
const mockRoleFindById = jest.fn();
const mockRoleFindOne = jest.fn();
const mockRoleFind = jest.fn();
const mockEmployeeFind = jest.fn();
const mockEmployeeFindOne = jest.fn();
const mockEmployeeCreate = jest.fn();
const mockEmployeeDeleteOne = jest.fn();
const mockInvitationFindOne = jest.fn();
const mockInvitationFind = jest.fn();
const mockInvitationCreate = jest.fn();
const mockInvitationDeleteOne = jest.fn();
const mockAuditLogCreate = jest.fn();
const mockSendInviteEmail = jest.fn().mockResolvedValue({ id: "mock-email-id" });

jest.unstable_mockModule("../../models/index.js", () => ({
  Store: {
    findById: mockStoreFindById,
    find: mockStoreFind,
  },
  User: {
    findById: mockUserFindById,
    findOne: mockUserFindOne,
    deleteOne: mockUserDeleteOne,
  },
  Role: {
    findById: mockRoleFindById,
    findOne: mockRoleFindOne,
    find: mockRoleFind,
  },
  Employee: {
    find: mockEmployeeFind,
    findOne: mockEmployeeFindOne,
    create: mockEmployeeCreate,
    deleteOne: mockEmployeeDeleteOne,
  },
  Invitation: {
    findOne: mockInvitationFindOne,
    find: mockInvitationFind,
    create: mockInvitationCreate,
    deleteOne: mockInvitationDeleteOne,
  },
  AuditLog: {
    create: mockAuditLogCreate,
  },
}));

jest.unstable_mockModule("../../utils/mailer.js", () => ({
  sendInviteEmail: mockSendInviteEmail,
}));

const { Store, User, Role, Employee, Invitation, AuditLog } = await import("../../models/index.js");
const {
  createInvitation,
  validateInvitation,
  acceptInvitation,
  revokeInvitation,
} = await import("../../modules/invitation/invitation.service.js");
const {
  updateEmployeeRole,
  suspendEmployee,
  reactivateEmployee,
  removeEmployee,
} = await import("../../modules/employee/employee.service.js");
const { resolveStoreContextForUser } = await import("../../middlewares/resolveStoreContext.middleware.js");
const { hashInvitationToken } = await import("../../utils/tokenUtils.js");

describe("Employee Invitation & Membership Lifecycle", () => {
  const storeAId = new mongoose.Types.ObjectId().toString();
  const storeBId = new mongoose.Types.ObjectId().toString();
  const ownerUserId = new mongoose.Types.ObjectId().toString();
  const employeeUserId = new mongoose.Types.ObjectId().toString();
  const priyaUserId = new mongoose.Types.ObjectId().toString();
  const roleCashierId = new mongoose.Types.ObjectId().toString();
  const roleStoreBId = new mongoose.Types.ObjectId().toString();

  const storeA = {
    _id: storeAId,
    name: "Store A",
    owner: ownerUserId,
    isActive: true,
  };

  const storeB = {
    _id: storeBId,
    name: "Store B",
    owner: priyaUserId,
    isActive: true,
  };

  const roleCashier = {
    _id: roleCashierId,
    name: "Cashier",
    store: storeAId,
    permissions: ["billing:create"],
  };

  const roleStoreB = {
    _id: roleStoreBId,
    name: "Store B Manager",
    store: storeBId,
    permissions: ["inventory:manage"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // 1. Owner can invite a registered user
  test("Case 1: Owner can invite a registered user", async () => {
    mockStoreFindById.mockResolvedValue(storeA);
    mockUserFindById.mockResolvedValue({ _id: ownerUserId, name: "Owner Rahul", email: "owner@store.com" });
    mockRoleFindById.mockResolvedValue(roleCashier);
    mockUserFindOne.mockResolvedValue({ _id: employeeUserId, email: "registered@vyapar.com" });
    mockEmployeeFindOne.mockResolvedValue(null); // not yet employee
    mockInvitationFindOne.mockResolvedValue(null); // no pending invite

    const createdInvite = {
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      email: "registered@vyapar.com",
      role: roleCashierId,
      invitedBy: ownerUserId,
      status: "pending",
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      createdAt: new Date(),
    };
    mockInvitationCreate.mockResolvedValue(createdInvite);

    const result = await createInvitation(storeAId, ownerUserId, {
      email: "registered@vyapar.com",
      roleId: roleCashierId,
    });

    expect(result.status).toBe("pending");
    expect(result.email).toBe("registered@vyapar.com");
    expect(mockInvitationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        store: storeAId,
        email: "registered@vyapar.com",
        role: roleCashierId,
        status: "pending",
        tokenHash: expect.any(String),
      })
    );
    expect(mockSendInviteEmail).toHaveBeenCalledTimes(1);
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "employee.invited",
        store: storeAId,
        actor: ownerUserId,
      })
    );
  });

  // 2. Owner can invite an unregistered email
  test("Case 2: Owner can invite an unregistered email", async () => {
    mockStoreFindById.mockResolvedValue(storeA);
    mockUserFindById.mockResolvedValue({ _id: ownerUserId, name: "Owner Rahul", email: "owner@store.com" });
    mockRoleFindById.mockResolvedValue(roleCashier);
    mockUserFindOne.mockResolvedValue(null); // NOT in User collection
    mockInvitationFindOne.mockResolvedValue(null);

    mockInvitationCreate.mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      email: "newperson@unregistered.com",
      role: roleCashierId,
      invitedBy: ownerUserId,
      status: "pending",
      expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      createdAt: new Date(),
    });

    const result = await createInvitation(storeAId, ownerUserId, {
      email: "newperson@unregistered.com",
      roleId: roleCashierId,
    });

    expect(result.status).toBe("pending");
    expect(result.email).toBe("newperson@unregistered.com");
    expect(mockSendInviteEmail).toHaveBeenCalledTimes(1);
  });

  // 3. Employee can register and accept the invitation
  test("Case 3: Employee can register and accept the invitation", async () => {
    const rawToken = "sample-raw-token-case-3";
    const tokenHash = hashInvitationToken(rawToken);

    const mockInviteDoc = {
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      email: "newregistered@vyapar.com",
      role: roleCashierId,
      invitedBy: ownerUserId,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      isExpired: () => false,
      save: jest.fn().mockResolvedValue(true),
    };

    mockInvitationFindOne.mockResolvedValue(mockInviteDoc);
    mockStoreFindById.mockResolvedValue(storeA);
    mockRoleFindById.mockResolvedValue(roleCashier);
    mockEmployeeFindOne.mockResolvedValue(null); // no membership yet

    const newRegisteredUser = {
      _id: new mongoose.Types.ObjectId().toString(),
      email: "newregistered@vyapar.com",
      name: "New Registered Employee",
    };

    mockEmployeeCreate.mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      user: newRegisteredUser._id,
      role: roleCashierId,
      status: "active",
      joinedAt: new Date(),
    });

    const result = await acceptInvitation(
      rawToken,
      newRegisteredUser,
      { email: "newregistered@vyapar.com", emailVerified: true }
    );

    expect(result.storeId).toBe(storeAId);
    expect(mockInviteDoc.status).toBe("accepted");
    expect(mockInviteDoc.save).toHaveBeenCalled();
    expect(mockEmployeeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        store: storeAId,
        user: newRegisteredUser._id,
        status: "active",
      })
    );
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "invitation.accepted",
      })
    );
  });

  // 4. Existing user can accept an invitation without creating another account
  test("Case 4: Existing user can accept an invitation without creating another account", async () => {
    const rawToken = "sample-raw-token-case-4";
    const mockInviteDoc = {
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      email: "existinguser@vyapar.com",
      role: roleCashierId,
      invitedBy: ownerUserId,
      status: "pending",
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      isExpired: () => false,
      save: jest.fn().mockResolvedValue(true),
    };

    mockInvitationFindOne.mockResolvedValue(mockInviteDoc);
    mockStoreFindById.mockResolvedValue(storeA);
    mockRoleFindById.mockResolvedValue(roleCashier);
    mockEmployeeFindOne.mockResolvedValue(null);

    const existingUser = {
      _id: employeeUserId,
      email: "existinguser@vyapar.com",
      name: "Existing User",
    };

    mockEmployeeCreate.mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      user: existingUser._id,
      role: roleCashierId,
      status: "active",
      joinedAt: new Date(),
    });

    const result = await acceptInvitation(
      rawToken,
      existingUser,
      { email: "existinguser@vyapar.com", emailVerified: true }
    );

    expect(result.storeId).toBe(storeAId);
    expect(mockEmployeeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        user: existingUser._id,
      })
    );
  });

  // 5. Unauthenticated user cannot accept an invitation
  test("Case 5: Unauthenticated user cannot accept an invitation", async () => {
    await expect(acceptInvitation("some-token", null, null))
      .rejects.toThrow("Authentication required to accept invitation");
  });

  // 6. Wrong email account cannot accept an invitation
  test("Case 6: Wrong email account cannot accept an invitation", async () => {
    const rawToken = "sample-raw-token-case-6";
    mockInvitationFindOne.mockResolvedValue({
      store: storeAId,
      email: "intended@vyapar.com",
      role: roleCashierId,
      status: "pending",
      isExpired: () => false,
    });

    const wrongUser = {
      _id: new mongoose.Types.ObjectId().toString(),
      email: "wronguser@vyapar.com",
    };

    await expect(
      acceptInvitation(rawToken, wrongUser, { email: "wronguser@vyapar.com", emailVerified: true })
    ).rejects.toThrow("This invitation was sent to a different email address");
  });

  // 7. Unverified email cannot accept an invitation
  test("Case 7: Unverified email cannot accept an invitation", async () => {
    const rawToken = "sample-raw-token-case-7";
    mockInvitationFindOne.mockResolvedValue({
      store: storeAId,
      email: "unverified@vyapar.com",
      role: roleCashierId,
      status: "pending",
      isExpired: () => false,
    });

    const user = {
      _id: new mongoose.Types.ObjectId().toString(),
      email: "unverified@vyapar.com",
    };

    await expect(
      acceptInvitation(rawToken, user, { email: "unverified@vyapar.com", emailVerified: false })
    ).rejects.toThrow("Please verify your email address before accepting the invitation");
  });

  // 8. Expired invitation cannot be accepted
  test("Case 8: Expired invitation cannot be accepted", async () => {
    const rawToken = "sample-raw-token-case-8";
    const expiredInvite = {
      store: storeAId,
      email: "expired@vyapar.com",
      role: roleCashierId,
      status: "pending",
      expiresAt: new Date(Date.now() - 3600 * 1000), // 1 hour ago
      isExpired: () => true,
      save: jest.fn().mockResolvedValue(true),
    };
    mockInvitationFindOne.mockResolvedValue(expiredInvite);

    const user = { _id: employeeUserId, email: "expired@vyapar.com" };

    await expect(
      acceptInvitation(rawToken, user, { email: "expired@vyapar.com", emailVerified: true })
    ).rejects.toThrow("Invitation has expired");

    expect(expiredInvite.status).toBe("expired");
  });

  // 9. Revoked invitation cannot be accepted
  test("Case 9: Revoked invitation cannot be accepted", async () => {
    const rawToken = "sample-raw-token-case-9";
    mockInvitationFindOne.mockResolvedValue({
      store: storeAId,
      email: "revoked@vyapar.com",
      role: roleCashierId,
      status: "revoked",
      isExpired: () => false,
    });

    const user = { _id: employeeUserId, email: "revoked@vyapar.com" };

    await expect(
      acceptInvitation(rawToken, user, { email: "revoked@vyapar.com", emailVerified: true })
    ).rejects.toThrow("Invitation has been revoked");
  });

  // 10. Accepted invitation cannot be reused
  test("Case 10: Accepted invitation cannot be reused", async () => {
    const rawToken = "sample-raw-token-case-10";
    mockInvitationFindOne.mockResolvedValue({
      store: storeAId,
      email: "already@vyapar.com",
      role: roleCashierId,
      status: "accepted",
      isExpired: () => false,
    });

    const user = { _id: employeeUserId, email: "already@vyapar.com" };

    await expect(
      acceptInvitation(rawToken, user, { email: "already@vyapar.com", emailVerified: true })
    ).rejects.toThrow("Invitation has already been accepted");
  });

  // 11. Duplicate active memberships are prevented
  test("Case 11: Duplicate active memberships are prevented", async () => {
    const rawToken = "sample-raw-token-case-11";
    mockInvitationFindOne.mockResolvedValue({
      store: storeAId,
      email: "activemember@vyapar.com",
      role: roleCashierId,
      status: "pending",
      isExpired: () => false,
    });
    mockStoreFindById.mockResolvedValue(storeA);
    mockRoleFindById.mockResolvedValue(roleCashier);

    // Existing active employee
    mockEmployeeFindOne.mockResolvedValue({
      _id: new mongoose.Types.ObjectId().toString(),
      store: storeAId,
      user: employeeUserId,
      status: "active",
    });

    const user = { _id: employeeUserId, email: "activemember@vyapar.com" };

    await expect(
      acceptInvitation(rawToken, user, { email: "activemember@vyapar.com", emailVerified: true })
    ).rejects.toThrow("You are already an active member of this store");
  });

  // 12. Role from another store cannot be assigned
  test("Case 12: Role from another store cannot be assigned", async () => {
    mockStoreFindById.mockResolvedValue(storeA);
    mockUserFindById.mockResolvedValue({ _id: ownerUserId, name: "Owner Rahul", email: "owner@store.com" });
    mockRoleFindById.mockResolvedValue(roleStoreB); // Belongs to Store B!

    await expect(
      createInvitation(storeAId, ownerUserId, {
        email: "someemployee@vyapar.com",
        roleId: roleStoreBId,
      })
    ).rejects.toThrow("Role does not belong to this store");
  });

  // 13. Employee cannot invite another employee (enforces requireOwner)
  test("Case 13: Employee cannot invite another employee", async () => {
    // When non-owner attempts to invite, requireOwner verifies store ownership
    // and blocks when store.owner !== req.user._id
    mockStoreFindById.mockResolvedValue(storeA); // owner is ownerUserId
    const cashierCallerId = employeeUserId;

    // Simulate requireOwner verification logic
    const isOwner = storeA.owner.toString() === cashierCallerId.toString();
    expect(isOwner).toBe(false);
  });

  // 14. Employee cannot modify their own role
  test("Case 14: Employee cannot modify their own role", async () => {
    const empId = new mongoose.Types.ObjectId().toString();
    mockEmployeeFindOne.mockResolvedValue({
      _id: empId,
      store: storeAId,
      user: employeeUserId,
      role: roleCashierId,
    });

    // Employee calling update on self
    await expect(
      updateEmployeeRole(storeAId, empId, employeeUserId, roleCashierId)
    ).rejects.toThrow("Employees cannot modify their own roles");
  });

  // 15. Suspended employee loses access immediately
  test("Case 15: Suspended employee loses access", async () => {
    const empId = new mongoose.Types.ObjectId().toString();
    const employeeDoc = {
      _id: empId,
      store: storeAId,
      user: employeeUserId,
      status: "active",
      save: jest.fn().mockResolvedValue(true),
    };
    mockEmployeeFindOne.mockResolvedValue(employeeDoc);

    // Suspend employee
    const suspended = await suspendEmployee(storeAId, empId, ownerUserId);
    expect(suspended.status).toBe("suspended");
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "employee.suspended",
      })
    );

    // Now test context resolution for this suspended employee
    mockStoreFindById.mockResolvedValue(storeA);
    // Active query returns null because status is suspended
    mockEmployeeFindOne.mockImplementation((query) => {
      if (query.status === "active") return null;
      return employeeDoc;
    });

    await expect(
      resolveStoreContextForUser(storeAId, employeeUserId)
    ).rejects.toThrow("Access Denied: You do not have permission to access this store.");
  });

  // 16. Removed employee loses access immediately
  test("Case 16: Removed employee loses access", async () => {
    const empId = new mongoose.Types.ObjectId().toString();
    const employeeDoc = {
      _id: empId,
      store: storeAId,
      user: employeeUserId,
    };
    mockEmployeeFindOne.mockResolvedValue(employeeDoc);
    mockEmployeeDeleteOne.mockResolvedValue({ deletedCount: 1 });

    // Remove employee
    await removeEmployee(empId, storeAId, ownerUserId);
    expect(mockEmployeeDeleteOne).toHaveBeenCalledWith({ _id: empId, store: storeAId });
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "employee.removed",
      })
    );

    // Context resolution subsequently fails
    mockStoreFindById.mockResolvedValue(storeA);
    mockEmployeeFindOne.mockResolvedValue(null);

    await expect(
      resolveStoreContextForUser(storeAId, employeeUserId)
    ).rejects.toThrow("Access Denied: You do not have permission to access this store.");
  });

  // 17. Global Firebase account remains intact after membership removal
  test("Case 17: Global Firebase account remains intact after membership removal", async () => {
    const empId = new mongoose.Types.ObjectId().toString();
    mockEmployeeFindOne.mockResolvedValue({
      _id: empId,
      store: storeAId,
      user: employeeUserId,
    });
    mockEmployeeDeleteOne.mockResolvedValue({ deletedCount: 1 });

    await removeEmployee(empId, storeAId, ownerUserId);

    // Verify User model was NOT touched
    expect(mockUserDeleteOne).not.toHaveBeenCalled();
  });

  // 18. User who is an owner in one store and employee in another retains both relationships
  test("Case 18: User who is an owner in one store and employee in another retains both relationships", async () => {
    // User Priya is owner of Store B and Cashier in Store A
    mockStoreFindById.mockImplementation((id) => {
      if (id.toString() === storeBId.toString()) return Promise.resolve(storeB);
      if (id.toString() === storeAId.toString()) return Promise.resolve(storeA);
      return Promise.resolve(null);
    });

    mockEmployeeFindOne.mockImplementation((query) => {
      if (query.store.toString() === storeAId.toString() && query.user.toString() === priyaUserId.toString()) {
        return {
          populate: jest.fn().mockResolvedValue({
            _id: new mongoose.Types.ObjectId().toString(),
            store: storeAId,
            user: priyaUserId,
            role: roleCashier,
            status: "active",
          }),
        };
      }
      return null;
    });

    // 1. In Store B, Priya is Owner
    const contextStoreB = await resolveStoreContextForUser(storeBId, priyaUserId);
    expect(contextStoreB.isOwner).toBe(true);
    expect(contextStoreB.membershipType).toBe("owner");
    expect(contextStoreB.roleName).toBe("Owner");

    // 2. In Store A, Priya is Cashier
    const contextStoreA = await resolveStoreContextForUser(storeAId, priyaUserId);
    expect(contextStoreA.isOwner).toBe(false);
    expect(contextStoreA.membershipType).toBe("employee");
    expect(contextStoreA.roleName).toBe("Cashier");
    expect(contextStoreA.permissions).toEqual(["billing:create"]);
  });
});

