-- CreateTable
CREATE TABLE "Restaurant" (
    "restaurantId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("restaurantId")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "menuItemId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "price" INTEGER NOT NULL,
    "calories" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("menuItemId")
);

-- CreateIndex
CREATE INDEX "Restaurant_tenantId_isActive_idx" ON "Restaurant"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "Restaurant_tenantId_name_idx" ON "Restaurant"("tenantId", "name");

-- CreateIndex
CREATE INDEX "MenuItem_tenantId_restaurantId_isActive_idx" ON "MenuItem"("tenantId", "restaurantId", "isActive");

-- CreateIndex
CREATE INDEX "MenuItem_tenantId_category_isActive_idx" ON "MenuItem"("tenantId", "category", "isActive");
