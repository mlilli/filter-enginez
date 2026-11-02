---
'@filter-enginez/url-state-router': patch
---

`<FilterEngineUrlSync>` no longer writes back a state it has just loaded from the URL. With `historyMode: 'push'`, Back
loaded the previous entry and the engine changes that load made pushed it again, so the next Back seemed to do nothing.

<!-- markdownlint-disable-file MD041 -->
