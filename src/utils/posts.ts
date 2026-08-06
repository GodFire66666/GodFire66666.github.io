import type { CollectionEntry } from "astro:content";

export function sortPosts(posts: CollectionEntry<"posts">[]) {
  return posts.sort(
    (a, b) => b.data.published.valueOf() - a.data.published.valueOf(),
  );
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function tagPath(tag: string) {
  return `/tags/${encodeURIComponent(tag)}/`;
}
