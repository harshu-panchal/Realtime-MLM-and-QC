/**
 * One-time migration: backfill Seller.businessType and Category.businessType
 * for documents created before the Quick Commerce / E-commerce split.
 *
 * Every pre-existing seller defaults to "quick_commerce" (matches current
 * app behavior/branding — all existing sellers already have location +
 * serviceRadius configured). Every pre-existing category defaults to "both"
 * so it stays visible under both tabs until an admin explicitly re-tags it.
 *
 * Idempotent — guarded by $exists, safe to re-run.
 * Run: node scripts/migrate-seller-business-type.js
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Seller from "../app/models/seller.js";
import Category from "../app/models/category.js";

dotenv.config();

export async function backfillBusinessType() {
  const sellerResult = await Seller.updateMany(
    { businessType: { $exists: false } },
    { $set: { businessType: "quick_commerce" } },
  );

  const categoryResult = await Category.updateMany(
    { businessType: { $exists: false } },
    { $set: { businessType: "both" } },
  );

  return {
    sellersMatched: sellerResult.matchedCount,
    sellersModified: sellerResult.modifiedCount,
    categoriesMatched: categoryResult.matchedCount,
    categoriesModified: categoryResult.modifiedCount,
  };
}

async function run() {
  await connectDB();
  const result = await backfillBusinessType();
  console.log(
    `[migrate-seller-business-type] Sellers matched: ${result.sellersMatched}, modified: ${result.sellersModified}`,
  );
  console.log(
    `[migrate-seller-business-type] Categories matched: ${result.categoriesMatched}, modified: ${result.categoriesModified}`,
  );
  process.exit(0);
}

// Only auto-run when executed directly (`node scripts/migrate-seller-business-type.js`),
// not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith("migrate-seller-business-type.js")) {
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
