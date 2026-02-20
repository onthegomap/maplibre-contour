import type {
  AnalysisMode,
  GlobalAnalysisTileOptions,
  IndividualAnalysisTileOptions,
} from "../types";

export function normalizeAnalysisOptions(
  options: GlobalAnalysisTileOptions,
): IndividualAnalysisTileOptions {
  const mode: AnalysisMode = options.mode === "aspect" ? "aspect" : "slope";
  const units = options.units === "percent" ? "percent" : "degrees";
  const alpha = clamp(Number(options.alpha ?? 1), 0, 1);
  const smooth = Boolean(options.smooth);
  const exaggerationRaw = Number(options.exaggeration);
  const exaggeration = Number.isFinite(exaggerationRaw)
    ? Math.max(0, exaggerationRaw)
    : 1;

  return {
    mode,
    units,
    alpha: quantize(alpha),
    smooth,
    exaggeration: quantize(exaggeration),
    ramp: options.ramp,
  };
}

export function encodeAnalysisOptions(
  options: GlobalAnalysisTileOptions,
): string {
  return Object.entries(normalizeAnalysisOptions(options))
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}

export function decodeAnalysisOptions(
  options: string,
): IndividualAnalysisTileOptions {
  const decoded = Object.fromEntries(
    options
      .replace(/^.*\?/, "")
      .split("&")
      .filter(Boolean)
      .map((part) => {
        const [keyRaw, valueRaw = ""] = part.split("=");
        const key = decodeURIComponent(
          keyRaw,
        ) as keyof GlobalAnalysisTileOptions;
        const value = decodeURIComponent(valueRaw);
        switch (key) {
          case "alpha":
          case "exaggeration":
            return [key, Number(value)];
          case "smooth":
            return [key, value === "true"];
          default:
            return [key, value];
        }
      }),
  ) as GlobalAnalysisTileOptions;

  return normalizeAnalysisOptions(decoded);
}

export function encodeIndividualAnalysisOptions(
  options: IndividualAnalysisTileOptions,
): string {
  return Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join(",");
}

function quantize(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
