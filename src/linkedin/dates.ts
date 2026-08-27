const TURKISH_MONTHS = [
  'ocak',
  'şubat',
  'mart',
  'nisan',
  'mayıs',
  'haziran',
  'temmuz',
  'ağustos',
  'eylül',
  'ekim',
  'kasım',
  'aralık',
]

/**
 * "Connected on June 29, 2026" / "22 Ağustos 2024". The label has to be matched
 * around rather than stripped — trimming to the first digit eats the month.
 */
export const parseConnectedText = (text: string): number | undefined => {
  const english = text.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/)
  if (english) {
    const parsed = Date.parse(`${english[1]} ${english[2]}, ${english[3]}`)
    if (Number.isFinite(parsed)) return parsed
  }

  // en-GB and friends render the day first: "29 June 2024". The ASCII-only
  // month class is what keeps this from swallowing "22 Ağustos 2024" — those
  // fall through to the lookup below.
  const dayFirst = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
  if (dayFirst) {
    const parsed = Date.parse(`${dayFirst[2]} ${dayFirst[1]}, ${dayFirst[3]}`)
    if (Number.isFinite(parsed)) return parsed
  }

  const turkish = text.match(/(\d{1,2})\s+([^\s\d]+)\s+(\d{4})/)
  if (turkish) {
    const month = TURKISH_MONTHS.indexOf(turkish[2]!.toLocaleLowerCase('tr'))
    if (month >= 0) return Date.UTC(Number(turkish[3]), month, Number(turkish[1]))
  }

  return undefined
}
