import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../shared/errors/app-error.js";
import { recordAudit } from "../auth/audit.service.js";
import type {
  CatalogueProductQuery,
  CompatibilityInput,
  CreateBrandInput,
  CreateCategoryInput,
  CreateProductInput,
  PaginationQuery,
  ProductNumberInput,
  UpdateBrandInput,
  UpdateCategoryInput,
  UpdateCompatibilityInput,
  UpdateProductInput,
  UpdateProductNumberInput,
} from "./catalogue.schemas.js";
import type { CatalogueCache } from "./catalogue.cache.js";
import { listingImageUrl } from "../inventory/listing-image.service.js";

const productInclude = {
  category: { select: { id: true, name: true, slug: true, isActive: true } },
  brand: { select: { id: true, name: true, slug: true, isActive: true } },
  numbers: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
  compatibility: { orderBy: [{ make: "asc" }, { model: "asc" }] },
} satisfies Prisma.ProductInclude;

const publicInventoryWhere = (
  now: Date,
  classification?: "NEW_GENUINE" | "NEW_AFTERMARKET" | "USED",
): Prisma.SupplierInventoryWhereInput => ({
  isActive: true,
  isAvailable: true,
  publicationStatus: "PUBLISHED",
  moderationStatus: "APPROVED",
  listingClassification: classification ?? { not: null },
  availabilityStatus: { in: ["IN_STOCK", "LOW_STOCK"] },
  stockQuantity: { gt: 0 },
  OR: [{ images: { some: { isPrimary: true } } }, { legacyImageExempt: true }],
  business: {
    status: "ACTIVE",
    members: { some: { isActive: true, leftAt: null } },
    OR: [
      { subscriptionGraceEndsAt: { gt: now } },
      {
        subscriptions: {
          some: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gt: now } },
        },
      },
    ],
  },
});

function notFound(
  entity: "category" | "brand" | "product" | "part number" | "compatibility",
) {
  return new AppError(`Catalogue ${entity} was not found`, {
    code: `CATALOGUE_${entity.toUpperCase().replaceAll(" ", "_")}_NOT_FOUND`,
    statusCode: 404,
  });
}

function conflict(message: string) {
  return new AppError(message, { code: "CATALOGUE_CONFLICT", statusCode: 409 });
}

function normalizeNumber(value: string): string {
  return value.trim().toUpperCase();
}

export class CatalogueService {
  constructor(
    private readonly database: PrismaClient,
    private readonly cache?: CatalogueCache,
  ) {}

  async invalidateCache() {
    await this.cache?.invalidate();
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (process.env.NODE_ENV === "test") return load();
    const cached = await this.cache?.get<T>(key);
    if (cached != null) return cached;
    const value = await load();
    await this.cache?.set(key, value);
    return value;
  }

