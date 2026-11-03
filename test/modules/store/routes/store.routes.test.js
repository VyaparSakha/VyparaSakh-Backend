import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const mockStoreCreateController = jest.fn((req, res) => {
  return res.status(201).json({
    message: "Store created successfully",
    owner: req.user._id,
    body: req.body,
  });
});

const mockAuthMiddleware = jest.fn((req, _res, next) => {
  req.user = { _id: "user-123", firebaseUid: "firebase-123" };
  next();
});

const mockRequireUser = jest.fn((_req, _res, next) => {
  next();
});

const mockRequireStoreCreationEligibility = jest.fn((_req, _res, next) => {
  next();
});

jest.unstable_mockModule(
  "../../../../modules/store/store.controller.js",
  () => ({
    storeCreateController: mockStoreCreateController,
    storeGetController: jest.fn(),
    storeUpdateController: jest.fn(),
    storeDeleteController: jest.fn(),
    storeGetAllController: jest.fn(),
    storeSendInstantStockAlertController: jest.fn(),
    storeOverviewController: jest.fn(),
  }),
);

jest.unstable_mockModule("../../../../middlewares/auth.middleware.js", () => ({
  default: mockAuthMiddleware,
}));

jest.unstable_mockModule(
  "../../../../middlewares/requireUser.middleware.js",
  () => ({
    default: mockRequireUser,
  }),
);

jest.unstable_mockModule(
  "../../../../middlewares/storePolicy.middleware.js",
  () => ({
    requireStoreCreationEligibility: mockRequireStoreCreationEligibility,
  }),
);

const { default: storeRouter } =
  await import("../../../../modules/store/store.routes.js");

describe("store.routes POST /create", () => {
  beforeEach(() => {
    mockStoreCreateController.mockClear();
    mockAuthMiddleware.mockClear();
    mockRequireUser.mockClear();
    mockRequireStoreCreationEligibility.mockClear();
  });

  test("runs auth + requireUser and reaches create controller", async () => {
    const app = express();
    app.use(express.json());
    app.use("/stores", storeRouter);

    const payload = {
      name: "Super Mart",
      phone: "9876543210",
      address: {
        fullAddress: "MG Road, Bengaluru",
      },
    };

    const response = await request(app).post("/stores/create").send(payload);

    expect(mockAuthMiddleware).toHaveBeenCalledTimes(1);
    expect(mockRequireUser).toHaveBeenCalledTimes(1);
    expect(mockStoreCreateController).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      message: "Store created successfully",
      owner: "user-123",
      body: payload,
    });
  });
});
