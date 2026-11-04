---
'@filter-enginez/react-signals': patch
'@filter-enginez/react-rxjs': patch
'@filter-enginez/url-state-router': patch
---

The React packages accept React 18. `react-signals` and `react-rxjs` declare `react@^18.3.0 || ^19.0.0`, and
`url-state-router` declares `react@^18.3.0 || ^19.0.0` and `react-router@^7.18.2 || ^8.3.0` (7.18.2 is the first 7.x
release with every react-router advisory patched). The provider now renders as `<Context.Provider>`, and
`<FilterEngineUrlSync>` reads the router's contexts with `useContext`, the forms React 18 and 19 both support; nothing
else changes. Each package's tests also run on React 18.3 and react-router 7.18, and its source is type-checked against
React 18's typings. An app on `react-router-dom` 7 should install `react-router` at the same version, since
`url-state-router` imports `react-router` directly.

<!-- markdownlint-disable-file MD041 -->
