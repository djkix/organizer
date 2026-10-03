import 'reflect-metadata';
import { BadRequestException, Controller, Get, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configurerApp } from '../src/http.js';

@Controller('api/essai')
class EssaiController {
  @Get('panne')
  panne(): never {
    throw new Error('Argument texteEcrit invalide : secret de L');
  }

  @Get('refus')
  refus(): never {
    throw new BadRequestException('Mois attendu au format AAAA-MM.');
  }

  @Post('json')
  json(): { ok: true } {
    return { ok: true };
  }
}

@Module({ controllers: [EssaiController] })
class ModuleEssai {}

async function demarrer(): Promise<{ url: string; fermer(): Promise<void> }> {
  const app = await NestFactory.create<NestExpressApplication>(ModuleEssai, { logger: ['error', 'warn', 'log'], bodyParser: false });
  configurerApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, fermer: () => app.close() };
}

function capterJournal(): string[] {
  const journal: string[] = [];
  const capter = (...a: unknown[]): void => {
    journal.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x))).join(' '));
  };
  for (const m of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation(capter);
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => { journal.push(String(s)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => { journal.push(String(s)); return true; });
  return journal;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('erreurs de l\'API', () => {
  it('une erreur inattendue répond 500 sans rien recopier, ni dans la réponse ni dans le journal', async () => {
    const app = await demarrer();
    try {
      const journal = capterJournal();
      const r = await fetch(`${app.url}/api/essai/panne`);
      const corps = await r.text();
      vi.restoreAllMocks();
      expect(r.status).toBe(500);
      expect(JSON.parse(corps)).toEqual({ statusCode: 500, message: 'Erreur interne.' });
      expect(journal.join('\n')).not.toContain('secret');
      expect(journal.join('\n')).toContain('Erreur Error sur GET /api/essai/panne');
    } finally {
      await app.fermer();
    }
  });

  it('une erreur HTTP prévue garde son statut et son message', async () => {
    const app = await demarrer();
    try {
      const r = await fetch(`${app.url}/api/essai/refus`);
      expect(r.status).toBe(400);
      expect((await r.json()).message).toBe('Mois attendu au format AAAA-MM.');
    } finally {
      await app.fermer();
    }
  });

  it('un JSON illisible répond 400 sans citer le corps', async () => {
    const app = await demarrer();
    try {
      const journal = capterJournal();
      const r = await fetch(`${app.url}/api/essai/json`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"nom":"secret de L", oups',
      });
      const corps = await r.text();
      vi.restoreAllMocks();
      expect(r.status).toBe(400);
      expect(JSON.parse(corps)).toEqual({ message: 'Requête illisible.' });
      expect(journal.join('\n')).not.toContain('secret');
    } finally {
      await app.fermer();
    }
  });

  it('un JSON de plus de 1 Mo répond 413', async () => {
    const app = await demarrer();
    try {
      const r = await fetch(`${app.url}/api/essai/json`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(1_100_000) }),
      });
      expect(r.status).toBe(413);
      expect(await r.json()).toEqual({ message: 'Requête trop grosse.' });
    } finally {
      await app.fermer();
    }
  });

  it('toute réponse sous /api est no-store, erreurs comprises', async () => {
    const app = await demarrer();
    try {
      for (const chemin of ['/api/essai/refus', '/api/essai/panne', '/api/inconnue']) {
        const r = await fetch(`${app.url}${chemin}`);
        expect(r.headers.get('cache-control'), chemin).toBe('no-store');
      }
    } finally {
      await app.fermer();
    }
  });
});
