import type { Message } from 'grammy/types';
import { describe, expect, it } from 'vitest';
import { extraireCapture } from '../src/ingestion/extraire.js';

const base = { message_id: 42, date: 1_791_270_720, chat: { id: 7, type: 'private', first_name: 'x' } } as const;
const msg = (m: Record<string, unknown>) => ({ ...base, ...m }) as unknown as Message;

describe('extraireCapture', () => {
  it('un vocal', () => {
    const c = extraireCapture(msg({ voice: { file_id: 'F', file_unique_id: 'U', duration: 12, mime_type: 'audio/ogg' } }));
    expect(c).toEqual({ sourceRef: 'tg:7:42', emisLe: new Date(1_791_270_720_000), dureeS: 12, fichier: { id: 'F', mime: 'audio/ogg' }, texte: null });
  });

  it('un texte d\'un seul mot', () => {
    expect(extraireCapture(msg({ text: 'pain' }))).toMatchObject({ texte: 'pain', fichier: null, dureeS: null });
  });

  it('une vidéo ronde est traitée comme un vocal', () => {
    const c = extraireCapture(msg({ video_note: { file_id: 'V', file_unique_id: 'U', duration: 5, length: 240 } }));
    expect(c?.fichier).toEqual({ id: 'V', mime: 'video/mp4' });
  });

  it('un message transféré garde la date d\'origine', () => {
    const c = extraireCapture(msg({ text: 'idée', forward_origin: { type: 'hidden_user', date: 1_791_000_000, sender_user_name: 'x' } }));
    expect(c?.emisLe).toEqual(new Date(1_791_000_000_000));
  });

  it('ignore les commandes et les messages sans voix ni texte', () => {
    expect(extraireCapture(msg({ text: '/start 123' }))).toBeNull();
    expect(extraireCapture(msg({ sticker: { file_id: 'S' } }))).toBeNull();
  });

  it('la légende d\'un vocal devient son texte', () => {
    const c = extraireCapture(msg({ voice: { file_id: 'F', file_unique_id: 'U', duration: 3 }, caption: 'pour jeudi' }));
    expect(c).toMatchObject({ texte: 'pour jeudi', fichier: { id: 'F', mime: 'audio/ogg' } });
  });

  it('une photo avec légende est captée comme du texte', () => {
    const c = extraireCapture(msg({ photo: [{ file_id: 'P', file_unique_id: 'U', width: 1, height: 1 }], caption: 'idée déco' }));
    expect(c).toMatchObject({ texte: 'idée déco', fichier: null, dureeS: null });
  });

  it('un sticker ou une photo sans légende ne donne rien', () => {
    expect(extraireCapture(msg({ sticker: { file_id: 'S' } }))).toBeNull();
    expect(extraireCapture(msg({ photo: [{ file_id: 'P', file_unique_id: 'U', width: 1, height: 1 }] }))).toBeNull();
  });
});
