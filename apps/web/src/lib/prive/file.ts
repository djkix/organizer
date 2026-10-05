import { delaiEnvoiPriveMs, EN_TETES_CAPTURE_PRIVEE } from '@organizer/shared/api';
import { openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from 'idb';

/** Ce que rend l'enregistreur. emisLe : début de l'enregistrement (CAP-05), ISO 8601. */
export interface Enregistrement { blob: Blob; mime: string; dureeS: number; emisLe: string }
/**
 * Le mode d'une capture est fixé par l'écran qui l'a enregistrée, à la mise en file, et ne change plus (règle n° 6).
 * L'adresse d'envoi en est dérivée : aucune valeur par défaut « ordinaire », l'ordinaire doit être écrit en toutes lettres.
 */
export type ModeCapture = 'prive' | 'ordinaire';

export const URL_DEPOT_PRIVE = '/api/captures/privees';
export const URL_DEPOT_ORDINAIRE = '/api/captures';

/** Une entrée sans mode (file écrite avant le lot 2-B) était forcément privée : elle le reste. */
export function urlDepot(mode: ModeCapture | undefined): string {
  return mode === 'ordinaire' ? URL_DEPOT_ORDINAIRE : URL_DEPOT_PRIVE;
}

/** Capture en attente sur le téléphone, privée ou ordinaire. L'id est fixé à la mise en file et sert à tous les essais. */
export interface CapturePrivee extends Enregistrement {
  id: string;
  /** Absent seulement sur les entrées anciennes, toutes privées. */
  mode?: ModeCapture;
  /** Refus définitif du serveur : la copie reste, mais les vidages automatiques l'ignorent. */
  refuse?: { statut: number; le: string };
}

export interface FilePrivee {
  ajouter(c: CapturePrivee): Promise<void>;
  /** Les plus anciennes d'abord. */
  lister(): Promise<CapturePrivee[]>;
  retirer(id: string): Promise<void>;
  /** Met de côté (refus définitif) ou, avec null, remet en jeu. Ne supprime jamais. */
  marquerRefusee(id: string, refuse: { statut: number; le: string } | null): Promise<void>;
}

export class EnregistrementVide extends Error {
  override name = 'EnregistrementVide';
}

interface Schema extends DBSchema {
  'captures-privees': { key: string; value: CapturePrivee };
}

/** Au-delà, la base est tenue pour muette : l'appelant bascule sur le chemin « en mémoire ». */
export const DELAI_ECRITURE_MS = 10_000;

type Ouvrir = (nom: string, version: number, options: OpenDBCallbacks<Schema>) => Promise<IDBPDatabase<Schema>>;

export function ouvrirFilePrivee(
  nom = 'organizer', deps: { ouvrir?: Ouvrir; delaiMs?: number } = {},
): FilePrivee {
  const ouvrir: Ouvrir = deps.ouvrir ?? ((n, v, o) => openDB<Schema>(n, v, o));
  const delaiMs = deps.delaiMs ?? DELAI_ECRITURE_MS;
  let base: Promise<IDBPDatabase<Schema>> | null = null;

  /** Rejette si l'opération ne répond pas à temps : jamais d'attente sans fin, ni de verrou gardé. */
  async function bornee<T>(operation: () => Promise<T>): Promise<T> {
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const delai = new Promise<never>((_, rejeter) => {
      minuteur = setTimeout(() => rejeter(new Error('Base locale muette')), delaiMs);
    });
    try {
      return await Promise.race([operation(), delai]);
    } finally {
      clearTimeout(minuteur);
    }
  }

  const db = (): Promise<IDBPDatabase<Schema>> => {
    if (base) return base;
    const ouverte: Promise<IDBPDatabase<Schema>> = ouvrir(nom, 1, {
      upgrade(d) {
        d.createObjectStore('captures-privees', { keyPath: 'id' });
      },
      // Le service worker ouvre la même base : une autre version ne doit jamais rester bloquée par une
      // connexion que celle-ci garde ; on la ferme, la suivante rouvre.
      blocking() {
        base = null;
        void ouverte.then((d) => d.close(), () => undefined);
      },
      // Notre ouverture attend la fermeture d'une autre connexion : la prochaine demande rouvre.
      blocked() {
        base = null;
      },
      terminated() {
        base = null;
      },
    }).catch((e: unknown) => {
      base = null;
      throw e;
    });
    base = ouverte;
    return ouverte;
  };
  const avecBase = <T>(f: (d: IDBPDatabase<Schema>) => Promise<T>): Promise<T> => bornee(async () => f(await db()));
  return {
    ajouter: (c) => avecBase((d) => d.put('captures-privees', c).then(() => undefined)),
    lister: () => avecBase(async (d) => (await d.getAll('captures-privees')).sort((a, b) => a.emisLe.localeCompare(b.emisLe))),
    retirer: (id) => avecBase((d) => d.delete('captures-privees', id)),
    marquerRefusee: (id, refuse) => avecBase(async (d) => {
      const tx = d.transaction('captures-privees', 'readwrite');
      const c = await tx.store.get(id);
      if (c) {
        if (refuse) c.refuse = refuse;
        else delete c.refuse;
        await tx.store.put(c);
      }
      await tx.done;
    }),
  };
}

/** Pour l'affichage (« En attente d'envoi ») : la file se vide du plus ancien au plus récent, la vue Privé se lit à l'inverse. */
export const plusRecentesDAbord = (l: readonly CapturePrivee[]): CapturePrivee[] =>
  [...l].sort((a, b) => b.emisLe.localeCompare(a.emisLe));

export type IssueEnvoi = { issue: 'livre' } | { issue: 'refuse'; statut: number } | { issue: 'reseau' };

/** Contrat partagé avec l'API et le proxy : voir delaiEnvoiPriveMs. */
export const delaiEnvoiMs = delaiEnvoiPriveMs;

/** 200 (déjà reçue) ou 201 (nouvelle) : livrée. Tout autre statut, ou une coupure : la copie locale reste. */
export async function envoyerCapture(c: CapturePrivee, f: typeof fetch = (e, i) => fetch(e, i)): Promise<IssueEnvoi> {
  const arret = new AbortController();
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const delai = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => {
      arret.abort();
      rejeter(new Error('delai'));
    }, delaiEnvoiMs(c.blob.size));
  });
  try {
    const r = await Promise.race([
      f(urlDepot(c.mode), {
        method: 'POST',
        credentials: 'same-origin',
        body: c.blob,
        signal: arret.signal,
        headers: {
          'content-type': c.mime,
          [EN_TETES_CAPTURE_PRIVEE.id]: c.id,
          [EN_TETES_CAPTURE_PRIVEE.emisLe]: c.emisLe,
          [EN_TETES_CAPTURE_PRIVEE.dureeS]: String(Math.round(c.dureeS)),
        },
      }),
      delai,
    ]);
    return r.status === 200 || r.status === 201 ? { issue: 'livre' } : { issue: 'refuse', statut: r.status };
  } catch {
    // Coupure, délai dépassé ou AbortError : même sort, la copie reste.
    return { issue: 'reseau' };
  } finally {
    clearTimeout(minuteur);
  }
}

