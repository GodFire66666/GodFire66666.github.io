import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const archiveRoot = path.resolve("archive/xiaohongshu");
const manifestPath = path.join(archiveRoot, "manifest.json");
const publicRoot = path.resolve("public/xiaohongshu");
const dataPath = path.resolve("src/data/xiaohongshu-public.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const publicPosts = manifest.posts.filter(
  (post) => post.visibility === "public",
);

const fallbackTitle = (post) => {
  if (post.originalTitle) return post.originalTitle;
  const firstLine = post.body
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine?.slice(0, 42) || "Untitled Note";
};

const copyMedia = async (post, relativePath) => {
  const source = path.join(archiveRoot, post.folder, relativePath);
  const destination = path.join(publicRoot, post.id, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return `/xiaohongshu/${post.id}/${relativePath}`;
};

const outputPosts = [];

for (const post of publicPosts) {
  const images = await Promise.all(
    post.localImages.map((image) => copyMedia(post, image)),
  );
  const videos = await Promise.all(
    (post.localVideos || []).map((video) => copyMedia(post, video)),
  );

  outputPosts.push({
    id: post.id,
    title: fallbackTitle(post),
    body: post.body,
    publishedAt: post.createdAt,
    displayDate: post.dateDisplay,
    source: post.canonicalUrl,
    mediaType: post.type,
    images,
    videos,
  });
}

outputPosts.sort(
  (a, b) =>
    new Date(b.publishedAt).valueOf() - new Date(a.publishedAt).valueOf(),
);

await mkdir(path.dirname(dataPath), { recursive: true });
await writeFile(dataPath, `${JSON.stringify(outputPosts, null, 2)}\n`, "utf8");

const privatePostCount = manifest.posts.filter(
  (post) => post.visibility === "private",
).length;
const imageCount = outputPosts.reduce(
  (total, post) => total + post.images.length,
  0,
);
const videoCount = outputPosts.reduce(
  (total, post) => total + post.videos.length,
  0,
);

console.log(
  `Prepared ${outputPosts.length} public posts (${imageCount} images, ${videoCount} videos). Excluded ${privatePostCount} private posts.`,
);
