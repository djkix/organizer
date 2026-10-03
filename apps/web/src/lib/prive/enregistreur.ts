import { EnregistrementVide, type Enregistrement } from './file.js';

export const MIME_PRIVE = 'audio/webm;codecs=opus';
/** 48 kbit/s : une heure tient en 22 Mo, sous la limite de 30 Mo de l'API. */
export const DEBIT_PRIVE = 48_000;

/** Une heure : au-delà, l'API tronque (3600 s) ou refuse (30 Mo). On s'arrête avant. */
export const DUREE_MAX_S = 3600;
/** Délai laissé à un navigateur muet pour dire « stop » avant de garder ce qu'il a donné. */
const ATTENTE_STOP_MS = 5000;

export interface Enregistreur {
  demarrer(): Promise<void>;
  /** Rend ce qui a été dit, y compris après un arrêt spontané (micro repris par un appel). */
  arreter(): Promise<Enregistrement>;
  /** Rend le micro. */
  liberer(): void;
}

export interface DepsEnregistreur {
  surInterruption?: () => void;
  /** La durée maximale est atteinte : l'appelant arrête et garde. */
  surLimite?: () => void;
  media?: Pick<MediaDevices, 'getUserMedia'>;
  Recorder?: typeof MediaRecorder;
  maintenant?: () => Date;
}

export function creerEnregistreur(d: DepsEnregistreur = {}): Enregistreur {
  const maintenant = d.maintenant ?? (() => new Date());
  let flux: MediaStream | null = null;
  let rec: MediaRecorder | null = null;
  let morceaux: Blob[] = [];
  let debut = new Date(0);
  let finLe: Date | null = null;
  let arret: Promise<void> = Promise.resolve();
  let ouverture = false;
  let limite: ReturnType<typeof setTimeout> | undefined;

  function liberer(): void {
    clearTimeout(limite);
    for (const piste of flux?.getTracks() ?? []) piste.stop();
    flux = null;
  }

  return {
    async demarrer() {
      // Double appui : un seul micro, un seul enregistreur.
      if (ouverture || rec) return;
      ouverture = true;
      try {
        await ouvrir();
      } finally {
        ouverture = false;
      }
    },

    async arreter() {
      const r = rec;
      if (!r) throw new EnregistrementVide();
      if (r.state !== 'inactive') r.stop();
      // Un navigateur qui ne dit jamais « stop » ne doit pas faire perdre ce qui est déjà reçu.
      let garde: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([arret, new Promise<void>((ok) => { garde = setTimeout(ok, ATTENTE_STOP_MS); })]);
      clearTimeout(garde);
      rec = null;
      liberer();
      const fin = finLe ?? maintenant();
      const mime = r.mimeType || MIME_PRIVE;
      return {
        blob: new Blob(morceaux, { type: mime }),
        mime,
        dureeS: Math.min(DUREE_MAX_S, Math.max(0, Math.round((fin.getTime() - debut.getTime()) / 1000))),
        emisLe: debut.toISOString(),
      };
    },

    liberer,
  };

  async function ouvrir(): Promise<void> {
    const media = d.media ?? navigator.mediaDevices;
    const R = d.Recorder ?? MediaRecorder;
    flux = await media.getUserMedia({ audio: true });
    let r: MediaRecorder;
    try {
      r = new R(flux, { mimeType: R.isTypeSupported(MIME_PRIVE) ? MIME_PRIVE : '', audioBitsPerSecond: DEBIT_PRIVE });
    } catch (e) {
      liberer(); // Le micro ne reste jamais ouvert sur un échec.
      throw e;
    }
    rec = r;
    morceaux = [];
    finLe = null;
    arret = new Promise((ok) => {
      r.addEventListener('stop', () => {
        finLe = maintenant();
        ok();
      }, { once: true });
    });
    r.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) morceaux.push(e.data);
    });
    r.addEventListener('error', () => d.surInterruption?.());
    for (const piste of flux.getTracks()) piste.addEventListener('ended', () => d.surInterruption?.());
    debut = maintenant();
    // Un morceau par seconde : une interruption garde tout ce qui précède.
    r.start(1000);
    limite = setTimeout(() => d.surLimite?.(), DUREE_MAX_S * 1000);
  }
}
