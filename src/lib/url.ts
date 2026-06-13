// base path（GitHub Pages の /wcup-tsuuka）を考慮した内部リンク生成。
// import.meta.env.BASE_URL は末尾に "/" を含むことがあるので正規化する。
const base = import.meta.env.BASE_URL.replace(/\/$/, "");

export function siteLink(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
