import type { AnalysisMode, IndividualAnalysisTileOptions } from "../types";
import type { AnalysisScalarTile } from "./analysis-kernel";

type Color = [number, number, number, number];

type StepRamp = {
  type: "step";
  input: "slope" | "aspect" | "elevation";
  defaultColor: Color;
  stops: Array<{ value: number; color: Color }>;
};

type InterpolateRamp = {
  type: "interpolate";
  input: "slope" | "aspect" | "elevation";
  base: number;
  stops: Array<{ value: number; color: Color }>;
};

type ParsedRamp = StepRamp | InterpolateRamp;

const DEFAULT_SLOPE_EXPRESSION = [
  "step",
  ["slope"],
  "#ffffff",
  20, "#c0ffff",
  24, "#57ffff",
  28, "#00d3db",
  31, "#fffa32",
  34, "#ffc256",
  37, "#fd7100",
  40, "#ef0008",
  43, "#e958ff",
  46, "#a650ff",
  49, "#5e1eff",
  54, "#0000ff",
  59, "#919191",
];

const DEFAULT_ASPECT_EXPRESSION = [
  "interpolate",
  ["linear"],
  ["aspect"],
  0, "#ff0000",
  45, "#ffff00",
  135, "#00ff00",
  225, "#00ffff",
  315, "#0000ff",
];

export function colorizeAnalysisTile(
  scalarTile: AnalysisScalarTile,
  options: IndividualAnalysisTileOptions,
): Uint8Array {
  const ramp = parseRamp(options.ramp, options.mode);
  const out = new Uint8Array(scalarTile.width * scalarTile.height * 4);

  for (let i = 0; i < scalarTile.data.length; i++) {
    const color = evaluateRamp(ramp, scalarTile.data[i]);
    const alpha = clamp255(Math.round(color[3] * options.alpha));
    out[i * 4] = color[0];
    out[i * 4 + 1] = color[1];
    out[i * 4 + 2] = color[2];
    out[i * 4 + 3] = alpha;
  }

  return out;
}

export function parseRamp(
  ramp: string | undefined,
  mode: AnalysisMode,
): ParsedRamp {
  const expression = getRampExpression(ramp, mode);
  if (!Array.isArray(expression) || expression.length < 4) {
    throw new Error("Invalid ramp expression");
  }

  if (expression[0] === "step") {
    const input = parseInput(expression[1]);
    const defaultColor = parseCssColor(expression[2]);
    const stops: Array<{ value: number; color: Color }> = [];
    for (let i = 3; i + 1 < expression.length; i += 2) {
      stops.push({
        value: Number(expression[i]),
        color: parseCssColor(expression[i + 1]),
      });
    }
    return { type: "step", input, defaultColor, stops };
  }

  if (expression[0] === "interpolate") {
    const interpolation = expression[1];
    const input = parseInput(expression[2]);
    const base =
      Array.isArray(interpolation) && interpolation[0] === "exponential"
        ? Number(interpolation[1] ?? 1)
        : 1;
    const stops: Array<{ value: number; color: Color }> = [];
    for (let i = 3; i + 1 < expression.length; i += 2) {
      stops.push({
        value: Number(expression[i]),
        color: parseCssColor(expression[i + 1]),
      });
    }
    if (stops.length === 0) {
      throw new Error("Interpolate ramp requires at least one stop");
    }
    return { type: "interpolate", input, base, stops };
  }

  throw new Error("Ramp expression must be step or interpolate");
}

function evaluateRamp(ramp: ParsedRamp, value: number): Color {
  if (ramp.type === "step") {
    let color = ramp.defaultColor;
    for (const stop of ramp.stops) {
      if (value >= stop.value) color = stop.color;
      else break;
    }
    return color;
  }

  if (value <= ramp.stops[0].value) return ramp.stops[0].color;
  const last = ramp.stops[ramp.stops.length - 1];
  if (value >= last.value) return last.color;

  for (let i = 1; i < ramp.stops.length; i++) {
    const current = ramp.stops[i];
    const previous = ramp.stops[i - 1];
    if (value <= current.value) {
      const tLinear =
        (value - previous.value) / (current.value - previous.value);
      const t = ramp.base === 1 ? tLinear : Math.pow(tLinear, ramp.base);
      return mixColor(previous.color, current.color, t);
    }
  }

  return last.color;
}

function mixColor(a: Color, b: Color, t: number): Color {
  return [
    clamp255(Math.round(a[0] + (b[0] - a[0]) * t)),
    clamp255(Math.round(a[1] + (b[1] - a[1]) * t)),
    clamp255(Math.round(a[2] + (b[2] - a[2]) * t)),
    clamp255(Math.round(a[3] + (b[3] - a[3]) * t)),
  ];
}

function getRampExpression(
  ramp: string | undefined,
  mode: AnalysisMode,
): any[] {
  if (!ramp || ramp === "default") {
    return mode === "aspect"
      ? DEFAULT_ASPECT_EXPRESSION
      : DEFAULT_SLOPE_EXPRESSION;
  }
  if (ramp === "aspect") return DEFAULT_ASPECT_EXPRESSION;
  if (ramp === "slope") return DEFAULT_SLOPE_EXPRESSION;
  if (ramp.trim().startsWith("[")) {
    return JSON.parse(ramp);
  }
  throw new Error(`Unknown ramp: ${ramp}`);
}

function parseInput(input: unknown): "slope" | "aspect" | "elevation" {
  if (!Array.isArray(input) || input.length < 1) {
    throw new Error("Ramp input must be an expression");
  }
  const token = String(input[0]);
  if (token === "slope" || token === "aspect" || token === "elevation") {
    return token;
  }
  throw new Error(`Unsupported ramp input: ${token}`);
}

function parseCssColor(value: unknown): Color {
  const color = String(value).trim().toLowerCase();
  if (color === "transparent") return [0, 0, 0, 0];

  const named = NAMED_COLORS[color];
  if (named) return [...named] as Color;

  if (color.startsWith("#")) return parseHexColor(color);

  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    if (parts.length < 3) throw new Error(`Invalid rgb color: ${value}`);
    const r = clamp255(Number(parts[0]));
    const g = clamp255(Number(parts[1]));
    const b = clamp255(Number(parts[2]));
    const a =
      parts[3] == null ? 255 : clamp255(Math.round(Number(parts[3]) * 255));
    return [r, g, b, a];
  }

  throw new Error(`Unsupported color format: ${value}`);
}

function parseHexColor(hex: string): Color {
  if (hex.length === 4) {
    const r = parseInt(hex[1] + hex[1], 16);
    const g = parseInt(hex[2] + hex[2], 16);
    const b = parseInt(hex[3] + hex[3], 16);
    return [r, g, b, 255];
  }
  if (hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b, 255];
  }
  if (hex.length === 9) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = parseInt(hex.slice(7, 9), 16);
    return [r, g, b, a];
  }
  throw new Error(`Unsupported hex color: ${hex}`);
}

const NAMED_COLORS: Record<string, [number, number, number, number]> = {
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  red: [255, 0, 0, 255],
  green: [0, 128, 0, 255],
  blue: [0, 0, 255, 255],
  yellow: [255, 255, 0, 255],
  cyan: [0, 255, 255, 255],
  magenta: [255, 0, 255, 255],
  orange: [255, 165, 0, 255],
};

function clamp255(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}
