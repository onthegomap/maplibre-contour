import type { Timing, TimingCategory } from "./types";

export const perf =
  typeof performance !== "undefined" ? performance : undefined;
export const timeOrigin = perf
  ? perf.timeOrigin || new Date().getTime() - perf.now()
  : new Date().getTime();
export function getResourceTiming(url: string): PerformanceResourceTiming[] {
  return JSON.parse(
    JSON.stringify(
      (perf?.getEntriesByName?.(url) as
        | PerformanceResourceTiming[]
        | undefined) || [],
    ),
  );
}
export function now(): number {
  return perf ? perf.now() : new Date().getTime();
}
function flatten<T>(input: T[][]): T[] {
  const result: T[] = [];
  for (const list of input) {
    result.push(...list);
  }
  return result;
}

/** Utility for tracking how long tiles take to generate, and where the time is going. */
export class Timer {
  marks: { [key in TimingCategory]?: number[][] } = {};
  urls: string[] = [];
  fetched: string[] = [];
  resources: PerformanceResourceTiming[] = [];
  markFinish: () => void;
  tilesFetched: number = 0;
  timeOrigin: number = timeOrigin;
  constructor(name: TimingCategory) {
    this.markFinish = this.marker(name);
  }
  finish = (url: string): Timing => {
    this.markFinish();
    const get = (type: TimingCategory): number | undefined => {
      const all = this.marks[type] || [];
      const max = Math.max(...all.map((ns) => Math.max(...ns)));
      const min = Math.min(...all.map((ns) => Math.min(...ns)));
      return Number.isFinite(max) ? max - min : undefined;
    };
    const duration = get("main") || 0;
    const fetch = get("fetch");
    const decode = get("decode");
    const process = get("isoline");
    return {
      url,
      tilesUsed: this.tilesFetched,
      origin: this.timeOrigin,
      marks: this.marks,
      resources: [
        ...this.resources,
        ...flatten(this.fetched.map(getResourceTiming)),
      ],
      duration,
      fetch,
      decode,
      process,
      wait: duration - (fetch || 0) - (decode || 0) - (process || 0),
    };
  };
  error = (url: string): Timing => ({ ...this.finish(url), error: true });
  marker = (category: TimingCategory): (() => void) => {
    if (!this.marks[category]) {
      this.marks[category] = [];
    }
    const marks = [now()];
    this.marks[category]?.push(marks);
    return () => marks.push(now());
  };
  useTile = (url: string): void => {
    if (this.urls.indexOf(url) < 0) {
      this.urls.push(url);
      this.tilesFetched++;
    }
  };
  fetchTile = (url: string): void => {
    if (this.fetched.indexOf(url) < 0) {
      this.fetched.push(url);
    }
  };
  addAll = (timings: Timing) => {
    this.tilesFetched += timings.tilesUsed;
    const offset = timings.origin - this.timeOrigin;
    for (const category in timings.marks) {
      const key = category as TimingCategory;
      const ourList = this.marks[key] || (this.marks[key] = []);
      ourList.push(
        ...(timings.marks[key]?.map((ns) => ns.map((n) => n + offset)) || []),
      );
    }
    this.resources.push(
      ...timings.resources.map((rt) => applyOffset(rt, offset)),
    );
  };
}

const startOrEnd = /(Start$|End$|^start|^end)/;
function applyOffset(obj: any, offset: number): PerformanceResourceTiming {
  const result: { [_: string]: number } = {};
  for (const key in obj) {
    if (obj[key] !== 0 && startOrEnd.test(key)) {
      result[key] = Number(obj[key]) + offset;
    } else {
      result[key] = obj[key];
    }
  }
  return result as any as PerformanceResourceTiming;
}
