/**
 * Tests for the doubly-linked-list + hashmap LRU cache — `LRUCache` + `LRUCacheNode`.
 *
 * @remarks
 * Covers the O(1) contract end to end: head insertion, MRU promotion on `get` and on
 * re-`set`, tail eviction at the limit, `remove` for head / tail / middle nodes, `clear`,
 * `forEach` indexing, and the head-to-tail iterator. Both branches of the `get` promotion
 * check (already-head vs not) and all three `remove` link-repair branches are exercised.
 */

import { describe, expect, it } from 'vitest';

import { LRUCache, LRUCacheNode } from './LRUCache.js';

/** Snapshot the cache's keys head → tail for order assertions. */
function keysHeadToTail<T>(cache: LRUCache<T>): string[] {
	return [...cache].map((node) => node.key);
}

describe('LRUCacheNode', () => {
	it('initializes with the given key/value and null links', () => {
		const node = new LRUCacheNode('k', 123);

		expect(node.key).toBe('k');
		expect(node.value).toBe(123);
		expect(node.next).toBeNull();
		expect(node.prev).toBeNull();
	});
});

describe('LRUCache', () => {
	it('defaults to a limit of 10', () => {
		expect(new LRUCache<number>().limit).toBe(10);
	});

	it('inserts new entries at the head (most-recently-used first)', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');

		expect(keysHeadToTail(cache)).toEqual(['b', 'a']);
		expect(cache.size).toBe(2);
	});

	it('seeds head and tail to the same node for the first entry', () => {
		const cache = new LRUCache<string>(2);

		cache.set('only', 'one');

		expect(cache.head).toBe(cache.tail);
		expect(cache.head?.key).toBe('only');
	});

	it('returns the value and promotes a non-head entry to the head on get', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');
		cache.set('c', 'cherry');

		expect(cache.get('a')).toBe('apple');
		// 'a' was the tail; reading it promotes it to head.
		expect(keysHeadToTail(cache)).toEqual(['a', 'c', 'b']);
	});

	it('leaves order unchanged when getting the current head', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');

		expect(cache.get('b')).toBe('banana');
		expect(keysHeadToTail(cache)).toEqual(['b', 'a']);
		expect(cache.size).toBe(2);
	});

	it('returns undefined for an absent key', () => {
		const cache = new LRUCache<string>(2);

		expect(cache.get('missing')).toBeUndefined();
	});

	it('evicts the least-recently-used (tail) entry when over the limit', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');
		cache.set('c', 'cherry');
		cache.set('d', 'date'); // exceeds limit → evicts 'a'

		expect(keysHeadToTail(cache)).toEqual(['d', 'c', 'b']);
		expect(cache.size).toBe(3);
		expect(cache.get('a')).toBeUndefined();
	});

	it('re-setting an existing key updates the value and promotes it to head', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');
		cache.set('a', 'apricot'); // existing key → remove + re-insert at head

		expect(cache.get('a')).toBe('apricot');
		expect(keysHeadToTail(cache)).toEqual(['a', 'b']);
		expect(cache.size).toBe(2);
	});

	it('removes a middle node, repairing both neighbor links', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');
		cache.set('c', 'cherry'); // order: c, b, a
		const middle = cache.head?.next;

		expect(middle?.key).toBe('b');
		cache.remove(middle as LRUCacheNode<string>);

		expect(keysHeadToTail(cache)).toEqual(['c', 'a']);
		expect(cache.size).toBe(2);
	});

	it('removes the head node, advancing head to the next entry', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana'); // order: b, a
		cache.remove(cache.head as LRUCacheNode<string>);

		expect(keysHeadToTail(cache)).toEqual(['a']);
		expect(cache.head?.key).toBe('a');
	});

	it('removes the tail node, retreating tail to the prior entry', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana'); // order: b, a — tail is 'a'
		cache.remove(cache.tail as LRUCacheNode<string>);

		expect(keysHeadToTail(cache)).toEqual(['b']);
		expect(cache.tail?.key).toBe('b');
	});

	it('removing the sole entry empties the cache (head and tail null)', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.remove(cache.head as LRUCacheNode<string>);

		expect(cache.size).toBe(0);
		expect(cache.head).toBeNull();
		expect(cache.tail).toBeNull();
	});

	it('clear() resets size, links, and the internal map', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');
		cache.clear();

		expect(cache.size).toBe(0);
		expect(cache.head).toBeNull();
		expect(cache.tail).toBeNull();
		expect(cache.get('a')).toBeUndefined();
		expect(keysHeadToTail(cache)).toEqual([]);
	});

	it('forEach visits entries head → tail with a running index', () => {
		const cache = new LRUCache<string>(3);

		cache.set('a', 'apple');
		cache.set('b', 'banana');
		cache.set('c', 'cherry'); // order: c, b, a
		const seen: [number, string, string][] = [];

		cache.forEach((node, index) => {
			seen.push([index, node.key, node.value]);
		});

		expect(seen).toEqual([
			[0, 'c', 'cherry'],
			[1, 'b', 'banana'],
			[2, 'a', 'apple'],
		]);
	});

	it('forEach on an empty cache invokes the callback zero times', () => {
		const cache = new LRUCache<string>(3);
		let calls = 0;

		cache.forEach(() => {
			calls++;
		});

		expect(calls).toBe(0);
	});

	it('is iterable from head (most-recent) to tail (least-recent)', () => {
		const cache = new LRUCache<number>(3);

		cache.set('a', 1);
		cache.set('b', 2);

		expect([...cache].map((node) => node.value)).toEqual([2, 1]);
	});
});
