import type { Message } from 'grammy/types';

export interface CaptureEntrante {
  sourceRef: string;
  emisLe: Date;
  dureeS: number | null;
  fichier: { id: string; mime: string } | null;
  texte: string | null;
}

export function extraireCapture(m: Message): CaptureEntrante | null {
  // Une vidéo ronde envoyée par erreur est traitée comme un vocal : Gemini en lit la piste son.
  const media = m.voice ?? m.audio ?? (m.video_note ? { ...m.video_note, mime_type: 'video/mp4' } : undefined);
  if (!media && !m.text) return null;
  if (m.text?.startsWith('/')) return null;
  // CAP-05 : un transfert garde la date du message d'origine.
  const date = m.forward_origin?.date ?? m.date;
  return {
    sourceRef: `tg:${m.chat.id}:${m.message_id}`,
    emisLe: new Date(date * 1000),
    dureeS: media?.duration ?? null,
    fichier: media ? { id: media.file_id, mime: media.mime_type ?? 'audio/ogg' } : null,
    texte: m.text ?? null,
  };
}
