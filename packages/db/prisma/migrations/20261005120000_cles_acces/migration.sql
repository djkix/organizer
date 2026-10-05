-- CreateTable
CREATE TABLE "cle_acces" (
    "id" UUID NOT NULL,
    "identifiant" TEXT NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "cle_publique" BYTEA NOT NULL,
    "compteur" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "sauvegardee" BOOLEAN NOT NULL DEFAULT false,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utilisee_le" TIMESTAMP(3),

    CONSTRAINT "cle_acces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cle_acces_identifiant_key" ON "cle_acces"("identifiant");

-- CreateIndex
CREATE INDEX "cle_acces_utilisateur_id_idx" ON "cle_acces"("utilisateur_id");

-- AddForeignKey
ALTER TABLE "cle_acces" ADD CONSTRAINT "cle_acces_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

