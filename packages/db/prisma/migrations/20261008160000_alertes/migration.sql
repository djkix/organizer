-- CreateTable
CREATE TABLE "alerte" (
    "id" UUID NOT NULL,
    "cle" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vue_le" TIMESTAMP(3),

    CONSTRAINT "alerte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "alerte_cle_key" ON "alerte"("cle");

-- CreateIndex
CREATE INDEX "alerte_cree_le_idx" ON "alerte"("cree_le");
