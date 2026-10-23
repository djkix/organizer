-- Connexion par Google (1.13.0, décision 29) : adresse reliée par la CLI et sub mémorisé
-- au premier passage. Migration additive.
ALTER TABLE "utilisateur" ADD COLUMN "google_email" TEXT,
ADD COLUMN "google_sub" TEXT;

CREATE UNIQUE INDEX "utilisateur_google_email_key" ON "utilisateur"("google_email");
CREATE UNIQUE INDEX "utilisateur_google_sub_key" ON "utilisateur"("google_sub");
