---
'@filter-enginez/url-state-router': patch
---

`<FilterEngineUrlSync>` keeps a navigation the user just made. React Router commits a navigation inside a transition, so
for a moment after a link click the router is on the new entry while the old route is still on screen. A debounced
filter write that landed in that moment was built from the old location and replaced the new entry with it, which took
the user back to the route they had just left. A write now compares the router's current entry with the rendered
location first; when they differ, it waits for the next location to render. If that location unmounts the sync, the
write is dropped with it; a sync that stays mounted writes the latest filter state onto the new location.

<!-- markdownlint-disable-file MD041 -->
