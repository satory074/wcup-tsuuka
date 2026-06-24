// タイムライン折れ線の「各国の色」を国旗の色から計算して決定する純TSモジュール。
// DOM・Date・乱数に触れない＝決定的（同入力→同出力。smoketest が担保）。
// 表示の関心事なので engine ではなく app/ に置く（唯一の呼び出し元 render.ts の隣）。
//
// 中心的アンチパターン: 国旗は赤/白/青を極端に共有するため、旗色をそのまま線色にすると
// 同一グループ内の4本が見分け不能になりやすい（チャート本来の目的＝順位推移の追跡が壊れる）。
// → 旗色を基調にしつつ、同グループ内で知覚色差(ΔE)が近すぎる場合は段階的に色をずらし、
//   最終フォールバックは色覚配慮の Okabe-Ito パレットへ退避して4本の判別可能性を必ず確保する。
//
// 参考（ベストプラクティス）: Okabe-Ito カラーブラインド対応パレット / Claus Wilke
// "Fundamentals of Data Visualization"（color pitfalls）/ Datawrapper・Flourish の配色ガイド。

/** team id（小文字FIFAトリコード）→ 旗の主要色 HEX の順序付き配列（識別性の高い順）。 */
export type FlagPalette = Record<string, readonly string[]>;

interface Rgb {
  r: number;
  g: number;
  b: number;
}
interface Lab {
  L: number;
  a: number;
  b: number;
}
interface Hsl {
  h: number;
  s: number;
  l: number;
}

// 衝突時の最終フォールバック＝Okabe-Ito 由来のカラーブラインド対応6色（互いに ΔE が大きく必ず判別可）。
const OKABE_ITO = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9"];
// CIE76 ΔE（Lab ユークリッド）がこれ未満＝「近すぎ」とみなす（4本チャートに十分な分離閾値）。
export const DELTA_MIN = 22;
// 白地で淡すぎる線を避ける WCAG 相対輝度の上限（白=1.0・明るい黄が境界）。
export const LUM_MAX = 0.74;
// 暗地で黒すぎる/沈む線を避ける下限。多くの国旗の濃紺(#00247d 等)はこれ未満なので、
// 弾かず clampToGuard で「視認できる青」へ持ち上げる（識別色＝紺を捨てず明度だけ上げる）。
export const LUM_MIN = 0.12;

const clamp255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to2 = (n: number): string => clamp255(n).toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

const srgbToLinear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

/** WCAG 相対輝度（0..1）。明度ガード用。 */
export function relLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** sRGB → 線形 → XYZ(D65) → CIELAB。色差計算用。 */
export function rgbToLab({ r, g, b }: Rgb): Lab {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 色差（Lab ユークリッド距離）。署名を保てば後で CIEDE2000 に差し替え可能。 */
export function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = ((((h % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

const labOf = (hex: string): Lab => rgbToLab(hexToRgb(hex));
const lumOf = (hex: string): number => relLuminance(hexToRgb(hex));
const guardOk = (hex: string): boolean => {
  const l = lumOf(hex);
  return l >= LUM_MIN && l <= LUM_MAX;
};
const collides = (hex: string, usedLabs: Lab[]): boolean => {
  const lab = labOf(hex);
  return usedLabs.some((u) => deltaE(lab, u) < DELTA_MIN);
};

// 明度ガード外の色（白/黒に近い）を、HSL の明度を固定刻みで動かしてガード内へ寄せる（決定的・有界）。
function clampToGuard(hex: string): string {
  const base = rgbToHsl(hexToRgb(hex));
  let l = base.l;
  for (let i = 0; i < 24; i++) {
    const cand = rgbToHex(hslToRgb({ h: base.h, s: base.s, l }));
    if (guardOk(cand)) return cand;
    l = lumOf(cand) > LUM_MAX ? clamp01(l - 0.05) : clamp01(l + 0.05);
  }
  return rgbToHex(hslToRgb({ h: base.h, s: base.s, l }));
}

// 主色を固定手順で色相・明度ずらしし、ガードを通り非衝突になる最初の色を返す（無ければ ""）。
function nudge(hex: string, usedLabs: Lab[]): string {
  const base = rgbToHsl(hexToRgb(hex));
  const steps: Array<{ dh: number; dl: number }> = [
    { dh: 18, dl: 0 },
    { dh: -18, dl: 0 },
    { dh: 36, dl: 0 },
    { dh: -36, dl: 0 },
    { dh: 0, dl: -0.12 },
    { dh: 0, dl: 0.12 },
    { dh: 18, dl: -0.12 },
    { dh: -18, dl: 0.12 },
    { dh: 54, dl: 0 },
    { dh: -54, dl: 0 },
    { dh: 36, dl: -0.12 },
    { dh: -36, dl: 0.12 },
  ];
  for (const { dh, dl } of steps) {
    const cand = rgbToHex(hslToRgb({ h: base.h + dh, s: base.s, l: clamp01(base.l + dl) }));
    if (guardOk(cand) && !collides(cand, usedLabs)) return cand;
  }
  return "";
}

/**
 * 1グループの各チームに判別可能な線色を割り当てる（colorOf の差し替え）。
 * @param orderedIds 最終順位順のチーム id（render.ts の finalOrder）
 * @param palette    旗色パレット（flag-colors.json）
 * @returns Map<teamId, "#rrggbb">
 */
export function assignGroupColors(orderedIds: string[], palette: FlagPalette): Map<string, string> {
  const assigned = new Map<string, string>();
  const usedLabs: Lab[] = [];
  const okabeQueue = [...OKABE_ITO];

  for (const id of orderedIds) {
    const cands = palette[id] ?? [];
    // 1) 主色＝旗の識別色（先頭）。暗すぎ/淡すぎならガード内へ明度クランプして識別色の色相を保つ
    //    （別の旗色へ飛ばさない＝紺の国は紺、緑の国は緑のまま視認可能にする）。
    const base = cands.length ? cands[0] : "#888888";
    const primary = guardOk(base) ? base : clampToGuard(base);
    let pick = primary;

    // 2) 同グループ衝突回避
    if (collides(pick, usedLabs)) {
      // (a) 他の旗色でガードOK＆非衝突
      const alt = cands.find((c) => guardOk(c) && !collides(c, usedLabs));
      if (alt) {
        pick = alt;
      } else {
        // (b) 主色の決定的ニュッジ
        const nudged = nudge(primary, usedLabs);
        if (nudged) {
          pick = nudged;
        } else {
          // (c) 未使用の非衝突 Okabe-Ito スロット（必ず判別可能）
          pick = okabeQueue.find((c) => !collides(c, usedLabs)) ?? okabeQueue[0] ?? primary;
        }
      }
    }

    assigned.set(id, pick);
    usedLabs.push(labOf(pick));
    const qi = okabeQueue.indexOf(pick);
    if (qi >= 0) okabeQueue.splice(qi, 1);
  }
  return assigned;
}
