import { onAbort } from "./utils";

interface CacheItem<V> {
  lastUsed: number;
  waiting: number;
  abortController?: AbortController;
  item: Promise<V>;
  /** When the value stops being fresh (ms since the epoch), once the supplier says; never when unset */
  expires?: number;
}

/** Called by a supplier to say until when its value may be reused (ms since the epoch), or never past now */
export type Expire = (at: number | undefined) => void;

let num = 0;

/**
 * LRU Cache for CancelablePromises.
 * The underlying request is only canceled when all callers have canceled their usage of it.
 */
export default class AsyncCache<K, V> {
  maxSize: number;
  items: Map<K, CacheItem<V>>;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
    this.items = new Map<K, CacheItem<V>>();
  }

  size = () => this.items.size;

  get = (
    key: K,
    supplier: (
      key: K,
      abortController: AbortController,
      expire: Expire,
    ) => Promise<V>,
    abortController: AbortController,
  ): Promise<V> => {
    let result: CacheItem<V> | undefined = this.items.get(key);
    if (result?.expires !== undefined && result.expires <= Date.now()) {
      // stale: asked for again (whoever still waits on it keeps the old one)
      this.items.delete(key);
      result = undefined;
    }
    if (!result) {
      const sharedAbortController = new AbortController();
      const item = {
        abortController: sharedAbortController,
        lastUsed: ++num,
        waiting: 1,
      } as CacheItem<V>;
      // the supplier sets the item's expiry once it has its value
      item.item = supplier(key, sharedAbortController, (at) => {
        item.expires = at;
      });
      result = item;
      this.items.set(key, result);
      this.prune();
    } else {
      result.lastUsed = ++num;
      result.waiting++;
    }
    const items = this.items;
    const value = result.item.then(
      (r) => r,
      (e) => {
        items.delete(key);
        return Promise.reject(e);
      },
    );
    let canceled = false;
    onAbort(abortController, () => {
      if (result && result.abortController && !canceled) {
        canceled = true;
        if (--result.waiting <= 0) {
          result.abortController?.abort();
          items.delete(key);
        }
      }
    });
    return value;
  };

  prune() {
    if (this.items.size > this.maxSize) {
      let minKey: K | undefined;
      let minUse = Infinity;
      this.items.forEach((value, key) => {
        if (value.lastUsed < minUse) {
          minUse = value.lastUsed;
          minKey = key;
        }
      });
      if (typeof minKey !== "undefined") {
        this.items.delete(minKey);
      }
    }
  }

  /** When the value under key stops being fresh (ms since the epoch); undefined if never, or not there */
  expiresAt = (key: K): number | undefined => this.items.get(key)?.expires;

  clear = () => this.items.clear();
}
