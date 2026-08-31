import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const updateRoot = path.resolve(process.argv[2] || "");
const archiveRoot = path.resolve(process.argv[3] || "archive/xiaohongshu");

if (!process.argv[2]) {
  throw new Error(
    "Usage: node scripts/merge-xiaohongshu-update.mjs <update-archive> [archive]",
  );
}

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));
const exists = async (filePath) => {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
};

const mainManifestPath = path.join(archiveRoot, "manifest.json");
const updateManifestPath = path.join(updateRoot, "manifest.json");
const [mainManifest, updateManifest] = await Promise.all([
  readJson(mainManifestPath),
  readJson(updateManifestPath),
]);

const knownIds = new Set(mainManifest.posts.map((post) => post.id));
const newPosts = updateManifest.posts.filter((post) => !knownIds.has(post.id));

if (newPosts.length === 0) {
  console.log("No new Xiaohongshu posts to merge.");
  process.exit(0);
}

newPosts.sort(
  (a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf(),
);

for (const [index, post] of newPosts.entries()) {
  const source = path.join(updateRoot, post.folder);
  const destination = path.join(archiveRoot, post.folder);
  if (await exists(destination)) {
    throw new Error(`Archive folder already exists: ${post.folder}`);
  }
  await cp(source, destination, { recursive: true });
  post.index = index + 1;
}

const shiftedPosts = mainManifest.posts.map((post) => ({
  ...post,
  index: post.index + newPosts.length,
}));
const posts = [...newPosts, ...shiftedPosts];
const failures = [
  ...(mainManifest.failures || []),
  ...(updateManifest.failures || []),
];
const mergedManifest = {
  ...mainManifest,
  exportedAt: updateManifest.exportedAt,
  posts,
  failures,
};

await writeFile(
  mainManifestPath,
  `${JSON.stringify(mergedManifest, null, 2)}\n`,
  "utf8",
);

const localDate = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
const rows = posts
  .map(
    (post) =>
      `| ${post.index} | ${localDate(post.createdAt)} | ${post.visibility} | [${(post.originalTitle || "Untitled").replaceAll("|", "\\|")}](${post.folder}/index.md) | ${post.localImages.length} |`,
  )
  .join("\n");
const readme = `# Xiaohongshu archive

Local migration archive for **${mergedManifest.profile.displayName}** (${mergedManifest.profile.xiaohongshuId}). These files are not part of the Astro content collection and are not published by the blog.

- Posts: ${posts.length}
- Public: ${posts.filter((post) => post.visibility === "public").length}
- Private: ${posts.filter((post) => post.visibility === "private").length}
- Images: ${posts.reduce((sum, post) => sum + post.localImages.length, 0)}
- Videos: ${posts.reduce((sum, post) => sum + (post.localVideos || []).length, 0)}
- Download failures: ${failures.length}
- Exported: ${mergedManifest.exportedAt}

| # | Date | Visibility | Post | Images |
| ---: | --- | --- | --- | ---: |
${rows}
`;
await writeFile(path.join(archiveRoot, "README.md"), readme, "utf8");

console.log(
  `Merged ${newPosts.length} new posts. Archive now contains ${posts.length} posts.`,
);
