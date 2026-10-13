/**
 * Books dataset sub-export — `@filter-enginez/mock-data/books`.
 *
 * @packageDocumentation
 */

export { type Book, type BookFormat, type BookGenre } from './types.js';
export { books, loadFullBooks } from './data.js';
export { booksFilterConfig, getBooksFilterConfig } from './filter-config.js';
// `booksHandlers` is intentionally NOT re-exported here — see wine/index.ts for the
// MSW-in-workers explanation. Use `@filter-enginez/mock-data/handlers` if you want them.
