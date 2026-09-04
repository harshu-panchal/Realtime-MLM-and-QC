import mongoose from "mongoose";

/**
 * Verifies the Seller/Category businessType backfill migration
 * (scripts/migrate-seller-business-type.js):
 *  - pre-existing sellers default to "quick_commerce"
 *  - pre-existing categories default to "both"
 *  - re-running is a no-op (idempotent)
 *
 * Requires a real Mongo connection, gated the same way as the
 * other DB-backed tests in this suite (order-deletion-on-refresh-bug.test.js).
 */
const RUN_DB_TESTS = process.env.RUN_DB_TESTS === "true";
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb("Seller/Category businessType backfill migration", () => {
  let Seller, Category, backfillBusinessType;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(
        process.env.MONGODB_TEST_URI || "mongodb://localhost:27017/test-business-type-migration",
      );
    }

    Seller = (await import("../app/models/seller.js")).default;
    Category = (await import("../app/models/category.js")).default;
    backfillBusinessType = (await import("../scripts/migrate-seller-business-type.js"))
      .backfillBusinessType;
  });

  beforeEach(async () => {
    await Seller.deleteMany({});
    await Category.deleteMany({});
  });

  afterAll(async () => {
    await Seller.deleteMany({});
    await Category.deleteMany({});
    await mongoose.disconnect();
  });

  async function insertLegacySeller(overrides = {}) {
    // Bypass schema defaults for businessType by writing directly to the
    // collection, simulating a document created before the field existed.
    const doc = {
      name: "Legacy Seller",
      email: `legacy-${Date.now()}-${Math.random()}@example.com`,
      phone: `9${Math.floor(Math.random() * 1000000000)}`,
      password: "hashed",
      shopName: "Legacy Shop",
      applicationStatus: "approved",
      isActive: true,
      ...overrides,
    };
    const result = await Seller.collection.insertOne(doc);
    return result.insertedId;
  }

  async function insertLegacyCategory(overrides = {}) {
    const doc = {
      name: `Legacy Category ${Date.now()}-${Math.random()}`,
      slug: `legacy-category-${Date.now()}-${Math.random()}`,
      type: "header",
      status: "active",
      ...overrides,
    };
    const result = await Category.collection.insertOne(doc);
    return result.insertedId;
  }

  it("defaults pre-existing sellers to quick_commerce and categories to both", async () => {
    const sellerId = await insertLegacySeller();
    const categoryId = await insertLegacyCategory();

    const result = await backfillBusinessType();

    expect(result.sellersModified).toBeGreaterThanOrEqual(1);
    expect(result.categoriesModified).toBeGreaterThanOrEqual(1);

    const seller = await Seller.findById(sellerId).lean();
    const category = await Category.findById(categoryId).lean();
    expect(seller.businessType).toBe("quick_commerce");
    expect(category.businessType).toBe("both");
  });

  it("does not override a businessType already set explicitly", async () => {
    const sellerId = await insertLegacySeller({ businessType: "ecommerce" });
    const categoryId = await insertLegacyCategory({ businessType: "quick_commerce" });

    await backfillBusinessType();

    const seller = await Seller.findById(sellerId).lean();
    const category = await Category.findById(categoryId).lean();
    expect(seller.businessType).toBe("ecommerce");
    expect(category.businessType).toBe("quick_commerce");
  });

  it("is idempotent — re-running after a first run modifies nothing further", async () => {
    await insertLegacySeller();
    await insertLegacyCategory();

    const first = await backfillBusinessType();
    expect(first.sellersModified).toBeGreaterThanOrEqual(1);
    expect(first.categoriesModified).toBeGreaterThanOrEqual(1);

    const second = await backfillBusinessType();
    expect(second.sellersModified).toBe(0);
    expect(second.categoriesModified).toBe(0);
  });
});
