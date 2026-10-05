import type { JobAgenda } from '@organizer/shared';
import type { ConfigAgendaApi } from '../src/agenda/config.js';
import type { MagasinEtats } from '../src/agenda/etats.js';

export class MagasinEtatsMemoire implements MagasinEtats {
  readonly m = new Map<string, string>();
  async poser(etat: string, valeur: string): Promise<void> { this.m.set(etat, valeur); }
  async prendre(etat: string): Promise<string | null> { const v = this.m.get(etat) ?? null; this.m.delete(etat); return v; }
}

export function fausseFile() {
  const ajouts: Array<{ nom: string; data: JobAgenda; opts?: object }> = [];
  return { ajouts, add: async (nom: string, data: JobAgenda, opts?: object) => { ajouts.push({ nom, data, opts }); } };
}

export const CONFIG_AGENDA: ConfigAgendaApi = {
  clientId: 'id.apps.googleusercontent.com', redirectUri: 'https://organizer.essai/api/agenda/retour',
  urlAutorisation: 'https://accounts.google.com/o/oauth2/v2/auth',
};