  private async translateUniqueError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw conflict("A catalogue record already uses that unique value");
      }
      throw error;
    }
  }

  private async assertCategoryParent(
    categoryId: string | undefined,
    parentId: string | null,
  ) {
    if (!parentId) return;
    if (categoryId === parentId) throw conflict("A category cannot be its own parent");
    let current: string | null = parentId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current) || current === categoryId) {
        throw conflict("Category parent would create a cycle");
      }
      visited.add(current);
      const parent: { parentId: string | null } | null =
        await this.database.partCategory.findUnique({
          where: { id: current },
          select: { parentId: true },
        });
      if (!parent) throw notFound("category");
      current = parent.parentId;
    }
  }

  async createCategory(
    input: CreateCategoryInput,
    actorUserId: string,
    requestId: string,
  ) {
    await this.assertCategoryParent(undefined, input.parentId ?? null);
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        const category = await tx.partCategory.create({ data: input });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_CATEGORY_CREATED",
          entityType: "PART_CATEGORY",
          entityId: category.id,
          requestId,
          metadata: { isActive: category.isActive },
        });
        return category;
      }),
    );
  }

  async listCategories(query: PaginationQuery) {
    const where: Prisma.PartCategoryWhereInput = {
      isActive: query.isActive,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.partCategory.findMany({
        where,
        include: { parent: { select: { id: true, name: true, slug: true } } },
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.partCategory.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async listPublicCategories(query: PaginationQuery) {
    return this.cached(`categories:${JSON.stringify(query)}`, async () => {
      const where: Prisma.PartCategoryWhereInput = {
        isActive: true,
        ...(query.search
          ? { name: { contains: query.search, mode: "insensitive" } }
          : {}),
      };
      const [items, total] = await this.database.$transaction([
        this.database.partCategory.findMany({
          where,
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            imagePath: true,
          },
          orderBy: { name: "asc" },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.database.partCategory.count({ where }),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async listPublicProducts(query: CatalogueProductQuery) {
    return this.cached(`products:${JSON.stringify(query)}`, async () => {
      const now = new Date();
      const inventoryWhere = publicInventoryWhere(now, query.classification);
      const where: Prisma.ProductWhereInput = {
        isActive: true,
        deletedAt: null,
        categoryId: query.categoryId,
        brandId: query.brandId,
        category: { isActive: true },
        AND: [
          { OR: [{ brandId: null }, { brand: { isActive: true } }] },
          { inventory: { some: inventoryWhere } },
        ],
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: "insensitive" } },
                { description: { contains: query.search, mode: "insensitive" } },
                { category: { name: { contains: query.search, mode: "insensitive" } } },
                { brand: { name: { contains: query.search, mode: "insensitive" } } },
                {
                  numbers: {
                    some: { partNumber: { contains: query.search, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {}),
        ...(query.make || query.model || query.year
          ? {
              compatibility: {
                some: {
                  make: query.make
                    ? { contains: query.make, mode: "insensitive" }
                    : undefined,
                  model: query.model
                    ? { contains: query.model, mode: "insensitive" }
                    : undefined,
                  ...(query.year
                    ? {
                        AND: [
                          { OR: [{ yearFrom: null }, { yearFrom: { lte: query.year } }] },
                          { OR: [{ yearTo: null }, { yearTo: { gte: query.year } }] },
                        ],
                      }
                    : {}),
                },
              },
            }
          : {}),
      };
      const [rows, total] = await this.database.$transaction([
        this.database.product.findMany({
          where,
          select: {
            id: true,
            catalogueCode: true,
            name: true,
            description: true,
            imagePath: true,
            category: { select: { id: true, name: true, slug: true, imagePath: true } },
            brand: { select: { id: true, name: true, slug: true } },
            numbers: {
              select: { partNumber: true, isPrimary: true, manufacturer: true },
              orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            },
            compatibility: {
              select: {
                make: true,
                model: true,
                yearFrom: true,
                yearTo: true,
                variant: true,
                notes: true,
              },
              orderBy: [{ make: "asc" }, { model: "asc" }],
            },
            inventory: {
              where: inventoryWhere,
              select: {
                id: true,
                unitPrice: true,
                preparationTimeMin: true,
                listingClassification: true,
                images: {
                  orderBy: { displayOrder: "asc" },
                  select: {
                    id: true,
                    version: true,
                    width: true,
                    height: true,
                    isPrimary: true,
                  },
                },
              },
            },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.database.product.count({ where }),
      ]);
      const items = rows.map(({ inventory, ...product }) => ({
        ...product,
        imagePath: inventory
          .flatMap((offer) => offer.images)
          .find((image) => image.isPrimary)
          ? listingImageUrl(
              inventory
                .flatMap((offer) => offer.images)
                .find((image) => image.isPrimary)!,
            )
          : (product.imagePath ?? product.category.imagePath),
        image: (() => {
          const image = inventory
            .flatMap((offer) => offer.images)
            .find((candidate) => candidate.isPrimary);
          return image ? { ...image, url: listingImageUrl(image) } : null;
        })(),
        priceFrom:
          inventory
            .filter((offer) => offer.listingClassification !== "USED")
            .reduce<Prisma.Decimal | null>(
              (lowest, offer) =>
                !lowest || offer.unitPrice.lessThan(lowest) ? offer.unitPrice : lowest,
              null,
            )
            ?.toFixed(2) ?? null,
        quoteBasedAvailable: inventory.some(
          (offer) => offer.listingClassification === "USED",
        ),
        listingClassifications: [
          ...new Set(inventory.map((offer) => offer.listingClassification)),
        ],
        offerCount: inventory.length,
        preparationTimeFromMin: inventory.reduce<number | null>(
          (lowest, offer) =>
            offer.preparationTimeMin == null
              ? lowest
              : lowest == null || offer.preparationTimeMin < lowest
                ? offer.preparationTimeMin
                : lowest,
          null,
        ),
        availability: "AVAILABLE" as const,
      }));
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async getPublicProduct(id: string) {
    return this.cached(`product:${id}`, async () => {
      const product = await this.database.product.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!product) throw notFound("product");
      const now = new Date();
      const row = await this.database.product.findFirst({
        where: {
          id,
          isActive: true,
          deletedAt: null,
          category: { isActive: true },
          AND: [{ OR: [{ brandId: null }, { brand: { isActive: true } }] }],
          inventory: { some: publicInventoryWhere(now) },
        },
        select: {
          id: true,
          catalogueCode: true,
          name: true,
          description: true,
          imagePath: true,
          category: { select: { id: true, name: true, slug: true, imagePath: true } },
          brand: { select: { id: true, name: true, slug: true } },
          numbers: {
            select: { partNumber: true, isPrimary: true, manufacturer: true },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          },
          compatibility: {
            select: {
              make: true,
              model: true,
              yearFrom: true,
              yearTo: true,
              variant: true,
              notes: true,
            },
            orderBy: [{ make: "asc" }, { model: "asc" }],
          },
          inventory: {
            where: publicInventoryWhere(now),
            select: {
              id: true,
              unitPrice: true,
              stockQuantity: true,
              reservedQuantity: true,
              availabilityStatus: true,
              condition: true,
              preparationTimeMin: true,
              listingClassification: true,
              notes: true,
              images: {
                orderBy: { displayOrder: "asc" },
                select: {
                  id: true,
                  version: true,
                  width: true,
                  height: true,
                  isPrimary: true,
                },
              },
              business: {
                select: {
                  displayName: true,
                  wallet: {
                    select: { status: true, availableCredit: true },
                  },
                },
              },
            },
          },
        },
      });
      if (!row) throw notFound("product");
      const { inventory, ...safe } = row;
      const policy = await this.database.commissionPolicy.findFirst({
        where: {
          isActive: true,
          effectiveFrom: { lte: now },
          OR: [{ endedAt: null }, { endedAt: { gt: now } }],
        },
        select: { rateBps: true },
        orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
      });
      const rankedOffers = inventory
        .map((offer) => {
          const availableQuantity = Math.max(
            0,
            offer.stockQuantity - offer.reservedQuantity,
          );
          const requiredCredit = policy
            ? offer.unitPrice
                .mul(policy.rateBps)
                .div(10_000)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            : null;
          const creditEligible =
            offer.listingClassification !== "USED" &&
            requiredCredit != null &&
            offer.business.wallet?.status === "ACTIVE" &&
            offer.business.wallet.availableCredit.greaterThanOrEqualTo(requiredCredit);
          const rank =
            offer.listingClassification === "USED" ? 2 : creditEligible ? 0 : 1;
          return { offer, availableQuantity, rank };
        })
        .sort((left, right) => {
          if (left.rank !== right.rank) return left.rank - right.rank;
          return left.offer.unitPrice.comparedTo(right.offer.unitPrice);
        });
      return {
        ...safe,
        imagePath: rankedOffers[0]?.offer.images[0]
          ? listingImageUrl(rankedOffers[0].offer.images[0])
          : (safe.imagePath ?? safe.category.imagePath),
        images:
          rankedOffers[0]?.offer.images.map((image) => ({
            ...image,
            url: listingImageUrl(image),
          })) ?? [],
        priceFrom:
          inventory
            .filter((offer) => offer.listingClassification !== "USED")
            .reduce<Prisma.Decimal | null>(
              (lowest, offer) =>
                !lowest || offer.unitPrice.lessThan(lowest) ? offer.unitPrice : lowest,
              null,
            )
            ?.toFixed(2) ?? null,
        quoteBasedAvailable: inventory.some(
          (offer) => offer.listingClassification === "USED",
        ),
        listingClassifications: [
          ...new Set(inventory.map((offer) => offer.listingClassification)),
        ],
        offerCount: inventory.length,
        offers: rankedOffers.map(({ offer, availableQuantity }) => ({
          id: offer.id,
          supplier: { displayName: offer.business.displayName },
          listingClassification: offer.listingClassification,
          condition: offer.condition,
          fixedPrice:
            offer.listingClassification === "USED" ? null : offer.unitPrice.toFixed(2),
          availableQuantity,
          availabilityStatus: offer.availabilityStatus,
          preparationTimeMin: offer.preparationTimeMin,
          notes: offer.notes,
          images: offer.images.map((image) => ({
            ...image,
            url: listingImageUrl(image),
          })),
          requestAction:
            offer.listingClassification === "USED"
              ? ("RFQ" as const)
              : ("PURCHASE_REQUEST" as const),
        })),
        preparationTimeFromMin: inventory.reduce<number | null>(
          (lowest, offer) =>
            offer.preparationTimeMin == null
              ? lowest
              : lowest == null || offer.preparationTimeMin < lowest
                ? offer.preparationTimeMin
                : lowest,
          null,
        ),
        availability: "AVAILABLE" as const,
      };
    });
  }

  async getCategory(id: string) {
    const category = await this.database.partCategory.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: { orderBy: { name: "asc" } },
        _count: { select: { products: true } },
      },
    });
    if (!category) throw notFound("category");
    return category;
  }

  async updateCategory(
    id: string,
    input: UpdateCategoryInput,
    actorUserId: string,
    requestId: string,
  ) {
    if (
      !(await this.database.partCategory.findUnique({
        where: { id },
        select: { id: true },
      }))
    ) {
      throw notFound("category");
    }
    if (input.parentId !== undefined) await this.assertCategoryParent(id, input.parentId);
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        const category = await tx.partCategory.update({ where: { id }, data: input });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_CATEGORY_UPDATED",
          entityType: "PART_CATEGORY",
          entityId: id,
          requestId,
          metadata: { fields: Object.keys(input) },
        });
        return category;
      }),
    );
  }

  async createBrand(input: CreateBrandInput, actorUserId: string, requestId: string) {
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        const brand = await tx.brand.create({ data: input });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_BRAND_CREATED",
          entityType: "BRAND",
          entityId: brand.id,
          requestId,
          metadata: { isActive: brand.isActive },
        });
        return brand;
      }),
    );
  }

  async listBrands(query: PaginationQuery) {
    const where: Prisma.BrandWhereInput = {
      isActive: query.isActive,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { slug: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.brand.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.brand.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async getBrand(id: string) {
    const brand = await this.database.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) throw notFound("brand");
    return brand;
  }

  async updateBrand(
    id: string,
    input: UpdateBrandInput,
    actorUserId: string,
    requestId: string,
  ) {
    if (
      !(await this.database.brand.findUnique({ where: { id }, select: { id: true } }))
    ) {
      throw notFound("brand");
    }
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        const brand = await tx.brand.update({ where: { id }, data: input });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_BRAND_UPDATED",
          entityType: "BRAND",
          entityId: id,
          requestId,
          metadata: { fields: Object.keys(input) },
        });
        return brand;
      }),
    );
  }

  private async assertProductRelations(categoryId: string, brandId?: string | null) {
    const [category, brand] = await Promise.all([
      this.database.partCategory.findUnique({ where: { id: categoryId } }),
      brandId ? this.database.brand.findUnique({ where: { id: brandId } }) : null,
    ]);
    if (!category) throw notFound("category");
    if (brandId && !brand) throw notFound("brand");
  }

  async createProduct(input: CreateProductInput, actorUserId: string, requestId: string) {
    await this.assertProductRelations(input.categoryId, input.brandId);
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        const product = await tx.product.create({
          data: {
            catalogueCode: input.catalogueCode,
            name: input.name,
            description: input.description,
            imagePath: input.imagePath,
            categoryId: input.categoryId,
            brandId: input.brandId,
            isActive: input.isActive,
            numbers: {
              create: input.numbers.map((number) => ({
                ...number,
                partNumber: normalizeNumber(number.partNumber),
              })),
            },
            compatibility: { create: input.compatibility },
          },
          include: productInclude,
        });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_PRODUCT_CREATED",
          entityType: "PRODUCT",
          entityId: product.id,
          requestId,
          metadata: {
            categoryId: product.categoryId,
            brandId: product.brandId,
            partNumberCount: product.numbers.length,
            compatibilityCount: product.compatibility.length,
          },
        });
        return product;
      }),
    );
  }

  async listProducts(query: CatalogueProductQuery, supplierView = false) {
    const cacheKey = supplierView ? `products:${JSON.stringify(query)}` : undefined;
    if (cacheKey) {
      const cached = await this.cache?.get<{
        items: unknown[];
        page: number;
        pageSize: number;
        total: number;
      }>(cacheKey);
      if (cached) return cached;
    }
    const where: Prisma.ProductWhereInput = {
      isActive: supplierView ? true : query.isActive,
      deletedAt: null,
      categoryId: query.categoryId,
      brandId: query.brandId,
      ...(supplierView
        ? {
            category: { isActive: true },
            AND: [{ OR: [{ brandId: null }, { brand: { isActive: true } }] }],
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { catalogueCode: { contains: query.search, mode: "insensitive" } },
              {
                numbers: {
                  some: { partNumber: { contains: query.search, mode: "insensitive" } },
                },
              },
            ],
          }
        : {}),
      ...(query.make || query.model || query.year
        ? {
            compatibility: {
              some: {
                make: query.make
                  ? { contains: query.make, mode: "insensitive" }
                  : undefined,
                model: query.model
                  ? { contains: query.model, mode: "insensitive" }
                  : undefined,
                ...(query.year
                  ? {
                      AND: [
                        { OR: [{ yearFrom: null }, { yearFrom: { lte: query.year } }] },
                        { OR: [{ yearTo: null }, { yearTo: { gte: query.year } }] },
                      ],
                    }
                  : {}),
              },
            },
          }
        : {}),
    };
    const [items, total] = await this.database.$transaction([
      this.database.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.product.count({ where }),
    ]);
    const result = { items, page: query.page, pageSize: query.pageSize, total };
    if (cacheKey) await this.cache?.set(cacheKey, result);
    return result;
  }

  async getProduct(id: string, supplierView = false) {
    const cacheKey = supplierView ? `product:${id}` : undefined;
    if (cacheKey) {
      const cached =
        await this.cache?.get<
          Prisma.ProductGetPayload<{ include: typeof productInclude }>
        >(cacheKey);
      if (cached) return cached;
    }
    const product = await this.database.product.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(supplierView
          ? {
              isActive: true,
              category: { isActive: true },
              OR: [{ brandId: null }, { brand: { isActive: true } }],
            }
          : {}),
      },
      include: productInclude,
    });
    if (!product) throw notFound("product");
    if (cacheKey) await this.cache?.set(cacheKey, product);
    return product;
  }

  async updateProduct(
    id: string,
    input: UpdateProductInput,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.database.product.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw notFound("product");
    await this.assertProductRelations(
      input.categoryId ?? current.categoryId,
      input.brandId === undefined ? current.brandId : input.brandId,
    );
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        const product = await tx.product.update({
          where: { id },
          data: input,
          include: productInclude,
        });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_PRODUCT_UPDATED",
          entityType: "PRODUCT",
          entityId: id,
          requestId,
          metadata: { fields: Object.keys(input) },
        });
        return product;
      }),
    );
  }

  async addProductNumber(
    productId: string,
    input: ProductNumberInput,
    actorUserId: string,
    requestId: string,
  ) {
    await this.getProduct(productId);
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        if (input.isPrimary) {
          await tx.productNumber.updateMany({
            where: { productId, isPrimary: true },
            data: { isPrimary: false },
          });
        }
        const number = await tx.productNumber.create({
          data: { ...input, productId, partNumber: normalizeNumber(input.partNumber) },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_PART_NUMBER_CREATED",
          entityType: "PRODUCT_NUMBER",
          entityId: number.id,
          requestId,
          metadata: { productId, isPrimary: number.isPrimary },
        });
        return number;
      }),
    );
  }

  async updateProductNumber(
    productId: string,
    numberId: string,
    input: UpdateProductNumberInput,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.database.productNumber.findFirst({
      where: { id: numberId, productId },
    });
    if (!current) throw notFound("part number");
    if (current.isPrimary && input.isPrimary === false) {
      throw conflict("Choose another primary part number before demoting this one");
    }
    return this.translateUniqueError(() =>
      this.database.$transaction(async (tx) => {
        if (input.isPrimary === true) {
          await tx.productNumber.updateMany({
            where: { productId, isPrimary: true, id: { not: numberId } },
            data: { isPrimary: false },
          });
        }
        const number = await tx.productNumber.update({
          where: { id: numberId },
          data: {
            ...input,
            partNumber: input.partNumber ? normalizeNumber(input.partNumber) : undefined,
          },
        });
        await recordAudit(tx, {
          actorUserId,
          action: "CATALOGUE_PART_NUMBER_UPDATED",
          entityType: "PRODUCT_NUMBER",
          entityId: numberId,
          requestId,
          metadata: { productId, fields: Object.keys(input) },
        });
        return number;
      }),
    );
  }

  async deleteProductNumber(
    productId: string,
    numberId: string,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.database.productNumber.findFirst({
      where: { id: numberId, productId },
    });
    if (!current) throw notFound("part number");
    if (current.isPrimary) throw conflict("The primary part number cannot be deleted");
    await this.database.$transaction(async (tx) => {
      await tx.productNumber.delete({ where: { id: numberId } });
      await recordAudit(tx, {
        actorUserId,
        action: "CATALOGUE_PART_NUMBER_DELETED",
        entityType: "PRODUCT_NUMBER",
        entityId: numberId,
        requestId,
        metadata: { productId },
      });
    });
    return { id: numberId, deleted: true };
  }

  async addCompatibility(
    productId: string,
    input: CompatibilityInput,
    actorUserId: string,
    requestId: string,
  ) {
    await this.getProduct(productId);
    return this.database.$transaction(async (tx) => {
      const compatibility = await tx.productCompatibility.create({
        data: { productId, ...input },
      });
      await recordAudit(tx, {
        actorUserId,
        action: "CATALOGUE_COMPATIBILITY_CREATED",
        entityType: "PRODUCT_COMPATIBILITY",
        entityId: compatibility.id,
        requestId,
        metadata: { productId },
      });
      return compatibility;
    });
  }

  async updateCompatibility(
    productId: string,
    compatibilityId: string,
    input: UpdateCompatibilityInput,
    actorUserId: string,
    requestId: string,
  ) {
    const current = await this.database.productCompatibility.findFirst({
      where: { id: compatibilityId, productId },
    });
    if (!current) throw notFound("compatibility");
    const yearFrom = input.yearFrom === undefined ? current.yearFrom : input.yearFrom;
    const yearTo = input.yearTo === undefined ? current.yearTo : input.yearTo;
    if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
      throw new AppError("yearFrom must not be later than yearTo", {
        code: "VALIDATION_ERROR",
        statusCode: 400,
      });
    }
    return this.database.$transaction(async (tx) => {
      const compatibility = await tx.productCompatibility.update({
        where: { id: compatibilityId },
        data: input,
      });
      await recordAudit(tx, {
        actorUserId,
        action: "CATALOGUE_COMPATIBILITY_UPDATED",
        entityType: "PRODUCT_COMPATIBILITY",
        entityId: compatibilityId,
        requestId,
        metadata: { productId, fields: Object.keys(input) },
      });
      return compatibility;
    });
  }

  async deleteCompatibility(
    productId: string,
    compatibilityId: string,
    actorUserId: string,
    requestId: string,
  ) {
    const deleted = await this.database.productCompatibility.deleteMany({
      where: { id: compatibilityId, productId },
    });
    if (deleted.count !== 1) throw notFound("compatibility");
    await recordAudit(this.database, {
      actorUserId,
      action: "CATALOGUE_COMPATIBILITY_DELETED",
      entityType: "PRODUCT_COMPATIBILITY",
      entityId: compatibilityId,
      requestId,
      metadata: { productId },
    });
    return { id: compatibilityId, deleted: true };
  }
}
