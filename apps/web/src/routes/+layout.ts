import { redirect } from '@sveltejs/kit';
import { garde } from '$lib/client';
import { CHEMINS } from '$lib/config';
import { redirection, type EtatSession } from '$lib/session';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ url }): Promise<{ session: EtatSession | null }> => {
  // Le raccourci privé n'attend jamais le réseau : 3 s au plus jusqu'à l'enregistrement.
  if (url.pathname === CHEMINS.enregistreur) return { session: null };
  const session = await garde.etat();
  const cible = redirection(url.pathname, session);
  if (cible) redirect(307, cible);
  return { session };
};
