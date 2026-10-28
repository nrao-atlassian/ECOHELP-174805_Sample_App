# Forge hash navigation repro (Custom UI, `jira:projectPage`)

A minimal "Hello World" Forge app that reproduces the hash-sync pattern our production Custom UI app uses
between the iframe and the Jira host. It contains no product logic.

## Problem being investigated

In our production app, a hash change inside the Custom UI iframe leaves the Jira project page stuck on the
grey loading skeleton (the placeholder shown while the iframe loads). It only happens in **Safari**; it does
not happen in Chrome. When it occurs, the host logs:

```
[Error] Failed to open iframe bridge – TimeoutError: Handshake timeout: no response within 20000ms
        (async-forge-ui-full-page-extension.….js)
```

After that the iframe loads again from scratch.

## What the app does

It mirrors our production sync, in `static/hello-world/src/main.js`:

1. **On load**: reads `context.extension.location` from `view.getContext()` and copies its hash into the
   iframe URL with `window.history.replaceState`.
2. **iframe → host**: a `hashchange` listener (debounced with `requestAnimationFrame`) calls
   `history.replace(window.location.hash)` on the object returned by `view.createHistory()`.
3. **host → iframe**: `history.listen(...)` compares the host hash with the iframe hash and, if they differ,
   applies it with `window.history.replaceState` and dispatches a synthetic `hashchange` event.
4. **In-app navigation**: buttons that do `window.history.replaceState(null, '', '#/route')` followed by a
   synthetic `hashchange`, plain `<a href="#/route">` anchors, and one `router.navigate(hostUrl + '#/b')`.

The page shows live counters (`history.listen` calls, `history.replace` calls,
`window.history.replaceState` calls, errors) and a timestamped log. Exceptions from the History API are caught
and shown on screen. The two checkboxes switch each sync direction off to help isolate which one matters.

## Setup

Requires Node 20+ and the Forge CLI (`npm i -g @forge/cli`, then `forge login`).

```bash
cd forge-hash-nav-repro
forge register                      # writes a new app id into manifest.yml
cd static/hello-world
npm install
npm run build                       # outputs static/hello-world/build
cd ../..
forge deploy
forge install --product jira --site <your-site>.atlassian.net
```

Open a Jira software or business project on that site and choose the **Hash Nav Repro** tab. After code
changes, rebuild and run `forge deploy` again.

## Steps to reproduce

1. Open the **Hash Nav Repro** project tab in Safari. Note the counters.
2. Click **anchor #/a**, **anchor #/b**, and the `replaceState + hashchange` buttons.
3. Compare with Chrome.
4. Tick **Bare mode** (no `view.createHistory()`, no listeners), reload, and click the anchors again.
5. Use the sync checkboxes to turn off one sync direction and repeat.

## Expected / observed

- Expected: the page keeps rendering and the Jira URL hash follows the iframe.
- Observed in our production app (Safari only): the project page shows the loading skeleton indefinitely after a
  hash change.

## Notes and limitations

- Production code additionally intercepts anchor clicks, blocks Back navigation in some flows and has a
  Safari-specific workaround that disables the iframe → host sync. None of that is included here.
- `@forge/bridge` is pinned to 5.17.0, the version our production app uses.
