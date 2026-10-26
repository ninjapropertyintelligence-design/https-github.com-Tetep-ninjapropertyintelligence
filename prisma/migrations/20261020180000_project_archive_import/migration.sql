-- AlterEnum
ALTER TYPE "ImportEntityType" ADD VALUE 'PROJECTS';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "archivedAt" TIMESTAMP(3);
