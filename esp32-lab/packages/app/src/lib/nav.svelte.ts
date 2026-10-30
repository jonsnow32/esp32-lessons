// Where the user is (home or a workspace, and a detail page over it), kept in the URL hash so
// the browser's back and forward buttons move between the app's pages instead of leaving it,
// and a reload comes back to the same place:
//   #/                   home
//   #/<route>            a lesson, a project or the sandbox
//   #/<route>/doc/<page> a detail page over it (#/doc/<page> over home)
import { untrack } from 'svelte';
import { BOARDS, BREADBOARDS, FEATURED, LESSONS, PARTS } from './catalog';
import { FREE, lab } from './lab.svelte';

interface Place {
  route: string;
  doc: string | null;
}

function hashOf({ route, doc }: Place): string {
  const parts = [...(route === 'home' ? [] : [route]), ...(doc ? ['doc', doc] : [])];
  return '#/' + parts.map(encodeURIComponent).join('/');
}

/** The place a hash names, anything unknown in it dropped. */
function parse(hash: string): Place {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const route = parts[0] !== 'doc' ? parts.shift() : undefined;
  const doc = parts[0] === 'doc' ? (parts[1] ?? null) : null;
  return { route: route && routeExists(route) ? route : 'home', doc: doc && docExists(doc) ? doc : null };
}

const routeExists = (id: string) => id === FREE || LESSONS.some((l) => l.id === id) || FEATURED.some((f) => f.id === id) || lab.myProjects.some((p) => p.id === id);

function docExists(page: string) {
  if (page === 'inventory') return true;
  if (page.startsWith('board:')) return page.slice('board:'.length) in BOARDS;
  if (page.startsWith('bb:')) return page.slice('bb:'.length) in BREADBOARDS;
  return page in PARTS;
}

/** What kind of detail page: stepping between pages of one kind is one history entry. */
const docKind = (page: string) => (page.includes(':') ? page.slice(0, page.indexOf(':')) : page === 'inventory' ? page : 'part');

/** How many entries the app has pushed onto the history before the current one. */
const depth = () => (history.state as { depth?: number } | null)?.depth ?? 0;

/** The place last written to the history. */
let last: Place | null = null;
/** Moving to a place from the history: nothing is written meanwhile. */
let applying = false;

function write(place: Place) {
  if (applying) return;
  const prev = last;
  last = place;
  const hash = hashOf(place);
  if (hash === (location.hash || '#/')) return;
  const replace =
    !prev ||
    // The first change to a featured project makes the user's copy: the same page, renamed
    (place.route !== prev.route && lab.myProjects.some((p) => p.id === place.route && p.from === prev.route)) ||
    // ‹ Trước / Sau › on a detail page
    (place.route === prev.route && !!place.doc && !!prev.doc && docKind(place.doc) === docKind(prev.doc));
  if (replace) history.replaceState({ depth: depth() }, '', hash);
  else history.pushState({ depth: depth() + 1 }, '', hash);
}

async function apply(place: Place) {
  applying = true;
  try {
    if (place.route !== lab.route) {
      if (place.route === 'home') lab.goHome();
      else await lab.open(place.route);
    }
    lab.docPage = place.doc;
  } finally {
    applying = false;
  }
  last = null;
  write({ route: lab.route, doc: lab.docPage });
}

/** Close the detail page: back to the page it was opened from, as the browser's back would. */
export function closeDoc() {
  if (depth() > 0) return history.back();
  // Opened straight from a link: nothing of the app's to go back to, so this entry becomes the page under it
  lab.docPage = null;
  last = { route: lab.route, doc: null };
  history.replaceState({ depth: 0 }, '', hashOf(last));
}

/** Go where the URL says, then keep the URL and the history in step with the app. */
export function startNav() {
  history.replaceState({ depth: depth() }, '', location.hash || '#/');
  window.addEventListener('popstate', () => void apply(parse(location.hash)));
  void apply(parse(location.hash));
  $effect.root(() => {
    $effect(() => {
      const place = { route: lab.route, doc: lab.docPage };
      untrack(() => write(place));
    });
  });
}
