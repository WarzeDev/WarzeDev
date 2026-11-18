
// generate-readme.js — run with: bun generate-readme.js

import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const API = process.env.PROJECTS_API ||
  "https://projects.warze.org/api/projects?match=any&sort=created&order=desc";
const OUT = process.env.OUTPUT_FILE || "README.md";

const CARD_WIDTH = 240;
const CARD_HEIGHT = 276;
const THUMB_WIDTH = 216;
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
    return ["http:", "https:"].includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

function absUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return safeUrl(path);

  return safeUrl(
    "https://projects.warze.org/" + path.replace(/^\//, "")
  );
}

function primaryLanguage(languages = []) {
  return [...languages].sort(
    (a, b) => (LANG_PRIORITY[b] ?? 40) - (LANG_PRIORITY[a] ?? 40)
  )[0] || null;
}

function parseGithub(url) {
  const match = url?.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
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

// ---------- image downloading ----------

const downloadedAssets = new Map();


async function downloadAsset(url) {
  url = safeUrl(url);
  if (!url) return null;

  if (downloadedAssets.has(url)) {
    return downloadedAssets.get(url);
  }

  const promise = (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const response = await fetch(url, {
          headers: {
            "User-Agent": "Warze-README-Generator/1.0",
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // Decode WebP, JPEG, GIF, etc. and normalize to PNG.
        const pngBuffer = await sharp(buffer)
          .rotate()
          .png()
          .toBuffer();

        return {
          dataUri: `data:image/png;base64,${pngBuffer.toString("base64")}`,
        };
      } catch (error) {
        if (attempt === 1) {
          console.warn(`Failed to download ${url}: ${error.message}`);
        }
      }
    }

    return null;
  })();

  downloadedAssets.set(url, promise);
  return promise;
}


// ---------- PNG card generation ----------

function renderSVG(project, thumbnail, icon) {
  const title = truncate(project.title || "Untitled project", 28);
  const descriptionLines = wrapText(project.description || "", 34, 3);

  const language = primaryLanguage(project.languages || []);
  const languageColor = LANG_COLORS[language] || LANG_COLORS.default;
  const github = parseGithub(project.github_link || project.link);

  const thumbnailBlock = thumbnail
    ? `<image href="${thumbnail.dataUri}"
        x="12" y="12" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"
        preserveAspectRatio="xMidYMid meet" clip-path="url(#thumbClip)"/>`
    : `<text x="${CARD_WIDTH / 2}" y="84" fill="#8b949e"
        font-size="12" text-anchor="middle">No preview available</text>`;

  const iconBlock = icon
    ? `<image href="${icon.dataUri}" x="16" y="161"
        width="24" height="24" preserveAspectRatio="xMidYMid meet"/>`
    : "";

  const titleX = icon ? 48 : 16;

  const descriptionBlock = descriptionLines
    .map((line, index) => `
      <text x="16" y="${205 + index * 16}"
        fill="#8b949e" font-size="10.5">${esc(line)}</text>
    `)
    .join("");

  const languageBlock = language
    ? `<circle cx="20" cy="258" r="4" fill="${languageColor}"/>
       <text x="30" y="262" fill="#8b949e" font-size="10">${esc(language)}</text>`
    : "";

  const repoText = github ? `${github.owner}/${github.repo}` : "";

  const repoBlock = repoText
    ? `<text x="224" y="262" text-anchor="end"
        fill="#6e7681" font-size="8">${esc(truncate(repoText, 25))}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  width="${CARD_WIDTH}" height="${CARD_HEIGHT}"
  viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"
  font-family="Arial, Helvetica, sans-serif">

  <defs>
    <clipPath id="thumbClip">
      <rect x="12" y="12" width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}" rx="6"/>
    </clipPath>
  </defs>

  <rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}"
    height="${CARD_HEIGHT - 1}" rx="9"
    fill="#0d1117" stroke="#30363d"/>

  <rect x="12" y="12" width="${THUMB_WIDTH}"
    height="${THUMB_HEIGHT}" rx="6" fill="#161b22"/>

  ${thumbnailBlock}
  ${iconBlock}

  <text x="${titleX}" y="179" fill="#e6edf3"
    font-size="15" font-weight="600">${esc(title)}</text>

  ${descriptionBlock}

  <path d="M12 246 H228" stroke="#30363d" stroke-width="1"/>

  ${languageBlock}
  ${repoBlock}
</svg>`;
}

async function generateCards(projects) {
  await mkdir(ASSET_DIR, { recursive: true });

  const existing = await readdir(ASSET_DIR);

  for (const file of existing) {
    if (
      /^project-card-.*\.(svg|png)$/.test(file) ||
      /^project-asset-/.test(file)
    ) {
      await unlink(resolve(ASSET_DIR, file));
    }
  }

  downloadedAssets.clear();

  const cards = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    const prefix = `project-card-${slugify(project.title)}-${i + 1}`;
    const filename = `${prefix}.png`;

    const [thumbnail, icon] = await Promise.all([
      downloadAsset(absUrl(project.thumbnail)),
      downloadAsset(absUrl(project.icon)),
    ]);

    const svg = renderSVG(project, thumbnail, icon);

    await sharp(Buffer.from(svg))
      .png()
      .toFile(resolve(ASSET_DIR, filename));

    cards.push({ project, filename });
    console.log(`Generated ${filename}`);
  }

  return cards;
}

// ---------- README generation ----------

function renderSection(title, projects) {
  if (!projects.length) return "";

  const rows = [];

  for (let i = 0; i < projects.length; i += 3) {
    const row = projects.slice(i, i + 3);

    rows.push(`
<tr>
${[0, 1, 2].map((index) => {
  const card = row[index];
  if (!card) return '<td width="240"></td>';

  const link = safeUrl(card.project.link || card.project.github_link);
  const image = `<img src="assets/${card.filename}" width="${CARD_WIDTH}" alt="${esc(card.project.title)}" />`;

  return `<td width="240" valign="top" align="center">
    ${link ? `<a href="${esc(link)}">${image}</a>` : image}
  </td>`;
}).join("\n")}
</tr>`);
  }

  return `## ${title}

<table cellspacing="0" cellpadding="2" width="732">
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
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  }

  const cards = await generateCards(projects);
  const cardGroups = {};

  for (const [type, group] of Object.entries(groups)) {
    cardGroups[type] = group
      .map((project) => cards.find((card) => card.project === project))
      .filter(Boolean);
  }

  const sections = [
    renderSection("Games", cardGroups.game),
    renderSection("Websites & Tools", cardGroups.website),
    renderSection("Discord Bots", cardGroups.discord_bot),
  ].filter(Boolean);

  await Bun.write(OUT, sections.join("\n\n") + "\n");

  console.log(`Generated ${cards.length} PNG cards.`);
  console.log(`Assets directory: ${ASSET_DIR}`);
  console.log(`README updated: ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
