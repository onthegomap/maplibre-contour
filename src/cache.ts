import { CancelablePromise } from "./types";

interface CacheItem<V> {
  lastUsed: number;
  waiting: number;
  cancel?: () => void;
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

  get = (key: K, supplier: (key: K) => Promise<V>): Promise<V> =>
    this.getCancelable(key, (key) => ({
      value: supplier(key),
      cancel: () => {},
    })).value;

  getCancelable = (
    key: K,
    supplier: (key: K) => CancelablePromise<V>,
  ): { value: Promise<V>; cancel: () => void } => {
    let result: CacheItem<V> | undefined = this.items.get(key);
    if (!result) {
      const value = supplier(key);
      result = {
        cancel: value.cancel,
        item: value.value,
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
    return {
      value,
      cancel: () => {
        if (result && result.cancel && !canceled) {
          canceled = true;
          if (--result.waiting <= 0) {
            result.cancel();
            items.delete(key);
          }
        }
      },
    };
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
