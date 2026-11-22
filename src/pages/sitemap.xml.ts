// サイトマップ（/wcup-tsuuka/sitemap.xml）。載せるのは事前描画した検索向けページだけ（sitePages() と同じ一覧）。
// lastmod は付けない（データ更新日とページの更新日が一致しないので、不正確な値を出さない）。
import type { APIRoute } from "astro";
import { sitePages } from "../app/data";
import { siteLink } from "../lib/url";

export const GET: APIRoute = () => {
  const locs = sitePages().map((p) => new URL(siteLink(`/${p.path}`), import.meta.env.SITE).toString());
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    locs.map((loc) => `  <url><loc>${loc}</loc></url>\n`).join("") +
    `</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
