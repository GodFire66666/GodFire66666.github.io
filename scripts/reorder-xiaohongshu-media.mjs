import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const orderedPath = process.argv[2];

if (!orderedPath) {
  throw new Error(
    "Usage: node scripts/reorder-xiaohongshu-media.mjs <ordered.json>",
  );
}

const archiveRoot = path.resolve("archive/xiaohongshu");
const current = JSON.parse(
  await readFile(path.join(archiveRoot, "manifest.json"), "utf8"),
);
const ordered = JSON.parse(await readFile(orderedPath, "utf8"));
const currentById = new Map(current.posts.map((post) => [post.id, post]));

const mediaKey = (url) =>
  (url.split("/").pop() || "").split("!")[0];
const pad = (value) => String(value).padStart(2, "0");

let reorderedPosts = 0;
let reorderedImages = 0;

for (const post of ordered.posts) {
  const existing = currentById.get(post.id);
  if (!existing || post.imageUrls.length < 2) continue;

  const before = existing.imageUrls.map(mediaKey);
  const after = post.imageUrls.map(mediaKey);
  if (before.join("|") === after.join("|")) continue;

  const sourceByKey = new Map();
  for (let index = 0; index < existing.imageUrls.length; index += 1) {
    const key = mediaKey(existing.imageUrls[index]);
    const relativePath = existing.localImages[index];
    if (!sourceByKey.has(key) && relativePath) {
      sourceByKey.set(key, path.join(archiveRoot, existing.folder, relativePath));
    }
  }

  const orderedFiles = await Promise.all(
    post.imageUrls.map(async (url) => {
      const source = sourceByKey.get(mediaKey(url));
      if (!source) throw new Error(`Missing source image for ${post.id}`);
      return {
        bytes: await readFile(source),
        extension: path.extname(source) || ".webp",
      };
    }),
  );

  for (let index = 0; index < orderedFiles.length; index += 1) {
    const destination = path.join(
      archiveRoot,
      existing.folder,
      "images",
      `${pad(index + 1)}${orderedFiles[index].extension}`,
    );
    await writeFile(destination, orderedFiles[index].bytes);
  }

  reorderedPosts += 1;
  reorderedImages += orderedFiles.length;
}

console.log(
  `Reordered ${reorderedImages} images across ${reorderedPosts} posts.`,
);
