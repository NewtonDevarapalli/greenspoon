-- Rename legacy plaintext password column
ALTER TABLE "AuthUser" RENAME COLUMN "password" TO "passwordHash";

-- Add account-state fields for lockout and lifecycle
ALTER TABLE "AuthUser"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lockedUntil" TIMESTAMP(3),
ADD COLUMN "lastLoginAt" TIMESTAMP(3);
