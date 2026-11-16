export interface Bookmark {
  name: string
  path: string
}

const KEY = 'asset-browser.bookmarks.v1'

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((b) => b && typeof b.path === 'string' && typeof b.name === 'string')
  } catch {
    return []
  }
}

export function saveBookmarks(list: Bookmark[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 忽略配额错误 */
  }
}

export function addBookmark(list: Bookmark[], b: Bookmark): Bookmark[] {
  if (list.some((x) => x.path.toLowerCase() === b.path.toLowerCase())) return list
  const next = [...list, b]
  saveBookmarks(next)
  return next
}

export function removeBookmark(list: Bookmark[], path: string): Bookmark[] {
  const next = list.filter((x) => x.path.toLowerCase() !== path.toLowerCase())
  saveBookmarks(next)
  return next
}

export function isBookmarked(list: Bookmark[], path: string): boolean {
  return list.some((x) => x.path.toLowerCase() === path.toLowerCase())
}
