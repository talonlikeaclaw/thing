import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ACCENTS } from "@/lib/accent";

/*
 * The Night Glass ladder is the stylesheet's, not a second copy in TypeScript:
 * this test reads `globals.css`, parses the unlayered ladder and the hue table,
 * and measures the pairs the room relies on. Editing a hue or a lightness step
 * below 4.5:1 fails here, as does a token that takes the theme hue when it
 * should stay neutral.
 */

const CSS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "globals.css"),
  "utf8",
);

interface Rule {
  selector: string;
  light: boolean;
  decls: Record<string, string>;
}

function closeIndex(css: string, open: number): number {
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("unbalanced braces in globals.css");
}

function declarations(body: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const property = match[1];
    const value = match[2];
    if (property && value) decls[property] = value.trim();
  }
  return decls;
}

function parseRules(css: string): Rule[] {
  const rules: Rule[] = [];

  const walk = (text: string, light: boolean) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open < 0) return;
      let prelude = text.slice(index, open).trim();
      // An at-statement such as `@import "tailwindcss";` shares the prelude.
      const lastSemicolon = prelude.lastIndexOf(";");
      if (lastSemicolon >= 0) prelude = prelude.slice(lastSemicolon + 1).trim();
      const close = closeIndex(text, open);
      const body = text.slice(open + 1, close);
      if (prelude.startsWith("@")) {
        if (prelude.startsWith("@theme")) {
          rules.push({ selector: prelude, light, decls: declarations(body) });
        } else {
          walk(body, light || prelude.includes("prefers-color-scheme: light"));
        }
      } else {
        rules.push({
          selector: prelude.replace(/\s+/g, " "),
          light,
          decls: declarations(body),
        });
      }
      index = close + 1;
    }
  };

  walk(css.replace(/\/\*[\s\S]*?\*\//g, ""), false);
  return rules;
}

const RULES = parseRules(CSS);

/** The neutral roles the theme rotates; order is the ladder's order. */
const LADDER = [
  "--color-ground",
  "--color-ground-lift",
  "--color-inset",
  "--color-surface",
  "--color-raised",
  "--color-line",
  "--color-line-strong",
  "--color-line-interactive",
  "--color-ink",
  "--color-muted",
  "--color-faint",
  "--color-chrome-muted",
  "--color-chrome-faint",
  "--color-action-fallback",
  "--color-glass",
  "--color-glass-strong",
] as const;

type LadderToken = (typeof LADDER)[number];

interface Oklch {
  lightness: number;
  chroma: number;
  hue: number | "theme";
  alpha: number;
}

const OKLCH =
  /oklch\(\s*([\d.]+)\s+([\d.]+)\s+(var\(--theme-hue\)|[\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/;

function parseOklch(value: string): Oklch | null {
  const match = OKLCH.exec(value);
  if (!match) return null;
  const [, lightness, chroma, hue, alpha] = match;
  if (!lightness || !chroma || !hue) return null;
  return {
    lightness: Number(lightness),
    chroma: Number(chroma),
    hue: hue === "var(--theme-hue)" ? "theme" : Number(hue),
    alpha: alpha ? Number(alpha) : 1,
  };
}

function ruleFor(light: boolean, selector: string): Rule {
  const rule = RULES.find((entry) => entry.light === light && entry.selector === selector);
  if (!rule) throw new Error(`globals.css has no ${light ? "light" : "dark"} ${selector}`);
  return rule;
}

function hueFor(id: string, light: boolean): number {
  const value = ruleFor(light, `[data-accent="${id}"]`).decls["--theme-hue"];
  if (!value) throw new Error(`globals.css has no ${id} hue`);
  return Number(value);
}

function ladderFor(light: boolean): Record<LadderToken, Oklch> {
  const rule = RULES.find(
    (entry) =>
      entry.light === light &&
      entry.selector === ":root, [data-accent]" &&
      entry.decls["--color-ground"]?.includes("var(--theme-hue)"),
  );
  if (!rule) throw new Error("globals.css has no themed ladder");
  const ladder = {} as Record<LadderToken, Oklch>;
  for (const token of LADDER) {
    const value = rule.decls[token];
    if (!value) throw new Error(`the ladder has no ${token}`);
    const parsed = parseOklch(value);
    if (!parsed) throw new Error(`${token} is not an oklch() colour`);
    ladder[token] = parsed;
  }
  return ladder;
}

function tokensFor(light: boolean): Record<string, string> {
  const tokens = { ...ruleFor(false, "@theme static").decls };
  for (const rule of RULES) {
    if (rule.light === light && rule.selector.startsWith(":root")) {
      Object.assign(tokens, rule.decls);
    }
  }
  return tokens;
}

/** OKLCH → gamma-encoded sRGB, unclamped so the gamut test sees the truth. */
function oklchToSrgb({ lightness, chroma, hue }: Oklch, themeHue: number): [number, number, number] {
  const angle = (hue === "theme" ? themeHue : hue) * (Math.PI / 180);
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ] as const;
  const gamma = (channel: number) =>
    Math.sign(channel) * 1.055 * Math.abs(channel) ** (1 / 2.4) - 0.055;
  return [gamma(linear[0]), gamma(linear[1]), gamma(linear[2])];
}

function clamp(rgb: readonly [number, number, number]): [number, number, number] {
  return [rgb[0], rgb[1], rgb[2]].map((channel) =>
    Math.min(1, Math.max(0, channel)),
  ) as [number, number, number];
}

function hexToRgb(value: string): [number, number, number] {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function hexAlpha(value: string): number {
  const hex = value.replace("#", "");
  return hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
}

function over(
  foreground: readonly [number, number, number],
  alpha: number,
  background: readonly [number, number, number],
): [number, number, number] {
  const [foregroundR, foregroundG, foregroundB] = foreground;
  const [backgroundR, backgroundG, backgroundB] = background;
  return [
    foregroundR * alpha + backgroundR * (1 - alpha),
    foregroundG * alpha + backgroundG * (1 - alpha),
    foregroundB * alpha + backgroundB * (1 - alpha),
  ];
}

function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: readonly [number, number, number], b: readonly [number, number, number]) {
  const [high, low] = [luminance(a), luminance(b)].sort((left, right) => right - left) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

interface Theme {
  accent: string;
  scheme: "dark" | "light";
  light: boolean;
  hue: number;
  tokens: Record<string, string>;
  ladder: Record<LadderToken, Oklch>;
}

const THEMES: Theme[] = ACCENTS.flatMap(({ id }) =>
  (["dark", "light"] as const).map((scheme) => {
    const light = scheme === "light";
    return {
      accent: id,
      scheme,
      light,
      hue: hueFor(id, light),
      tokens: {
        ...tokensFor(light),
        ...ruleFor(light, `[data-accent="${id}"]`).decls,
      },
      ladder: ladderFor(light),
    };
  }),
);

function rgb(theme: Theme, token: LadderToken): [number, number, number] {
  return clamp(oklchToSrgb(theme.ladder[token], theme.hue));
}

function washOver(theme: Theme, token: LadderToken): [number, number, number] {
  const wash = theme.tokens["--color-accent-wash"] ?? "";
  return over(hexToRgb(wash), hexAlpha(wash), rgb(theme, token));
}

const SURFACES = [
  "--color-ground",
  "--color-ground-lift",
  "--color-inset",
  "--color-surface",
  "--color-raised",
] as const;

/** Pairs whose score must stay within a hair of the Lichen room. */
const NEUTRAL_PAIRS = [
  "faint on raised",
  "ink on glass",
  "muted on glass",
  "chrome-faint on glass-strong",
  "chrome-muted on glass over a white photo",
];

function measurements(theme: Theme): Map<string, number> {
  const values = new Map<string, number>();
  const ink = rgb(theme, "--color-ink");
  const faint = rgb(theme, "--color-faint");
  const muted = rgb(theme, "--color-muted");
  const chromeMuted = rgb(theme, "--color-chrome-muted");
  const chromeFaint = rgb(theme, "--color-chrome-faint");
  const glass = theme.ladder["--color-glass"];
  const glassStrong = theme.ladder["--color-glass-strong"];
  const lift = rgb(theme, "--color-ground-lift");
  const glassOverLift = over(rgb(theme, "--color-glass"), glass.alpha, lift);
  const glassStrongOverLift = over(rgb(theme, "--color-glass-strong"), glassStrong.alpha, lift);

  values.set("faint on raised", contrast(faint, rgb(theme, "--color-raised")));
  values.set("faint on inset", contrast(faint, rgb(theme, "--color-inset")));
  values.set("ink on glass", contrast(ink, glassOverLift));
  values.set("muted on glass", contrast(muted, glassOverLift));
  values.set(
    "chrome-faint on glass-strong",
    contrast(chromeFaint, glassStrongOverLift),
  );
  values.set(
    "chrome-muted on glass over a white photo",
    contrast(chromeMuted, over(rgb(theme, "--color-glass"), glass.alpha, [1, 1, 1])),
  );

  const accent = hexToRgb(theme.tokens["--color-accent"] ?? "");
  const accentInk = hexToRgb(theme.tokens["--color-accent-ink"] ?? "");
  const onWash = hexToRgb(theme.tokens["--color-accent-on-wash"] ?? "");
  values.set("accent on ink", contrast(accent, accentInk));
  values.set("accent on --color-ground", contrast(accent, rgb(theme, "--color-ground")));
  values.set("accent on --color-surface", contrast(accent, rgb(theme, "--color-surface")));
  for (const surface of SURFACES) {
    values.set(`on-wash on ${surface}`, contrast(onWash, washOver(theme, surface)));
    values.set(`ink on ${surface}'s wash`, contrast(ink, washOver(theme, surface)));
  }

  const danger = hexToRgb(theme.tokens["--color-danger"] ?? "");
  const warning = hexToRgb(theme.tokens["--color-warning"] ?? "");
  for (const surface of SURFACES) {
    values.set(`Ember on ${surface}`, contrast(danger, rgb(theme, surface)));
    values.set(`Amber on ${surface}`, contrast(warning, rgb(theme, surface)));
  }
  return values;
}

describe("the Night Glass ladder", () => {
  it("declares every role as oklch with the theme hue", () => {
    for (const light of [false, true]) {
      const rule = RULES.find(
        (entry) =>
          entry.light === light &&
          entry.selector === ":root, [data-accent]" &&
          entry.decls["--color-ground"]?.includes("var(--theme-hue)"),
      );
      expect(rule).toBeDefined();
      expect(Object.keys(rule?.decls ?? {})).toEqual(
        expect.arrayContaining(["--theme-hue", ...LADDER]),
      );
    }
  });

  it("keeps the pane wash neutral in every theme", () => {
    for (const light of [false, true]) {
      const wash = parseOklch(tokensFor(light)["--color-pane-wash"] ?? "");
      expect(wash).not.toBeNull();
      expect(wash?.chroma).toBe(0);
    }
  });

  it("pins Lichen to the shipped hues", () => {
    expect(hueFor("lichen", false)).toBe(150);
    expect(hueFor("lichen", true)).toBe(95);
  });

  it("gives every accent a hue in both schemes", () => {
    for (const { id } of ACCENTS) {
      for (const light of [false, true]) {
        const hue = hueFor(id, light);
        expect(Number.isFinite(hue)).toBe(true);
        expect(hue).toBeGreaterThanOrEqual(0);
        expect(hue).toBeLessThan(360);
      }
    }
  });
});

describe("theme contrast", () => {
  it("keeps every measured pair at or above 4.5:1", () => {
    for (const theme of THEMES) {
      for (const [pair, score] of measurements(theme)) {
        expect(score, `${theme.accent} ${theme.scheme}: ${pair}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the neutral room within 0.05 of the Lichen room", () => {
    for (const light of [false, true]) {
      const scheme = light ? "light" : "dark";
      const baseline = measurements(
        THEMES.find((theme) => theme.accent === "lichen" && theme.scheme === scheme) as Theme,
      );
      for (const theme of THEMES.filter((entry) => entry.scheme === scheme)) {
        const scores = measurements(theme);
        for (const pair of NEUTRAL_PAIRS) {
          const score = scores.get(pair) ?? 0;
          const lichen = baseline.get(pair) ?? 0;
          expect(score, `${theme.accent} ${scheme}: ${pair}`).toBeGreaterThanOrEqual(
            lichen - 0.05,
          );
        }
      }
    }
  });

  it("keeps every ladder colour inside sRGB at every hue", () => {
    for (const theme of THEMES) {
      for (const token of LADDER) {
        const [r, g, b] = oklchToSrgb(theme.ladder[token], theme.hue);
        for (const channel of [r, g, b]) {
          expect(channel, `${theme.accent} ${theme.scheme}: ${token}`).toBeGreaterThanOrEqual(
            -0.0001,
          );
          expect(channel, `${theme.accent} ${theme.scheme}: ${token}`).toBeLessThanOrEqual(
            1.0001,
          );
        }
      }
    }
  });

  it("only the ladder roles take the theme hue", () => {
    const themed = new Set<string>();
    for (const rule of RULES) {
      if (rule.selector.startsWith("@")) continue;
      for (const [property, value] of Object.entries(rule.decls)) {
        if (property !== "--theme-hue" && value.includes("var(--theme-hue)")) {
          themed.add(property);
        }
      }
    }
    expect([...themed].sort()).toEqual([...LADDER].sort());
  });

  it("keeps every accent wash under the 12% ceiling", () => {
    for (const theme of THEMES) {
      const wash = theme.tokens["--color-accent-wash"] ?? "";
      expect(hexAlpha(wash), `${theme.accent} ${theme.scheme}`).toBeLessThanOrEqual(0.12);
    }
  });
});
