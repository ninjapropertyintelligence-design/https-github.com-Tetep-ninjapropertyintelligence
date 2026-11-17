-- CreateEnum
CREATE TYPE "VendorConnectionProvider" AS ENUM ('DRONEDEPLOY', 'MATTERPORT');

-- AlterTable
ALTER TABLE "DroneDeployImport" ADD COLUMN     "vendorConnectionId" TEXT;

-- CreateTable
CREATE TABLE "VendorConnection" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "provider" "VendorConnectionProvider" NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "accountLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "errorMessage" TEXT,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorConnection_vendorId_provider_key" ON "VendorConnection"("vendorId", "provider");

-- CreateIndex
CREATE INDEX "DroneDeployImport_vendorConnectionId_status_idx" ON "DroneDeployImport"("vendorConnectionId", "status");

-- AddForeignKey
ALTER TABLE "VendorConnection" ADD CONSTRAINT "VendorConnection_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DroneDeployImport" ADD CONSTRAINT "DroneDeployImport_vendorConnectionId_fkey" FOREIGN KEY ("vendorConnectionId") REFERENCES "VendorConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
