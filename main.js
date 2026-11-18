
 // generate-readme.js — run with: bun generate-readme.js

import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const API = process.env.PROJECTS_API ||
  "https://projects.warze.org/api/projects?match=any&sort=created&order=desc";

const OUT = process.env.OUTPUT_FILE || "README.md";

const CARD_WIDTH = 240;
const CARD_HEIGHT = 226;

const THUMB_WIDTH = 220;
const THUMB_HEIGHT = 140;

const OUTPUT_DIR = dirname(resolve(OUT));
const ASSET_DIR = resolve(OUTPUT_DIR, "assets");

const LANG_COLORS = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Java: "#b07219",
  Python: "#3572A5",
  Vue: "#41b883",
  React: "#61dafb",
  "Discord.js": "#5865F2",
  PixiJS: "#e91e63",
  "THREE.js": "#049ef4",
  JSON: "#292929",
  SQL: "#e38c00",
  SQLite: "#003b57",
  Ollama: "#ffffff",
  AI: "#8a2be2",
  TailwindCSS: "#38bdf8",
  default: "#8b949e",
};

const LANG_PRIORITY = {
  TypeScript: 100,
  JavaScript: 95,
  Java: 90,
  Python: 90,
  Vue: 85,
  React: 80,
  "Discord.js": 80,
  "THREE.js": 78,
  PixiJS: 78,
  TailwindCSS: 70,
  SQLite: 68,
  SQL: 65,
  HTML: 60,
  CSS: 55,
  JSON: 20,
  AI: 15,
  Ollama: 10,
};

// ---------- helpers ----------

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol)
      ? url
      : null;
  } catch {
    return null;
  }
}

function absUrl(path) {
  if (!path) return null;

  if (/^https?:\/\//i.test(path)) {
    return safeUrl(path);
  }

  return safeUrl(
    "https://projects.warze.org/" + path.replace(/^\//, "")
  );
}

function primaryLanguage(languages = []) {
  if (!languages.length) return null;

  return [...languages].sort(
    (a, b) => (LANG_PRIORITY[b] ?? 40) - (LANG_PRIORITY[a] ?? 40)
  )[0];
}

function parseGithub(url) {
  if (!url) return null;

  const match = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);

  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ""),
  };
}

function slugify(value) {
  return String(value || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "project";
}

function truncate(value, max) {
  const text = String(value || "").trim();

  return text.length > max
    ? text.slice(0, max - 3).trimEnd() + "..."
    : text;
}

function wrapText(value, maxChars, maxLines = 3) {
  const words = String(value || "").trim().split(/\s+/);
  const lines = [];
  let current = "";
  let overflow = false;

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;

      if (lines.length === maxLines) {
        overflow = true;
        break;
      }
    } else {
      current = next;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  } else if (current) {
    overflow = true;
  }

  if (overflow && lines.length) {
    lines[lines.length - 1] =
      truncate(lines[lines.length - 1], maxChars - 3) + "...";
  }

  return lines;
}

// ---------- asset downloading ----------

function extensionFromResponse(response, url) {
  const contentType = response.headers
    .get("content-type")
    ?.split(";")[0]
    .trim();

  const mimeExtensions = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
    "image/x-icon": ".ico",
  };

  if (mimeExtensions[contentType]) {
    return mimeExtensions[contentType];
  }

  try {
    const ext = new URL(url).pathname.match(
      /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i
    )?.[0];

    if (ext) return ext.toLowerCase();
  } catch {}

  return ".png";
}

const downloadedAssets = new Map();

async function downloadAsset(url, filename) {
  url = safeUrl(url);

  if (!url) return null;

  if (downloadedAssets.has(url)) {
    return downloadedAssets.get(url);
  }

  const promise = (async () => {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Warze-README-Generator/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";

      if (!contentType.startsWith("image/")) {
        throw new Error(`Not an image: ${contentType}`);
      }

      const extension = extensionFromResponse(response, url);
      const assetName = `${filename}${extension}`;

      await Bun.write(
        resolve(ASSET_DIR, assetName),
        new Uint8Array(await response.arrayBuffer())
      );

      console.log(`Downloaded ${assetName}`);

      return assetName;
    } catch (error) {
      console.warn(`Failed to download ${url}: ${error.message}`);
      return null;
    }
  })();

  downloadedAssets.set(url, promise);

  return promise;
}

// ---------- SVG generation ----------

