---
'@filter-enginez/reactive-rxjs': patch
'@filter-enginez/reactive-signals': patch
---

`createSignalsEngineFromAsync` and `createRxJsEngineFromAsync` boot from the worker's result indices instead of its
results. With no rules active the results are the whole corpus, so boot copied the corpus across the worker boundary
twice; it now copies it once, which roughly halves the main-thread cost of booting a large dataset.

<!-- markdownlint-disable-file MD041 -->