/** restantes : à envoyer encore ; refusees : mises de côté (refus définitif du serveur). */
export interface BilanVidage { livrees: number; restantes: number; refusees: number; nonConnecte: boolean; horsLigne: boolean }

export interface Videur {
  /** Un seul vidage à la fois : un appel pendant un vidage lui demande un passage de plus. */
  vider(): Promise<BilanVidage>;
  /** Remet en jeu les captures mises de côté, puis vide. Jamais appelé automatiquement. */
  reessayerRefusees(): Promise<BilanVidage>;
  ecouter(f: (b: BilanVidage) => void): () => void;
}

/** Refus propres à ce fichier : il ne partira jamais tel quel. */
const REFUS_DEFINITIFS = new Set([400, 413, 415, 422]);

async function souslock<T>(fonction: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? ((await locks.request('organizer-prive', fonction)) as T) : fonction();
}

export function creerVideur(file: FilePrivee, f?: typeof fetch): Videur {
  let enCours: Promise<BilanVidage> | null = null;
  let relancer = false;
  const ecouteurs = new Set<(b: BilanVidage) => void>();

  /** arret : coupure, 401, 429, 5xx ou tout autre statut inattendu. */
  async function unPassage(): Promise<{ b: BilanVidage; arret: boolean }> {
    const b: BilanVidage = { livrees: 0, restantes: 0, refusees: 0, nonConnecte: false, horsLigne: false };
    const liste = await file.lister();
    for (const [i, c] of liste.entries()) {
      if (c.refuse) {
        b.refusees++;
        continue;
      }
      const r = await envoyerCapture(c, f);
      if (r.issue === 'livre') {
        await file.retirer(c.id);
        b.livrees++;
        continue;
      }
      if (r.issue === 'refuse' && REFUS_DEFINITIFS.has(r.statut)) {
        await file.marquerRefusee(c.id, { statut: r.statut, le: new Date().toISOString() });
        b.refusees++;
        continue;
      }
      // Coupure, session absente, 429, 5xx : inutile d'insister sur les suivantes.
      b.horsLigne = r.issue === 'reseau';
      b.nonConnecte = r.issue === 'refuse' && r.statut === 401;
      b.restantes += liste.slice(i).filter((x) => !x.refuse).length;
      b.refusees += liste.slice(i + 1).filter((x) => x.refuse).length;
      return { b, arret: true };
    }
    return { b, arret: false };
  }

  async function passages(): Promise<BilanVidage> {
    return souslock(async () => {
      let total = 0;
      for (;;) {
        relancer = false;
        const { b, arret } = await unPassage();
        total += b.livrees;
        // Une capture arrivée pendant le passage : un tour de plus, sans déclencheur externe.
        if (relancer && !arret) continue;
        return { ...b, livrees: total };
      }
    });
  }

  function vider(): Promise<BilanVidage> {
    if (enCours) {
      relancer = true;
      return enCours;
    }
    enCours = passages()
      .then((b) => {
        for (const e of ecouteurs) e(b);
        return b;
      })
      .finally(() => {
        enCours = null;
      });
    return enCours;
  }

  return {
    vider,
    async reessayerRefusees() {
      for (const c of await file.lister()) if (c.refuse) await file.marquerRefusee(c.id, null);
      return vider();
    },
    ecouter(fonction) {
      ecouteurs.add(fonction);
      return () => ecouteurs.delete(fonction);
    },
  };
}

/** La copie locale d'abord, l'envoi ensuite : une coupure ne perd rien (CAP-10). */
export async function garderPuisEnvoyer(
  file: FilePrivee, videur: Videur, e: Enregistrement, mode: ModeCapture, id: string = crypto.randomUUID(),
): Promise<CapturePrivee> {
  // Vide, l'API répondrait 400 à chaque essai : la capture resterait en file pour toujours.
  if (e.blob.size === 0) throw new EnregistrementVide();
  const c: CapturePrivee = { id, mode, ...e };
  await file.ajouter(c);
  void videur.vider().catch(() => undefined);
  return c;
}
