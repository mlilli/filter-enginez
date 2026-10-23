---
'@filter-enginez/url-state-router': patch
---

`<FilterEngineUrlSync>` no longer drops a filter change in apps that navigate inside React transitions. Such an app can
render the location of an older URL write after a newer one; the sync took that older value for an external link, loaded
it, and lost the newer change. It now remembers each of its writes until the location renders, so a late write is
recognized as its own and left alone. A filter change made while an earlier write's location renders also reaches the
URL, where it could previously be cancelled until the next change. Back and Forward always load, including to a state
the sync wrote itself, as do pasted links and in-app links to any `?f=`; a location carrying the state the engine
already holds is not loaded again. Apps that guarded the sync's engine against its own writes can drop that guard.

<!-- markdownlint-disable-file MD041 -->
