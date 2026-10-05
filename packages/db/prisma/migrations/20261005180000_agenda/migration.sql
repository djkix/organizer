-- CreateEnum
CREATE TYPE "EtatAgenda" AS ENUM ('deconnecte', 'en_cours', 'connecte', 'deconnexion', 'revoque', 'echec', 'agenda_supprime');

-- AlterTable
ALTER TABLE "action" ADD COLUMN     "alarme_proposee_le" TIMESTAMP(3),
ADD COLUMN     "evenement_calendrier_id" TEXT,
ADD COLUMN     "evenement_empreinte" TEXT,
ADD COLUMN     "evenement_generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evenement_id" TEXT;

-- CreateTable
CREATE TABLE "agenda_google" (
    "utilisateur_id" UUID NOT NULL,
    "etat" "EtatAgenda" NOT NULL,
    "erreur" TEXT,
    "jeton_chiffre" TEXT,
    "calendrier_id" TEXT,
    "connecte_le" TIMESTAMP(3),
    "rafraichi_le" TIMESTAMP(3),
    "modifie_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenda_google_pkey" PRIMARY KEY ("utilisateur_id")
);

-- AddForeignKey
ALTER TABLE "agenda_google" ADD CONSTRAINT "agenda_google_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

