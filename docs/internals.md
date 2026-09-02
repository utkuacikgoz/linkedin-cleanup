# Internals

Notes for whoever has to fix this after LinkedIn changes something. Most of what
follows was learned by probing the live pages, not from documentation.

## Browser access

`playwright-core` attaches over CDP to a browser started by
`scripts/launch-browser.sh`. It only ever drives a tab it opened itself — the
user's other tabs are visible over CDP but are never read or navigated.

Since Chromium 136 the remote debugging port is refused for the **default** user
data dir, so the launcher keeps its own profile under
`~/.incleanup/<family>-profile`. There is no way around this; the user logs in
there once.

## LinkedIn serves more than one UI

The account is mid-migration, and the two markups need different handling:

| Page | Markup | Hook |
| --- | --- | --- |
| Connections | new | `[componentkey^="ConnectionCard_"]`, id is the suffix |
| People search | new | one `<a>` per result, wrapping the whole row |
| Network manager (pages, follows) | classic | `[data-chameleon-result-urn]`, artdeco buttons |

Both connections variants exist in the wild: one pages in on scroll, the other
needs a **Load more** button clicked. `clickLoadMore` handles the second; without
it a scan stops at the first screenful.

## Two front ends, one set of page readers

Everything that reads or interprets a LinkedIn page lives in `src/linkedin/`
and is consumed twice: the extension's content script imports the readers and
calls them, and the Playwright driver stringifies the same functions for
`page.evaluate`. Neither owns them.

That second path used to force the readers to be untyped source strings. `tsx`
compiles with esbuild's `keepNames`, which rewrites nested helpers into calls to
a `__name` helper that does not exist inside the page, so a real function broke
the moment it declared one.

`src/server/evaluate.ts` supplies an identity `__name` in the evaluated scope,
which removes the constraint entirely — the readers are ordinary type-checked
TypeScript again. Arguments cross as JSON, so a RegExp is passed as its source
string and rebuilt on the far side; that is why the two network-manager lists
are one parameterised reader rather than two functions sharing a helper. A
module-scope reference is `undefined` once a function is stringified, so every
reader must be self-contained.

`src/server/evaluate.test.ts` asserts all of this, including that the compiler
still emits `__name` at all — if a future toolchain stops, the shim is no longer
load-bearing and that test says so.

The extension needs none of it: content scripts are bundled as ordinary code,
and MV3's CSP forbids `eval` anyway.

## Reading a list

Rows are accumulated across scroll rounds, never snapshotted at the end —
LinkedIn virtualises long lists, so rows scrolled past are gone from the DOM well
before the list stops growing. The container and the ids already seen are cached
on `window`, so each round only reads genuinely new rows; walking up from every
anchor each round is quadratic and ends up slower than LinkedIn itself.

The page states its own total ("1,217 connections"), and that is used as the
target. Without it, a mid-list stall — LinkedIn pauses for tens of seconds — is
indistinguishable from the end of the list.

Scrolling targets the inner pane holding the most entries. Picking a pane by
size instead silently scrolls the wrong element and the scan stalls forever.

## Removing a connection

`src/linkedin/page/actions.ts` holds the only implementation, and both front
ends run it: the extension calls it in its content script, the driver
stringifies it. That is deliberate — there should not be two versions of the
operation LinkedIn cannot undo, and running the driver against a real account
exercises exactly what the extension runs.

Everything it needs lives inside the one exported function, because a
module-scope reference is `undefined` once a function is stringified. The
driver keeps what genuinely needs a browser: navigating to the list, the pacing
between entries, and the per-run caps.

Two things the DOM version has to do that Playwright did for free. The name
filter is React-controlled, so assigning `.value` updates the DOM and nothing
else — it goes through the native setter and dispatches `input`, or the list
never filters and the card is never found. And visibility is checked by
computed style plus a layout box, since there is no actionability check to lean
on.

From the connections list, never by opening profiles — visiting a profile shows
up in that person's "who viewed your profile".

Filter the list by name, match the card by profile id (so two people with the
same name cannot be confused), then **More actions → Remove connection**.

