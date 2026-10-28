// Minimal reproduction of the iframe <-> Jira host hash sync used by our Forge Custom UI app.
// Pattern (same as production, stripped of all product logic):
//   1. On load: copy the hash from the host URL (context.extension.location) into the iframe URL.
//   2. iframe -> host: on `hashchange`, debounce with requestAnimationFrame and call
//      `history.replace(window.location.hash)` on the object from `view.createHistory()`.
//   3. host -> iframe: in `history.listen`, if the host hash differs from the iframe hash, apply it
//      with `window.history.replaceState` and dispatch a synthetic `hashchange` event.
//   4. In-app navigation: `window.history.replaceState(null, '', '#/route')` followed by a
//      synthetic `hashchange` event (our router listens to it), plus plain `<a href="#/route">`.
import { view, router } from '@forge/bridge';

const t0 = Date.now();
const counters = { listen: 0, hostReplace: 0, replaceState: 0, errors: 0 };
const opts = { syncToHost: true, syncFromHost: true };

let history = null;
let hostBaseUrl = '';
let lastSyncedHash = '';
let isUpdatingFromParent = false;
let rafId = null;

const $ = (id) => document.getElementById(id);

const renderState = () => {
  const rows = {
    'iframe location.hash': window.location.hash || '(empty)',
    'host history.location.hash': history ? history.location.hash || '(empty)' : '(not ready)',
    'history.listen calls': counters.listen,
    'history.replace calls': counters.hostReplace,
    'window.history.replaceState calls': counters.replaceState,
    'errors': counters.errors,
  };
  $('state').innerHTML = Object.entries(rows)
    .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
    .join('');
};

const log = (message, detail) => {
  const line = `+${Date.now() - t0}ms ${message}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`;
  console.info('[repro]', line);
  $('log').textContent = line + '\n' + $('log').textContent;
  renderState();
};

// Errors (for example a SecurityError from the History API) are shown on screen and counted.
const guarded = (label, fn) => {
  try {
    return fn();
  } catch (error) {
    counters.errors += 1;
    log(`${label} THREW ${error.name}: ${error.message}`);
    return undefined;
  }
};

const replaceIframeUrl = (label, url) => {
  counters.replaceState += 1;
  log(`window.history.replaceState (${label})`, url);
  guarded('window.history.replaceState', () => window.history.replaceState(null, '', url));
};

const fireHashChange = (oldURL) => {
  window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL, newURL: window.location.href }));
};

const replaceHostHash = (label, hash) => {
  if (!opts.syncToHost) {
    log(`history.replace skipped by switch (${label})`, hash);
    return;
  }
  counters.hostReplace += 1;
  log(`history.replace (${label})`, hash);
  guarded('history.replace', () => history.replace(hash));
};

// In-app navigation, same shape as our router's hash update.
const navigateInApp = (route) => {
  const oldURL = window.location.href;
  replaceIframeUrl('in-app navigation', `#${route}`);
  fireHashChange(oldURL);
};

const setupHostToIframe = () => {
  history.listen((location, action) => {
    counters.listen += 1;
    const parentHash = location.hash || '';
    const iframeHash = window.location.hash;
    log('history.listen', { action, parentHash, iframeHash });

    if (!opts.syncFromHost || parentHash === iframeHash) return;

    // Host navigated to the bare app URL while the iframe has a route: push the iframe route back.
    if (!parentHash && iframeHash && iframeHash !== '#' && iframeHash !== '#/') {
      replaceHostHash('restore iframe route to host', iframeHash);
      lastSyncedHash = iframeHash;
      return;
    }

    isUpdatingFromParent = true;
    const oldURL = window.location.href;
    replaceIframeUrl(
      'apply host hash',
      parentHash || window.location.pathname + window.location.search,
    );
    fireHashChange(oldURL);
    lastSyncedHash = parentHash;
    setTimeout(() => {
      isUpdatingFromParent = false;
    }, 50);
  });
};

const setupIframeToHost = () => {
  window.addEventListener('hashchange', () => {
    if (isUpdatingFromParent) return;

    const currentHash = window.location.hash;
    if (!currentHash || currentHash === '#' || currentHash === '#/') return;
    if (currentHash === lastSyncedHash) return;

    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      const finalHash = window.location.hash;
      if (finalHash && finalHash !== lastSyncedHash) {
        replaceHostHash('hashchange', finalHash);
        lastSyncedHash = finalHash;
      }
      rafId = null;
    });
  });
};

const BARE_KEY = 'repro-bare-mode';
const isBare = () => {
  try {
    return localStorage.getItem(BARE_KEY) === 'true';
  } catch {
    return false;
  }
};

const init = async () => {
  const bare = isBare();
  $('bare-mode').checked = bare;
  $('bare-mode').addEventListener('change', (e) => {
    try {
      localStorage.setItem(BARE_KEY, String(e.target.checked));
    } catch {
      log('could not persist bare mode (localStorage unavailable)');
    }
    log('bare mode changed, reload the page to apply', e.target.checked);
  });

  $('sync-to-host').addEventListener('change', (e) => (opts.syncToHost = e.target.checked));
  $('sync-from-host').addEventListener('change', (e) => (opts.syncFromHost = e.target.checked));

  document.querySelectorAll('button[data-route]').forEach((button) =>
    button.addEventListener('click', () => navigateInApp(button.dataset.route)),
  );
  $('router-nav').addEventListener('click', () => {
    const url = `${hostBaseUrl}#/b`;
    log('router.navigate', url);
    router.navigate(url);
  });

  // 1. Initial sync: host URL hash -> iframe URL.
  const context = await view.getContext();
  const [base, parentHashRoute] = context.extension.location.split('#');
  hostBaseUrl = base;
  if (parentHashRoute) {
    replaceIframeUrl('initial host hash', `#${parentHashRoute}`);
  } else if (window.location.hash) {
    replaceIframeUrl('initial clear', window.location.pathname + window.location.search);
  }

  // Bare mode: no view.createHistory(), no listeners. Anchors are plain hash changes.
  if (bare) {
    window.addEventListener('hashchange', renderState);
    log('ready in BARE mode (no createHistory, no sync listeners)', {
      hostLocation: context.extension.location,
    });
    return;
  }

  // 2 + 3. Both sync directions.
  history = await view.createHistory();
  setupHostToIframe();
  setupIframeToHost();
  window.addEventListener('hashchange', renderState);

  log('ready', { hostLocation: context.extension.location });
};

renderState();
init().catch((error) => log(`init failed ${error.name}: ${error.message}`));