function renderSVG(project, thumbnailFile, iconFile) {
  const title = truncate(project.title || "Untitled project", 34);
  const description = project.description || "";

  const language = primaryLanguage(project.languages || []);
  const languageColor = LANG_COLORS[language] || LANG_COLORS.default;

  const github = parseGithub(project.github_link || project.link);

  const descriptionLines = wrapText(description, 43, 3);

  const thumbnailBlock = thumbnailFile
    ? `
      <rect
        x="12" y="12"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        rx="6"
        fill="#161b22"
      />

      <image
        href="./${esc(thumbnailFile)}"
        x="12"
        y="12"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        preserveAspectRatio="xMidYMid meet"
        clip-path="url(#thumbClip)"
      />
    `
    : `
      <rect
        x="12" y="12"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        rx="6"
        fill="#161b22"
      />

      <text
        x="${CARD_WIDTH / 2}"
        y="78"
        fill="#8b949e"
        font-size="12"
        text-anchor="middle"
      >No preview available</text>
    `;

  const iconBlock = iconFile
    ? `
      <image
        href="./${esc(iconFile)}"
        x="16"
        y="164"
        width="20"
        height="20"
        preserveAspectRatio="xMidYMid meet"
      />
    `
    : "";

  const titleX = iconFile ? 44 : 16;

  const descriptionBlock = descriptionLines
    .map((line, index) => `
      <text
        x="16"
        y="${201 + index * 16}"
        fill="#8b949e"
        font-size="11"
      >${esc(line)}</text>
    `)
    .join("");

  const languageBlock = language
    ? `
      <circle cx="21" cy="258" r="4" fill="${languageColor}"/>
      <text
        x="31"
        y="262"
        fill="#8b949e"
        font-size="10"
      >${esc(language)}</text>
    `
    : "";

  const repoText = github
    ? `${github.owner}/${github.repo}`
    : "";

  const repoBlock = repoText
    ? `
      <text
        x="304"
        y="262"
        text-anchor="end"
        fill="#6e7681"
        font-size="9"
      >${esc(truncate(repoText, 35))}</text>
    `
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  width="${CARD_WIDTH}"
  height="${CARD_HEIGHT}"
  viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"
  fill="none"
>
  <defs>
    <clipPath id="thumbClip">
      <rect
        x="12"
        y="12"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        rx="6"
      />
    </clipPath>
  </defs>

  <rect
    x="0.5"
    y="0.5"
    width="${CARD_WIDTH - 1}"
    height="${CARD_HEIGHT - 1}"
    rx="9"
    fill="#0d1117"
    stroke="#30363d"
  />

  ${thumbnailBlock}

  ${iconBlock}

  <text
    x="${titleX}"
    y="179"
    fill="#e6edf3"
    font-size="14"
    font-weight="600"
  >${esc(title)}</text>

  ${descriptionBlock}

  <path
    d="M12 246 H308"
    stroke="#30363d"
    stroke-width="1"
  />

  ${languageBlock}
  ${repoBlock}
</svg>`;
}

// ---------- card generation ----------

async function generateCards(projects) {
  await mkdir(ASSET_DIR, { recursive: true });

  const existing = await readdir(ASSET_DIR);

  for (const file of existing) {
    if (
      /^project-card-.*\.svg$/.test(file) ||
      /^project-asset-/.test(file)
    ) {
      await unlink(resolve(ASSET_DIR, file));
    }
  }

  downloadedAssets.clear();

  const cards = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];

    const prefix = `project-${slugify(project.title)}-${i + 1}`;

    const thumbnailUrl = absUrl(project.thumbnail);
    const iconUrl = absUrl(project.icon);

    const [thumbnailFile, iconFile] = await Promise.all([
      downloadAsset(thumbnailUrl, `project-asset-${prefix}-thumbnail`),
      downloadAsset(iconUrl, `project-asset-${prefix}-icon`),
    ]);

    const svgFile = `project-card-${prefix}.svg`;

    await Bun.write(
      resolve(ASSET_DIR, svgFile),
      renderSVG(project, thumbnailFile, iconFile)
    );

    cards.push({
      project,
      filename: svgFile,
    });

    console.log(`Generated ${svgFile}`);
  }

  return cards;
}

// ---------- README generation ----------


function renderSection(title, projects) {
  if (!projects.length) return "";

  const rows = [];

  for (let i = 0; i < projects.length; i += 3) {
    const a = projects[i];
    const b = projects[i + 1];
    const c = projects[i + 2];

    const renderImage = (card) => {
      if (!card) return "&nbsp;";

      const link = safeUrl(
        card.project.link || card.project.github_link
      );

      const image = `<img src="./assets/${card.filename}" width="${CARD_WIDTH}" alt="${esc(card.project.title)}" />`;

      return link
        ? `<a href="${esc(link)}">${image}</a>`
        : image;
    };

    rows.push(`
<tr>
  <td width="250" valign="top" align="center">
    ${renderImage(a)}
  </td>
  <td width="250" valign="top" align="center">
    ${renderImage(b)}
  </td>
  <td width="250" valign="top" align="center">
    ${renderImage(c)}
  </td>
</tr>`);
  }

  return `## ${title}

<table cellspacing="0" cellpadding="3" width="759">
${rows.join("\n")}
</table>`;
}


// ---------- main ----------

async function main() {
  const response = await fetch(API);

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  const json = await response.json();
  const projects = json.data ?? [];

  const groups = {
    game: [],
    website: [],
    discord_bot: [],
  };

  for (const project of projects) {
    (groups[project.type] ??= []).push(project);
  }

  for (const key of Object.keys(groups)) {
    groups[key].sort(
      (a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );
  }

  const cards = await generateCards(projects);

  const cardGroups = {};

  for (const [type, group] of Object.entries(groups)) {
    cardGroups[type] = group.map((project) =>
      cards.find((card) => card.project === project)
    ).filter(Boolean);
  }

  const header = ``;

  const sections = [
    renderSection("Games", cardGroups.game),
    renderSection("Websites & Tools", cardGroups.website),
    renderSection("Discord Bots", cardGroups.discord_bot),
  ].filter(Boolean);

  //const footer =
  //  `<sub>Updated ${new Date().toISOString().slice(0, 10)}</sub>`;

  const output = [
    header,
    ...sections,
    //footer,
  ].join("\n\n") + "\n";

  await Bun.write(OUT, output);

  console.log("");
  console.log(`Generated ${cards.length} SVG cards.`);
  console.log(`Assets directory: ${ASSET_DIR}`);
  console.log(`README updated: ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
