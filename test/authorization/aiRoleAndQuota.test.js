import { jest } from "@jest/globals";
import mongoose from "mongoose";
import User from "../../models/user.model.js";
import Store from "../../models/store.model.js";
import Employee from "../../models/employee.model.js";
import Role from "../../models/role.model.js";

describe("Account-Level AI Subscription Quota & Multi-Tenant Scoping", () => {
  describe("User Model AI Quota & Auto-Rollover", () => {
    test("new or existing user defaults to free tier with 250 monthly credits", () => {
      const user = new User({
        firebaseUid: "uid_owner_1",
        name: "Ramesh Sharma",
        email: "ramesh@example.com",
      });

      expect(user.hasAiCredits()).toBe(true);
      expect(user.aiSubscription.plan).toBe("free");
      expect(user.aiSubscription.monthlyLimit).toBe(250);
      expect(user.aiSubscription.usedCredits).toBe(0);
      expect(user.aiSubscription.status).toBe("active");
    });

    test("consumeAiCredit increments credits and marks exhausted when limit reached", async () => {
      const user = new User({
        firebaseUid: "uid_owner_2",
        name: "Suresh Gupta",
        email: "suresh@example.com",
        aiSubscription: {
          plan: "starter",
          monthlyLimit: 2,
          usedCredits: 0,
          periodEnd: new Date(Date.now() + 86400000),
          status: "active",
        },
      });

      user.save = jest.fn().mockResolvedValue(user);

      expect(user.hasAiCredits()).toBe(true);

      await user.consumeAiCredit(1);
      expect(user.aiSubscription.usedCredits).toBe(1);
      expect(user.hasAiCredits()).toBe(true);

      await user.consumeAiCredit(1);
      expect(user.aiSubscription.usedCredits).toBe(2);
      expect(user.aiSubscription.status).toBe("exhausted");
      expect(user.hasAiCredits()).toBe(false);
    });

    test("auto-resets quota when billing period has expired", async () => {
      const pastDate = new Date(Date.now() - 1000); // Already expired
      const user = new User({
        firebaseUid: "uid_owner_3",
        name: "Pooja Patel",
        email: "pooja@example.com",
        aiSubscription: {
          plan: "starter",
          monthlyLimit: 100,
          usedCredits: 100,
          periodEnd: pastDate,
          status: "exhausted",
        },
      });

      // hasAiCredits should detect periodEnd < now and reset usedCredits to 0
      expect(user.hasAiCredits()).toBe(true);
      expect(user.aiSubscription.usedCredits).toBe(0);
      expect(user.aiSubscription.status).toBe("active");
      expect(new Date(user.aiSubscription.periodEnd) > new Date()).toBe(true);
    });
  });

  describe("Owner Global Pool Shared Across Stores & Employees", () => {
    test("owner with multiple stores shares one subscription quota across all stores", () => {
      const ownerUser = new User({
        _id: new mongoose.Types.ObjectId(),
        firebaseUid: "owner_multi",
        name: "Anil Ambani",
        email: "anil@retail.com",
        aiSubscription: {
          plan: "pro",
          monthlyLimit: 1000,
          usedCredits: 150,
          status: "active",
        },
      });

      // Store A (Grocery) and Store B (Electronics) both point to ownerUser._id
      const storeA = new Store({
        _id: new mongoose.Types.ObjectId(),
        name: "Anil Groceries",
        owner: ownerUser._id,
        ownerFirebaseUid: ownerUser.firebaseUid,
        phone: "9876543210",
        address: { fullAddress: "Shop 1, Mumbai" },
      });

      const storeB = new Store({
        _id: new mongoose.Types.ObjectId(),
        name: "Anil Electronics",
        owner: ownerUser._id,
        ownerFirebaseUid: ownerUser.firebaseUid,
        phone: "9876543211",
        address: { fullAddress: "Shop 2, Mumbai" },
      });

      // Both stores refer to the same owner account
      expect(storeA.owner.toString()).toBe(ownerUser._id.toString());
      expect(storeB.owner.toString()).toBe(ownerUser._id.toString());

      // Queries in either store will debit ownerUser.aiSubscription
      expect(ownerUser.hasAiCredits()).toBe(true);
      expect(ownerUser.aiSubscription.monthlyLimit - ownerUser.aiSubscription.usedCredits).toBe(850);
    });
  });
});
