-- CreateEnum
CREATE TYPE "Canal" AS ENUM ('telegram', 'pwa');

-- CreateEnum
CREATE TYPE "EtatCapture" AS ENUM ('recue', 'en_file', 'a_transcrire', 'classee', 'a_revoir', 'privee');

-- CreateEnum
CREATE TYPE "Nature" AS ENUM ('action', 'pensee', 'information', 'ambigu');

-- CreateTable
CREATE TABLE "utilisateur" (
    "id" UUID NOT NULL,
    "nom" TEXT NOT NULL,
    "telegram_chat_id" BIGINT,
    "fuseau" TEXT NOT NULL DEFAULT 'Europe/Paris',
    "admin" BOOLEAN NOT NULL DEFAULT false,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utilisateur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_liaison" (
    "code" TEXT NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "expire_le" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_liaison_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "capture" (
    "id" UUID NOT NULL,
    "utilisateur_id" UUID NOT NULL,
    "canal" "Canal" NOT NULL,
    "prive" BOOLEAN NOT NULL,
    "source_ref" TEXT,
    "source_fichier" TEXT,
    "audio_path" TEXT,
    "audio_mime" TEXT,
    "audio_purge_le" TIMESTAMP(3),
    "duree_s" INTEGER,
    "texte_ecrit" TEXT,
    "texte_brut" TEXT,
    "emis_le" TIMESTAMP(3) NOT NULL,
    "recu_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "etat" "EtatCapture" NOT NULL,
    "erreur" TEXT,
    "version_prompt" TEXT,
    "modele" TEXT,
    "tokens_entree" INTEGER,
    "tokens_sortie" INTEGER,
    "classe_le" TIMESTAMP(3),

    CONSTRAINT "capture_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "theme" (
    "id" UUID NOT NULL,
    "libelle" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL,
    "capture_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "texte" TEXT NOT NULL,
    "nature" "Nature" NOT NULL,
    "confiance" JSONB NOT NULL,
    "theme_id" UUID,
    "personnes" TEXT[],
    "version_prompt" TEXT NOT NULL,
    "modele" TEXT NOT NULL,
    "cree_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archive_le" TIMESTAMP(3),

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action" (
    "item_id" UUID NOT NULL,
    "echeance_type" TEXT,
    "echeance_expr" TEXT,
    "echeance_date" TIMESTAMP(3),
    "fenetre_debut" TIMESTAMP(3),
    "fenetre_fin" TIMESTAMP(3),
    "importance" TEXT,
    "effort" TEXT,
    "contexte" TEXT,
    "alarme" BOOLEAN NOT NULL DEFAULT false,
    "alarme_expr" TEXT,
    "fait_le" TIMESTAMP(3),
    "reporte_n" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "action_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "pensee" (
    "item_id" UUID NOT NULL,
    "tonalite" TEXT,

    CONSTRAINT "pensee_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "correction" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "champ" TEXT NOT NULL,
    "ancienne_valeur" JSONB,
    "nouvelle_valeur" JSONB,
    "corrige_le" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "utilisateur_nom_key" ON "utilisateur"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "utilisateur_telegram_chat_id_key" ON "utilisateur"("telegram_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "capture_source_ref_key" ON "capture"("source_ref");

-- CreateIndex
CREATE INDEX "capture_etat_idx" ON "capture"("etat");

-- CreateIndex
CREATE UNIQUE INDEX "theme_libelle_key" ON "theme"("libelle");

-- CreateIndex
CREATE UNIQUE INDEX "item_capture_id_position_key" ON "item"("capture_id", "position");

-- AddForeignKey
ALTER TABLE "code_liaison" ADD CONSTRAINT "code_liaison_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture" ADD CONSTRAINT "capture_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_capture_id_fkey" FOREIGN KEY ("capture_id") REFERENCES "capture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_theme_id_fkey" FOREIGN KEY ("theme_id") REFERENCES "theme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action" ADD CONSTRAINT "action_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pensee" ADD CONSTRAINT "pensee_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction" ADD CONSTRAINT "correction_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mode privé (règle n° 6, CAP-09). Une capture privée naît privée et ne quitte
-- jamais l'état privee : elle ne peut donc ni entrer en file ni être classée.
ALTER TABLE "capture" ADD CONSTRAINT "capture_prive_etat"
  CHECK (("prive" AND "etat" = 'privee') OR (NOT "prive" AND "etat" <> 'privee'));

CREATE FUNCTION capture_prive_immuable() RETURNS trigger AS $$
BEGIN
  IF OLD.prive AND NOT NEW.prive THEN
    RAISE EXCEPTION 'Une capture privée ne redevient jamais ordinaire';
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER capture_prive_immuable BEFORE UPDATE ON "capture"
  FOR EACH ROW EXECUTE FUNCTION capture_prive_immuable();
