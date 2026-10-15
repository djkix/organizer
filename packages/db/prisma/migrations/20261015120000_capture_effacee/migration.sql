-- Effacer une capture privée sans rien détruire (1.10.0) : elle quitte la vue Privé, son audio reste,
-- et Réglages › Éléments effacés la remet en place. Migration additive.
ALTER TABLE "capture" ADD COLUMN "archive_le" TIMESTAMP(3);
