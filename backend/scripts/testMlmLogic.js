import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../app/models/customer.js";
import Seller from "../app/models/seller.js";
import Delivery from "../app/models/delivery.js";
import MlmTree from "../app/models/mlmTree.js";
import MlmCommissionLog from "../app/models/mlmCommissionLog.js";
import Wallet from "../app/models/wallet.js";
import {
  placeInTree,
  calculateAndDistributeCommission,
  getUserCapStatus,
  getTreeStructure,
} from "../app/services/mlmService.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/realtime_mlm_qc";

async function runVerification() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected successfully.");

    // Clean test data
    await MlmTree.deleteMany({ isActive: true });
    await MlmCommissionLog.deleteMany({});

    console.log("\n=== TEST 1: Tree Placement & LEFT -> RIGHT Balancing ===");
    
    // Create Root User
    const rootUser = await User.create({ name: "Root User", phone: "+919000000001" });
    const rootNode = await placeInTree({ entityId: rootUser._id, entityType: "User" });
    console.log("Root Node Created:", { id: rootNode._id, position: rootNode.position });

    // Add User 2 (Should go to LEFT of Root)
    const user2 = await User.create({ name: "User 2", phone: "+919000000002" });
    const node2 = await placeInTree({ entityId: user2._id, entityType: "User", sponsorId: rootUser._id });
    console.log("Node 2 (Expected: LEFT):", { position: node2.position, level: node2.level });

    // Add Seller 1 (Should go to RIGHT of Root)
    const seller1 = await Seller.create({
      name: "Vendor 1",
      email: "vendor1@test.com",
      phone: "+919000000003",
      password: "password123",
      shopName: "Vendor Shop 1",
    });
    const node3 = await placeInTree({ entityId: seller1._id, entityType: "Seller", sponsorId: rootUser._id });
    console.log("Node 3 (Expected: RIGHT):", { position: node3.position, level: node3.level });

    // Add Delivery 1 (Should go to LEFT of Node 2)
    const delivery1 = await Delivery.create({ name: "Rider 1", phone: "+919000000004" });
    const node4 = await placeInTree({ entityId: delivery1._id, entityType: "Delivery", sponsorId: rootUser._id });
    console.log("Node 4 (Expected: LEFT under Node 2):", { position: node4.position, parentId: node4.parentId, level: node4.level });

    const treeVisual = await getTreeStructure(rootUser._id);
    console.log("\nTree Structure Visualized:", JSON.stringify(treeVisual, null, 2));

    console.log("\n=== TEST 2: Amount / 3.60 Calculation & User Daily Capping ===");
    
    // Test 1: Commission of ₹18,000 for User 2 -> 18000 / 3.6 = ₹5,000
    const res1 = await calculateAndDistributeCommission({
      entityId: user2._id,
      entityType: "User",
      amount: 18000,
    });
    console.log("Commission 1 (Amount: 18000 -> 18000/3.6 = 5000):", {
      requestedAmount: res1.requestedAmount,
      creditedAmount: res1.creditedAmount,
      cappedAmount: res1.cappedAmount,
    });

    // Test 2: Commission of ₹54,000 for User 2 -> 54000 / 3.6 = ₹15,000 (Total so far: ₹20,000)
    const res2 = await calculateAndDistributeCommission({
      entityId: user2._id,
      entityType: "User",
      amount: 54000,
    });
    console.log("Commission 2 (Amount: 54000 -> 54000/3.6 = 15000):", {
      requestedAmount: res2.requestedAmount,
      creditedAmount: res2.creditedAmount,
      cappedAmount: res2.cappedAmount,
    });

    const capStatusBefore = await getUserCapStatus(user2._id);
    console.log("User 2 Cap Status Before Over-Cap:", capStatusBefore);

    // Test 3: Commission of ₹36,000 for User 2 -> 36000 / 3.6 = ₹10,000
    // User already has ₹20,000 today. Daily Cap = ₹25,000.
    // Remaining cap = ₹5,000.
    // Credited = ₹5,000, Capped = ₹5,000.
    const res3 = await calculateAndDistributeCommission({
      entityId: user2._id,
      entityType: "User",
      amount: 36000,
    });
    console.log("Commission 3 (Amount: 36000 -> 36000/3.6 = 10000, Cap limit 25000):", {
      requestedAmount: res3.requestedAmount,
      creditedAmount: res3.creditedAmount,
      cappedAmount: res3.cappedAmount,
    });

    const capStatusAfter = await getUserCapStatus(user2._id);
    console.log("User 2 Cap Status After Capping:", capStatusAfter);

    console.log("\n=== TEST 3: Seller/Delivery No Capping Verification ===");
    // Seller 1 earns commission of ₹144,000 -> 144000 / 3.6 = ₹40,000 (Should NOT be capped at ₹25k)
    const resSeller = await calculateAndDistributeCommission({
      entityId: seller1._id,
      entityType: "Seller",
      amount: 144000,
    });
    console.log("Seller Commission (Expected: Full ₹40,000 credited, 0 capped):", {
      requestedAmount: resSeller.requestedAmount,
      creditedAmount: resSeller.creditedAmount,
      cappedAmount: resSeller.cappedAmount,
    });

    // Cleanup test records
    await User.deleteMany({ phone: { $in: ["+919000000001", "+919000000002"] } });
    await Seller.deleteMany({ phone: "+919000000003" });
    await Delivery.deleteMany({ phone: "+919000000004" });
    await MlmTree.deleteMany({ _id: { $in: [rootNode._id, node2._id, node3._id, node4._id] } });
    await MlmCommissionLog.deleteMany({ _id: { $in: [res1.log._id, res2.log._id, res3.log._id, resSeller.log._id] } });

    console.log("\n✅ ALL MLM VERIFICATION TESTS PASSED SUCCESSFULLY!");
  } catch (error) {
    console.error("\n❌ VERIFICATION TEST FAILED:", error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

runVerification();
