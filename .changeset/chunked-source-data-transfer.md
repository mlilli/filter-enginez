---
'@filter-enginez/reactive-rxjs': patch
'@filter-enginez/reactive-signals': patch
'@filter-enginez/worker-bridge': patch
---

A worker-backed engine copies its source data to the main thread in chunks. `createSignalsEngineFromAsync` and
`createRxJsEngineFromAsync` copied the whole corpus in one message, which the main thread deserialized in one task:
about 700 ms for 150,000 wines on a 4×-throttled CPU, during which the page could not respond to input. They now request
7,500 records at a time, one request after the other, so each chunk is its own task (under 45 ms in the same
measurement) and the page handles input in between. The records, and their order, are unchanged. The
`sourceDataChunkSize` option sets the chunk size.

A `reset` or a time-travel jump no longer copies the corpus again: the adapters ask the worker whether its source data
has been replaced, and keep the copy they hold when it has not. Replaced source data is copied in chunks.

`worker-bridge` adds `getSourceDataRange(offset, count)` to the `wrapInWorker` facade, returning a slice of the source
data with its `total` and a `revision` that changes when the source data is replaced, and `createSourceDataPuller`,
which the adapters use to assemble the chunks. `getSourceDataRange` is optional on `FilterEngineAsync`, so an engine
over another transport stays valid; the adapters copy such an engine's source data in one message, as before.

<!-- markdownlint-disable-file MD041 -->
