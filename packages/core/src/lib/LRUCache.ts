/**
 * Least-Recently-Used cache backed by a doubly-linked list + hashmap.
 *
 * @remarks
 * Used internally by the simulation cache (`internals/SimulationCache`); also exported for
 * consumers who want the same structure.
 *
 * Operations are O(1):
 *   - `get(key)` — hashmap lookup + linked-list head promotion
 *   - `set(key, value)` — hashmap insert + linked-list head insertion + optional tail evict
 *   - `remove(node)` — linked-list unlink + hashmap delete
 *
 * Iterable via `Symbol.iterator` from head (most recent) to tail (least recent).
 *
 * @packageDocumentation
 */

/**
 * A single node in the LRU cache's doubly-linked list.
 *
 * @internal Exposed for advanced consumers; most users only interact via the cache's
 *           `set` / `get` / `remove` / `forEach` / iterator API.
 */
export class LRUCacheNode<T> {
	key: string;
	next: LRUCacheNode<T> | null;
	prev: LRUCacheNode<T> | null;
	value: T;

	constructor(key: string, value: T) {
		this.key = key;
		this.value = value;
		this.next = null;
		this.prev = null;
	}
}

/**
 * Bounded Least-Recently-Used cache with O(1) get/set/remove.
 *
 * @example
 *   const cache = new LRUCache<string>(3);
 *   cache.set('a', 'apple');
 *   cache.set('b', 'banana');
 *   cache.set('c', 'cherry');
 *   cache.set('d', 'date');     // evicts 'a' (least recently used)
 *   cache.get('b');             // → 'banana', promotes 'b' to most recently used
 *
 * @typeParam T - The type of values cached
 */
export class LRUCache<T> {
	/** Current number of entries. */
	size: number;

	/** Maximum allowed entries. New entries past this limit evict the tail. */
	limit: number;

	/** Most-recently-used node (head of the linked list). */
	head: LRUCacheNode<T> | null;

	/** Least-recently-used node (tail of the linked list). */
	tail: LRUCacheNode<T> | null;

	/** O(1) key → node lookup. */
	private readonly _cacheMap: Map<string, LRUCacheNode<T>>;

	/**
	 * Create a new LRU cache.
	 *
	 * @param limit - Maximum number of entries. Defaults to 10. When the cache is at limit and
	 *                a new key is inserted, the tail (least-recently-used) entry is evicted.
	 */
	constructor(limit = 10) {
		this.size = 0;
		this.limit = limit;
		this.head = null;
		this.tail = null;
		this._cacheMap = new Map<string, LRUCacheNode<T>>();
	}

	/**
	 * Insert or update an entry. New / re-inserted entries become the head (most-recently-used).
	 *
	 * @param key - The cache key
	 * @param value - The value to store
	 */
	set(key: string, value: T): void {
		const existing = this._cacheMap.get(key);
		const node = new LRUCacheNode<T>(key, value);

		if (existing) {
			this.remove(existing);
		} else if (this.size >= this.limit && this.tail) {
			this.remove(this.tail);
		}

		if (!this.head) {
			this.head = this.tail = node;
		} else {
			node.next = this.head;
			this.head.prev = node;
			this.head = node;
		}

		this._cacheMap.set(node.key, node);
		this.size++;
	}

	/**
	 * Retrieve a value by key. The access promotes the entry to the head (most-recently-used).
	 *
	 * @param key - The cache key
	 * @returns The value if present, `undefined` if not
	 */
	get(key: string): T | undefined {
		const existing = this._cacheMap.get(key);

		if (!existing) {
			return undefined;
		}

		const value = existing.value;

		if (this.head !== existing) {
			// Promote to head by re-inserting.
			this.set(key, value);
		}

		return value;
	}

	/**
	 * Remove a specific node from the cache. O(1).
	 *
	 * @param node - The node to remove (typically obtained via the internal map or iteration)
	 */
	remove(node: LRUCacheNode<T>): void {
		if (node.prev) {
			node.prev.next = node.next;
		} else {
			this.head = node.next;
		}

		if (node.next) {
			node.next.prev = node.prev;
		} else {
			this.tail = node.prev;
		}

		node.prev = node.next = null;
		this._cacheMap.delete(node.key);
		this.size--;
	}

	/**
	 * Remove all entries.
	 */
	clear(): void {
		this.head = null;
		this.tail = null;
		this.size = 0;
		this._cacheMap.clear();
	}

	/**
	 * Invoke a callback for each entry, head (most-recent) to tail (least-recent).
	 *
	 * @param fn - Callback receiving (node, index)
	 */
	forEach(fn: (node: LRUCacheNode<T>, index: number) => void): void {
		let node = this.head;
		let counter = 0;

		while (node) {
			fn(node, counter);
			node = node.next;
			counter++;
		}
	}

	/**
	 * Iterate entries from head (most-recent) to tail (least-recent).
	 */
	*[Symbol.iterator](): IterableIterator<LRUCacheNode<T>> {
		let node = this.head;

		while (node) {
			yield node;
			node = node.next;
		}
	}
}
