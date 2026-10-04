import type { BuildResult, Metafile } from 'esbuild';

export function empaqueter(dossierApp: string, entrees: string[], sortie?: string): Promise<BuildResult & { metafile: Metafile }>;
export function importsExternes(metafile: Metafile): string[];
