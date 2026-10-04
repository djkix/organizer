import { HttpsProxyAgent } from 'https-proxy-agent';
import { EnvHttpProxyAgent, fetch as fetchUndici } from 'undici';

/** Adresse du proxy sortant (HTTPS_PROXY) ; rien en développement. */
export function proxySortant(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HTTPS_PROXY || env.https_proxy || undefined;
}

/**
 * fetch qui passe par le proxy sortant quand il est configuré (cahier, section Réseaux).
 * undici porte son propre fetch : le fetch global de Node n'est jamais modifié.
 */
export function creerFetchSortant(env: NodeJS.ProcessEnv = process.env): typeof fetch {
  const proxy = proxySortant(env);
  if (!proxy) return (entree, init) => fetch(entree, init);
  const agent = new EnvHttpProxyAgent({ httpProxy: proxy, httpsProxy: proxy, noProxy: env.NO_PROXY ?? env.no_proxy ?? '' });
  const viaProxy = (entree: string | URL, init?: RequestInit) =>
    fetchUndici(entree, { ...(init as object), dispatcher: agent } as unknown as Parameters<typeof fetchUndici>[1]);
  return viaProxy as unknown as typeof fetch;
}

/** Agent pour grammY, qui passe par node-fetch : même proxy, mêmes règles. */
export function agentSortant(env: NodeJS.ProcessEnv = process.env): HttpsProxyAgent<string> | undefined {
  const proxy = proxySortant(env);
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

/** Essai de sortie pour l'exploitation. Aucun corps n'est lu ni affiché. */
export async function essayerSortie(url: string, f: typeof fetch): Promise<string> {
  try {
    const r = await f(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    await r.body?.cancel();
    return `joignable (HTTP ${r.status})`;
  } catch (e) {
    const cause = (e as { cause?: { code?: string; name?: string } }).cause;
    return `refusé (${cause?.code ?? cause?.name ?? (e as Error).name})`;
  }
}
