import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = process.argv[2];
const targetRoot = path.resolve(process.argv[3] || "archive/xiaohongshu");

if (!sourcePath) {
  throw new Error(
    "Usage: node scripts/archive-xiaohongshu.mjs <scraped.json> [target]",
  );
}

const archive = JSON.parse(await readFile(sourcePath, "utf8"));
const posts = archive.posts || [];

const quote = (value) => JSON.stringify(String(value ?? ""));
const pad = (value, size = 2) => String(value).padStart(size, "0");
const localDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

const imageExtension = (contentType) => {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("avif")) return "avif";
  return "webp";
};

const exists = async (filePath) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const downloadWaiters = [];
let activeDownloads = 0;

const acquireDownloadSlot = async () => {
  if (activeDownloads < 8) {
    activeDownloads += 1;
    return;
  }
  await new Promise((resolve) => downloadWaiters.push(resolve));
  activeDownloads += 1;
};

const releaseDownloadSlot = () => {
  activeDownloads -= 1;
  downloadWaiters.shift()?.();
};

const downloadImage = async (url, destinationBase) => {
  for (const extension of ["webp", "jpg", "png", "avif"]) {
    const existing = `${destinationBase}.${extension}`;
    if (await exists(existing)) return path.basename(existing);
  }

  await acquireDownloadSlot();
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: {
            Referer: "https://www.xiaohongshu.com/",
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139 Safari/537.36",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const contentType =
          response.headers.get("content-type") || "image/webp";
        const extension = imageExtension(contentType);
        const destination = `${destinationBase}.${extension}`;

        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 100) throw new Error("Downloaded image is empty");
        await writeFile(destination, bytes);

        return path.basename(destination);
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  } finally {
    releaseDownloadSlot();
  }
};

await mkdir(targetRoot, { recursive: true });

const manifestPosts = [];
const failures = [];
let completedPosts = 0;

await Promise.all(posts.map(async (post) => {
  const day = localDate(post.createdAt);
  const folderName = `${day}-${pad(post.index, 3)}-${post.id}`;
  const postDir = path.join(targetRoot, folderName);
  const imagesDir = path.join(postDir, "images");
  await mkdir(imagesDir, { recursive: true });

  const imageResults = await Promise.all(
    post.imageUrls.map(async (url, index) => {
      const destinationBase = path.join(imagesDir, pad(index + 1));
      try {
        const filename = await downloadImage(url, destinationBase);
        return `images/${filename}`;
      } catch (error) {
        failures.push({
          postId: post.id,
          image: index + 1,
          url,
          error: String(error),
        });
        return null;
      }
    }),
  );
  const localImages = imageResults.filter(Boolean);
  const localVideos = [];
  const videoPath = path.join(postDir, "media", "video.mp4");
  if (await exists(videoPath)) localVideos.push("media/video.mp4");

  const title = post.originalTitle || post.title;
  const body = post.body ? `${post.body}\n\n` : "";
  const imageMarkdown = localImages
    .map((image, index) => `![${title || "Untitled"} - ${index + 1}](${image})`)
    .join("\n\n");
  const videoMarkdown = localVideos
    .map((video) => `<video controls preload="metadata" src="${video}"></video>`)
    .join("\n\n");
  const mediaMarkdown = [imageMarkdown, videoMarkdown].filter(Boolean).join("\n\n");
  const markdown = `---
title: ${quote(title || "Untitled")}
xiaohongshu_id: ${quote(post.id)}
author: ${quote(post.author)}
published_at: ${quote(post.createdAt)}
display_date: ${quote(post.dateDisplay)}
visibility: ${quote(post.visibility)}
source: ${quote(post.canonicalUrl)}
media_type: ${quote(post.type)}
image_count: ${localImages.length}
video_count: ${localVideos.length}
---

${body}${mediaMarkdown}${mediaMarkdown ? "\n\n" : ""}[View the original post on Xiaohongshu](${post.canonicalUrl})
`;

  await writeFile(path.join(postDir, "index.md"), markdown, "utf8");
  manifestPosts.push({
    ...post,
    folder: folderName,
    localImages,
    localVideos,
  });

  completedPosts += 1;
  process.stdout.write(
    `\rArchived ${pad(completedPosts, 2)}/${pad(posts.length, 2)} posts`,
  );
}));
manifestPosts.sort((a, b) => a.index - b.index);

const manifest = {
  ...archive,
  posts: manifestPosts,
  failures,
};
await writeFile(
  path.join(targetRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const rows = manifestPosts
  .map(
    (post) =>
      `| ${post.index} | ${localDate(post.createdAt)} | ${post.visibility} | [${(post.originalTitle || "Untitled").replaceAll("|", "\\|")}](${post.folder}/index.md) | ${post.localImages.length} |`,
  )
  .join("\n");
const readme = `# Xiaohongshu archive

Local migration archive for **${archive.profile.displayName}** (${archive.profile.xiaohongshuId}). These files are not part of the Astro content collection and are not published by the blog.

- Posts: ${manifestPosts.length}
- Public: ${manifestPosts.filter((post) => post.visibility === "public").length}
- Private: ${manifestPosts.filter((post) => post.visibility === "private").length}
- Images: ${manifestPosts.reduce((sum, post) => sum + post.localImages.length, 0)}
- Videos: ${manifestPosts.reduce((sum, post) => sum + post.localVideos.length, 0)}
- Download failures: ${failures.length}
- Exported: ${archive.exportedAt}

| # | Date | Visibility | Post | Images |
| ---: | --- | --- | --- | ---: |
${rows}
`;
await writeFile(path.join(targetRoot, "README.md"), readme, "utf8");

process.stdout.write(
  `\nDone: ${manifestPosts.length} posts, ${manifestPosts.reduce((sum, post) => sum + post.localImages.length, 0)} images, ${manifestPosts.reduce((sum, post) => sum + post.localVideos.length, 0)} videos, ${failures.length} failures.\n`,
);
