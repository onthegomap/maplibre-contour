import { onAbort } from "./utils";

interface CacheItem<V> {
  lastUsed: number;
  waiting: number;
  abortController?: AbortController;
  item: Promise<V>;
}

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
    supplier: (key: K, abortController: AbortController) => Promise<V>,
    abortController: AbortController,
  ): Promise<V> => {
    let result: CacheItem<V> | undefined = this.items.get(key);
    if (!result) {
      const sharedAbortController = new AbortController();
      const value = supplier(key, sharedAbortController);
      result = {
        abortController: sharedAbortController,
        item: value,
        lastUsed: ++num,
        waiting: 1,
      };
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

  clear = () => this.items.clear();
}
