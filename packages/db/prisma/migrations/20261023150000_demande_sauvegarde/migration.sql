-- Sauvegarde à la demande (1.12.0) : l'admin la demande depuis Réglages, le service sauvegarde
-- la prend dans les 5 minutes et efface la ligne. Migration additive.
CREATE TABLE "demande_sauvegarde" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "demandee_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demande_sauvegarde_pkey" PRIMARY KEY ("id")
);
