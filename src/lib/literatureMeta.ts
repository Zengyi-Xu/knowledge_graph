import type { LiteratureMeta } from '@/types/note'
import type { ImportedLit } from './literature'

/** Lightweight conversion kept separate from the on-demand citation engine. */
export function toLiteratureMeta(imported: ImportedLit, citekey: string): LiteratureMeta {
  return { authors: imported.authors, venue: imported.venue, year: imported.year, doi: imported.doi, citekey, attachments: [], collections: [] }
}
