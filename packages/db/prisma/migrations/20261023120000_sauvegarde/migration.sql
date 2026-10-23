-- Sauvegarde vers le NAS (1.11.0) : une ligne par tentative, écrite par le service sauvegarde,
-- lue par la veille de l'API pour alerter l'administrateur. Migration additive.
CREATE TABLE "sauvegarde" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "debut" TIMESTAMP(3) NOT NULL,
    "fin" TIMESTAMP(3) NOT NULL,
    "reussie" BOOLEAN NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "sauvegarde_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sauvegarde_fin_idx" ON "sauvegarde"("fin");
