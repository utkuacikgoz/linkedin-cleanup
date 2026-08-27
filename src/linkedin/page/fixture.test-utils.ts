import { JSDOM } from 'jsdom'

/**
 * Test-only. jsdom implements `textContent` but not `innerText`, and every
 * reader in this directory depends on `innerText` specifically — it is what
 * puts each field of a LinkedIn card on its own line, which is how names,
 * headlines and "Connected on …" are told apart.
 *
 * `textContent` would flatten a card to a single line and quietly turn every
 * row into a name with no headline, so the fixtures get an approximation good
 * enough for that distinction: block elements and <br> introduce a newline,
 * inline runs are collapsed to single spaces.
 */
const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BUTTON', 'DD', 'DIV', 'DL', 'DT',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LABEL',
  'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL',
])

function approximateInnerText(root: Node): string {
  let out = ''

  const newline = () => {
    if (out.length > 0 && !out.endsWith('\n')) out += '\n'
  }

  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ')
      return
    }
    if (node.nodeType !== 1) return

    const tag = (node as Element).tagName
    if (tag === 'SCRIPT' || tag === 'STYLE') return
    if (tag === 'BR') {
      out += '\n'
      return
    }

    const isBlock = BLOCK.has(tag)
    if (isBlock) newline()
    for (const child of node.childNodes) walk(child)
    if (isBlock) newline()
  }

  walk(root)
  return out
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

/** A jsdom page with `innerText` available, ready for a reader to run against. */
export function pageWith(html: string): JSDOM {
  const dom = new JSDOM(html, { runScripts: 'outside-only' })

  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement) {
      return approximateInnerText(this)
    },
  })

  return dom
}

/**
 * Runs a reader in the page, exactly as the Playwright driver would.
 *
 * The result is serialised on the way out for the same reason it is over CDP:
 * values built inside the page belong to that realm, so a jsdom array is not a
 * Node array and compares unequal to one however identical it looks.
 */
export function runInPage<T>(dom: JSDOM, source: string): T {
  return JSON.parse(JSON.stringify(dom.window.eval(source) ?? null)) as T
}
