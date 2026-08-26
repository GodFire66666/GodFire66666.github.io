import data from "./xiaohongshu-public.json";

export interface XiaohongshuPost {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  displayDate: string;
  source: string;
  mediaType: string;
  images: string[];
  videos: string[];
}

export const xiaohongshuPosts = data as XiaohongshuPost[];

export function formatNoteDate(date: string, locale: "en" | "zh") {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-GB", {
    timeZone: "Asia/Shanghai",
    day: "numeric",
    month: locale === "zh" ? "long" : "short",
    year: "numeric",
  }).format(new Date(date));
}

export function noteExcerpt(post: XiaohongshuPost) {
  const text = post.body.replace(/\s+/g, " ").trim();
  if (text) return text.length > 92 ? `${text.slice(0, 92)}...` : text;
  if (post.mediaType === "video") return "A short video note.";
  return `${post.images.length} image${post.images.length === 1 ? "" : "s"}.`;
}