The confirmation is a **native `<dialog>`**. It carries the dialog role
implicitly, so an attribute selector like `[role="dialog"]` never matches it —
this cost a long debugging session in which the dialog appeared every time and
every probe reported that nothing had happened. Its confirm button reads
**"Remove connection"**, not "Remove".

The card menu occasionally does not open on the first click, so it gets one
retry before the row is called unreachable.

Success is the row dropping out of the list; if it lingers, the name filter is
re-run so the answer comes from LinkedIn rather than a stale DOM.

## Unfollowing

Each row has a `Click to stop following <name>` button. The row stays in place
afterwards and the button flips to "follow", so the button disappearing *is* the
proof. It needs a real wait — sampling once after a fixed pause reports
successful unfollows as failures.

## Shared connection counts

The connections page never mentions them. They come from 1st-degree people
search, which prints them under every result:

```
"A & B are mutual connections"            → 2
"A, B & 19 other mutual connections"      → 21
"A is a mutual connection"                → 1
(no such line)                            → 0
```

Two traps:

- The mutual-connection **names** are profile links too. Inferring result cards
  from links alone invents entries for them. A row only counts when its text
  carries a degree marker or a mutual line.
- The search is capped near 1,000 results. Entries past the cap keep
  `mutual: null` and are shown as `Unknown`. They must never be recorded as
  zero, or filtering for "0 shared" quietly sweeps up people nobody looked up.
- The same rule applies to language. The row filter accepts Turkish results, so
  a parser that knew only English phrases returned `0` for every one of them —
  and "0 shared" is the filter the README recommends before a bulk removal. The
  reader now reports `<html lang>` alongside the rows, and `parseMutualCount`
  returns `0` only for a language it actually has patterns for. Anything else is
  `null`. Adding a language means adding patterns to `src/linkedin/mutuals.ts`
  and nothing else.

## Profile photos are proxied

Photos live on `media.licdn.com`. Loading them straight from a page served on
localhost is exactly the cross-origin request privacy blockers drop, and the
pictures silently vanish — the URLs themselves are fine, and fetch them from
Node and they return 200. `/api/avatar` re-serves them so the browser sees
same-origin images.

The host allowlist (`https` and a real `licdn.com` suffix) is what stops that
endpoint being an open proxy — without it, it would happily fetch anything,
including services bound to localhost.

The URLs are also signed and expire in weeks, so the row falls back to initials
when an image will not load, whatever the reason.

## The keep list

Protected entries are filtered out of the list in the UI, but that is the
convenience, not the guarantee: `/api/datasets/:kind/act` drops them from the
targets before anything runs, so a stale page or a hand-rolled request cannot
reach them either.

It is stored in its own `whitelist.json` rather than as a flag on the entities,
so a rescan — which rewrites the snapshot wholesale — cannot lose it.

## Why not the internal API

LinkedIn's public API does not expose connection management at all, and the
internal one has no bulk endpoint — removals are one call per person either way,
so the only gain is per-call latency. Driving the UI is slower but it is the
traffic LinkedIn expects from a signed-in person. Calling the internal API
directly is the clearest automation signal an account can send.

## Where things live

| File | |
| --- | --- |
| `src/linkedin/page/connections.ts` | Connections page + scrolling |
| `src/linkedin/page/manager.ts` | Network-manager lists |
| `src/linkedin/page/search.ts` | People search rows + page language |
| `src/linkedin/mutuals.ts` | Shared-connection counts, per language |
| `src/linkedin/datasets.ts` | Per-list URLs, readers, mapping |
| `src/linkedin/heuristics.ts` | The "looks like a company" guess |
| `src/linkedin/pacing.ts` | Scroll pacing both front ends share |
| `src/server/evaluate.ts` | Running a reader through Playwright |
| `src/linkedin/page/actions.ts` | Remove and unfollow, in the page |
| `src/linkedin/labels-ui.ts` | Every control label, in both languages |
| `src/server/actions.ts` | Navigation, pacing and caps for the driver |
| `extension/src/content.ts` | Running a reader in the extension |
