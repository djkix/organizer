-- AlterTable
ALTER TABLE "capture" ADD COLUMN     "etiquette" TEXT;

-- AlterTable
ALTER TABLE "utilisateur" ADD COLUMN     "mot_de_passe_hash" TEXT,
ADD COLUMN     "prochaine_privee" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "jeton_hash" TEXT NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expire_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_jeton_hash_key" ON "session"("jeton_hash");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
