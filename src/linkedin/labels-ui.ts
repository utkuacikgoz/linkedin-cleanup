/**
 * Every LinkedIn control this tool touches, matched against its English and
 * Turkish wording. One table, because a language added in four scattered files
 * is a language added in three of them.
 *
 * These cross into the page as regex *source strings*: arguments are JSON, and
 * a RegExp does not survive that.
 */
export const CONTROL_LABELS = {
  moreActions: '^(more actions|.* için diğer işlemler)',
  removeItem: '^(remove connection|bağlantıyı kaldır|bağlantıdan çıkar)',
  /**
   * The confirmation button reads "Remove connection", not "Remove"; matching
   * the short label alone leaves the dialog hanging open. "Cancel" must never
   * match, or a cancel is reported as a removal.
   */
  confirm: '^(remove connection|remove|unfollow|bağlantıyı kaldır|kaldır|takibi bırak)$',
  stopFollowing: '(stop following|takibi bırak)',
  searchByName: '(search by name|isme göre ara)',
  loadMore: '^(load more|show more results|show more|daha fazla|daha fazla sonuç)',
} as const
