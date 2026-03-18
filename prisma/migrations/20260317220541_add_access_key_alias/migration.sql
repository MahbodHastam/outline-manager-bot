-- CreateTable
CREATE TABLE "AccessKeyAlias" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "alias" TEXT NOT NULL,
    "outlineKeyId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "serverId" INTEGER NOT NULL,
    CONSTRAINT "AccessKeyAlias_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessKeyAlias_alias_key" ON "AccessKeyAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "AccessKeyAlias_serverId_outlineKeyId_key" ON "AccessKeyAlias"("serverId", "outlineKeyId");
