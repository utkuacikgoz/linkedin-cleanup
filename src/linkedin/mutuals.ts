/**
 * Shared-connection counts, read from the text LinkedIn prints under each
 * result in 1st-degree people search.
 *
 * The count feeds the "0 shared" filter, which is how people decide who to
 * remove — and removing a connection cannot be undone. So the one rule that
 * matters here: text this parser cannot read is `null` (unknown), never `0`.
 * Reporting an unread row as zero sweeps it into exactly the selection a user
 * is about to act on.
 */

export type Locale = 'en' | 'tr'

const SUPPORTED: readonly Locale[] = ['en', 'tr']

/**
 * LinkedIn renders in the account's own language and states it on <html lang>.
 * Anything outside the set of languages the patterns below actually cover
 * resolves to `null`, so its rows stay unknown rather than being guessed at.
 */
export function localeOf(lang: string | null | undefined): Locale | null {
  const base = (lang ?? '').trim().toLowerCase().split('-')[0] ?? ''
  return SUPPORTED.includes(base as Locale) ? (base as Locale) : null
}

type Pattern = { match: RegExp; count: (m: RegExpMatchArray) => number }

/**
 * Ordered most specific first: the "and N others" line also contains the
 * two-name and one-name shapes, so a looser pattern placed earlier would win
 * and under-count.
 *
 *   "A, B & 19 other mutual connections"        → 21
 *   "A & B are mutual connections"              → 2
 *   "A is a mutual connection"                  → 1
 *   "A, B ve 19 diğer ortak bağlantınız var"    → 21
 *   "A ve B ortak bağlantınız"                  → 2
 *   "A ortak bağlantınız"                       → 1
 */
const PATTERNS: Record<Locale, Pattern[]> = {
  en: [
    {
      match: /&\s*([\d,.]+)\s*other\s+mutual\s+connection/i,
      count: (m) => plus(m[1], 2),
    },
    { match: /\bare\s+mutual\s+connections\b/i, count: () => 2 },
    { match: /\bis\s+a\s+mutual\s+connection\b/i, count: () => 1 },
  ],
  tr: [
    {
      match: /\bve\s*([\d,.]+)\s*(?:diğer|başka)\s+ortak\s+bağlant/i,
      count: (m) => plus(m[1], 2),
    },
    { match: /\bve\b[^|]*\bortak\s+bağlant/i, count: () => 2 },
    { match: /\bortak\s+bağlant/i, count: () => 1 },
  ],
}

const plus = (raw: string | undefined, base: number): number => {
  const rest = Number((raw ?? '').replace(/[^\d]/g, ''))
  return Number.isFinite(rest) ? rest + base : base
}

/**
 * `null` means "we could not read this", which the UI shows as Unknown and the
 * "0 shared" filter excludes. `0` is only ever returned for a language whose
 * mutual-connection wording this file actually knows — there, no matching line
 * genuinely means no shared connections.
 */
export function parseMutualCount(text: string, locale: Locale | null): number | null {
  if (locale === null) return null

  for (const pattern of PATTERNS[locale]) {
    const found = text.match(pattern.match)
    if (found) return pattern.count(found)
  }

  return 0
}
