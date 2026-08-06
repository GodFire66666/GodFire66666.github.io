import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { SITE } from "../config";
import { sortPosts } from "../utils/posts";

export async function GET(context) {
  const posts = sortPosts(
    (await getCollection("posts")).filter((post) => !post.data.draft),
  );

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.published,
      link: `/posts/${post.id}/`,
    })),
  });
}
