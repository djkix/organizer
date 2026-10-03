import { EN_TETES_CAPTURE_PRIVEE } from '@organizer/shared/api';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Ce que rend l'enregistreur. emisLe : début de l'enregistrement (CAP-05), ISO 8601. */
export interface Enregistrement { blob: Blob; mime: string; dureeS: number; emisLe: string }
/** Capture privée en attente sur le téléphone. L'id est fixé à la mise en file et sert à tous les essais. */
export interface CapturePrivee extends Enregistrement { id: string }

export interface FilePrivee {
  ajouter(c: CapturePrivee): Promise<void>;
  /** Les plus anciennes d'abord. */
  lister(): Promise<CapturePrivee[]>;
  retirer(id: string): Promise<void>;
}

export class EnregistrementVide extends Error {
  override name = 'EnregistrementVide';
}

interface Schema extends DBSchema {
  'captures-privees': { key: string; value: CapturePrivee };
}

export function ouvrirFilePrivee(nom = 'organizer'): FilePrivee {
  let base: Promise<IDBPDatabase<Schema>> | null = null;
  const db = (): Promise<IDBPDatabase<Schema>> =>
    (base ??= openDB<Schema>(nom, 1, {
      upgrade(d) {
        d.createObjectStore('captures-privees', { keyPath: 'id' });
      },
    }));
  return {
    async ajouter(c) {
      await (await db()).put('captures-privees', c);
    },
    async lister() {
      return (await (await db()).getAll('captures-privees')).sort((a, b) => a.emisLe.localeCompare(b.emisLe));
    },
    async retirer(id) {
      await (await db()).delete('captures-privees', id);
    },
  };
}

export type IssueEnvoi = { issue: 'livre' } | { issue: 'refuse'; statut: number } | { issue: 'reseau' };

/** 200 (déjà reçue) ou 201 (nouvelle) : livrée. Tout autre statut, ou une coupure : la copie locale reste. */
export async function envoyerCapture(c: CapturePrivee, f: typeof fetch = (e, i) => fetch(e, i)): Promise<IssueEnvoi> {
  try {
    const r = await f('/api/captures/privees', {
      method: 'POST',
      credentials: 'same-origin',
      body: c.blob,
      headers: {
        'content-type': c.mime,
        [EN_TETES_CAPTURE_PRIVEE.id]: c.id,
        [EN_TETES_CAPTURE_PRIVEE.emisLe]: c.emisLe,
        [EN_TETES_CAPTURE_PRIVEE.dureeS]: String(c.dureeS),
      },
    });
    return r.status === 200 || r.status === 201 ? { issue: 'livre' } : { issue: 'refuse', statut: r.status };
  } catch {
    return { issue: 'reseau' };
  }
}

export interface BilanVidage { livrees: number; restantes: number; nonConnecte: boolean; horsLigne: boolean }

export interface Videur {
  /** Un seul vidage à la fois : un appel pendant un vidage reçoit le même résultat. */
  vider(): Promise<BilanVidage>;
  ecouter(f: (b: BilanVidage) => void): () => void;
}

export function creerVideur(file: FilePrivee, f?: typeof fetch): Videur {
  let enCours: Promise<BilanVidage> | null = null;
  const ecouteurs = new Set<(b: BilanVidage) => void>();

  async function unPassage(): Promise<BilanVidage> {
    const b: BilanVidage = { livrees: 0, restantes: 0, nonConnecte: false, horsLigne: false };
    const liste = await file.lister();
    for (const [i, c] of liste.entries()) {
      const r = await envoyerCapture(c, f);
      if (r.issue === 'livre') {
        await file.retirer(c.id);
        b.livrees++;
        continue;
      }
      // Coupure ou session absente : inutile d'insister sur les suivantes.
      if (r.issue === 'reseau' || r.statut === 401) {
        b.horsLigne = r.issue === 'reseau';
        b.nonConnecte = r.issue === 'refuse';
        b.restantes += liste.length - i;
        break;
      }
      b.restantes++;
    }
    return b;
  }

  return {
    vider() {
      enCours ??= unPassage()
        .then((b) => {
          for (const e of ecouteurs) e(b);
          return b;
        })
        .finally(() => {
          enCours = null;
        });
      return enCours;
    },
    ecouter(fonction) {
      ecouteurs.add(fonction);
      return () => ecouteurs.delete(fonction);
    },
  };
}

/** La copie locale d'abord, l'envoi ensuite : une coupure ne perd rien (CAP-10). */
export async function garderPuisEnvoyer(
  file: FilePrivee, videur: Videur, e: Enregistrement, id: string = crypto.randomUUID(),
): Promise<CapturePrivee> {
  // Vide, l'API répondrait 400 à chaque essai : la capture resterait en file pour toujours.
  if (e.blob.size === 0) throw new EnregistrementVide();
  const c: CapturePrivee = { id, ...e };
  await file.ajouter(c);
  void videur.vider().catch(() => undefined);
  return c;
}
