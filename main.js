// generate-readme.js — run with: bun generate-readme.js

import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const API = process.env.PROJECTS_API ||
  "https://projects.warze.org/api/projects?match=any&sort=created&order=desc";
const OUT = process.env.OUTPUT_FILE || "README.md";

// Card layout (CSS pixels as displayed in the README)
const CARD_WIDTH = 272;          // was 270 (+2)
const CARD_HEIGHT = 312;
const THUMB_WIDTH = 248;         // was 246 (+2)
const THUMB_HEIGHT = 156;

// Section banner layout
const BANNER_WIDTH = 840;
const BANNER_HEIGHT = 64;

// Render scale: 1 = PNG files are exactly CARD_WIDTH / BANNER_WIDTH pixels wide.
const SCALE = 1;
const DENSITY = 72 * SCALE;

// Network timeouts (ms)
const FETCH_TIMEOUT_MS = 20000;
const HARD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total

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

function wrapText(value, maxChars, maxLines = 4) {   // default now 4 lines
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

function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
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

        const response = await fetchWithTimeout(url, {
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

function renderCardSVG(project, thumbnail, icon) {
  const titleX = icon ? 52 : 16;
  const titleMax = icon ? 20 : 24;

  const title = truncate(project.title || "Untitled project", titleMax);
  const descriptionLines = wrapText(project.description || "", 38, 4); // wider + 4 lines

  const language = primaryLanguage(project.languages || []);
  const languageColor = LANG_COLORS[language] || LANG_COLORS.default;
  const github = parseGithub(project.github_link || project.link);

  // "slice" = fill the whole container, keep aspect ratio, crop the overflow.
  // The clip-path trims the overflow and gives the thumbnail rounded corners.
  const thumbnailBlock = thumbnail
    ? `<image href="${thumbnail.dataUri}"
        x="12" y="12" width="${THUMB_WIDTH}" height="${THUMB_HEIGHT}"
        preserveAspectRatio="xMidYMid slice" clip-path="url(#thumbClip)"/>`
    : `<text x="${CARD_WIDTH / 2}" y="94" fill="#8b949e"
        font-size="14" text-anchor="middle">No preview available</text>`;

  const iconBlock = icon
    ? `<image href="${icon.dataUri}" x="16" y="179"
        width="28" height="28"
        preserveAspectRatio="xMidYMid slice" clip-path="url(#iconClip)"/>`
    : "";

  // 4-line description block. Line height 15 keeps 4 lines clear of the divider.
  const descriptionBlock = descriptionLines
    .map((line, index) => `
      <text x="16" y="${224 + index * 15}"
        fill="#8b949e" font-size="12.5">${esc(line)}</text>
    `)
    .join("");

  const languageBlock = language
    ? `<circle cx="22" cy="297" r="5" fill="${languageColor}"/>
       <text x="33" y="301" fill="#8b949e" font-size="12">${esc(language)}</text>`
    : "";

  const repoText = github ? `${github.owner}/${github.repo}` : "";

  const repoBlock = repoText
    ? `<text x="${CARD_WIDTH - 14}" y="301" text-anchor="end"
        fill="#6e7681" font-size="10">${esc(truncate(repoText, 22))}</text>`
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
    <clipPath id="iconClip">
      <rect x="16" y="179" width="28" height="28" rx="6"/>
    </clipPath>
  </defs>

  <rect x="0.5" y="0.5" width="${CARD_WIDTH - 1}"
    height="${CARD_HEIGHT - 1}" rx="9"
    fill="#0d1117" stroke="#30363d"/>

  <rect x="12" y="12" width="${THUMB_WIDTH}"
    height="${THUMB_HEIGHT}" rx="6" fill="#161b22"/>

  ${thumbnailBlock}
  ${iconBlock}

  <text x="${titleX}" y="199" fill="#e6edf3"
    font-size="18" font-weight="600">${esc(title)}</text>

  ${descriptionBlock}

  <path d="M12 280 H${CARD_WIDTH - 12}" stroke="#30363d" stroke-width="1"/>

  ${languageBlock}
  ${repoBlock}
</svg>`;
}

async function svgToPng(svg, filepath) {
  await sharp(Buffer.from(svg), { density: DENSITY })
    .png()
    .toFile(filepath);
}

async function generateCards(projects) {
  await mkdir(ASSET_DIR, { recursive: true });

  const existing = await readdir(ASSET_DIR);

  for (const file of existing) {
    if (
      /^project-card-.*\.(svg|png)$/.test(file) ||
      /^project-asset-/.test(file) ||
      /^section-.*\.png$/.test(file)
    ) {
      await unlink(resolve(ASSET_DIR, file));
    }
  }

  downloadedAssets.clear();

  const cards = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    console.log(`[${i + 1}/${projects.length}] ${project.title || "Untitled project"}`);

    const thumbnail = await downloadAsset(absUrl(project.thumbnail));

    // Skip projects without a valid image preview.
    if (!thumbnail) {
      console.log(`  Skipped: no preview`);
      continue;
    }

    const icon = await downloadAsset(absUrl(project.icon));
    const filename = `project-card-${slugify(project.title)}-${i + 1}.png`;

    const svg = renderCardSVG(project, thumbnail, icon);
    await svgToPng(svg, resolve(ASSET_DIR, filename));

    cards.push({ project, filename });
    console.log(`  Generated ${filename}`);
  }

  return cards;
}

// ---------- section banner generation (red & white) ----------

function renderBannerSVG(title, count) {
  const W = BANNER_WIDTH;
  const H = BANNER_HEIGHT;

  const pillW = 64;
  const pillH = 30;
  const pillX = W - 24 - pillW;
  const pillY = (H - pillH) / 2;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
  font-family="Arial, Helvetica, sans-serif">

  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#9b111e"/>
      <stop offset="0.55" stop-color="#d7263d"/>
      <stop offset="1" stop-color="#ff4d5e"/>
    </linearGradient>
    <clipPath id="round">
      <rect width="${W}" height="${H}" rx="12"/>
    </clipPath>
  </defs>

  <g clip-path="url(#round)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>

    <!-- slanted white accents -->
    <polygon points="${W - 250},0 ${W - 190},0 ${W - 250 + 40},${H} ${W - 250 - 20},${H}"
      fill="#ffffff" opacity="0.10"/>
    <polygon points="${W - 170},0 ${W - 150},0 ${W - 170 + 40},${H} ${W - 170 + 20},${H}"
      fill="#ffffff" opacity="0.18"/>
    <polygon points="0,0 90,0 60,${H} 0,${H}" fill="#ffffff" opacity="0.10"/>

    <!-- bottom highlight line -->
    <rect x="0" y="${H - 3}" width="${W}" height="3" fill="#ffffff" opacity="0.85"/>
  </g>

  <text x="28" y="${H / 2 + 10}" fill="#ffffff"
    font-size="28" font-weight="800" letter-spacing="1">${esc(title)}</text>

  <!-- count pill -->
  <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}"
    rx="${pillH / 2}" fill="#ffffff"/>
  <text x="${pillX + pillW / 2}" y="${pillY + 21}" text-anchor="middle"
    fill="#c1121f" font-size="16" font-weight="800">${count}</text>
</svg>`;
}

// ---------- README generation ----------

async function renderSection(title, projects) {
  if (!projects.length) return "";

  const bannerFile = `section-${slugify(title)}.png`;
  await svgToPng(
    renderBannerSVG(title, projects.length),
    resolve(ASSET_DIR, bannerFile)
  );
  console.log(`Generated ${bannerFile}`);

  const banner = `<img src="assets/${bannerFile}" width="${BANNER_WIDTH}" alt="${esc(title)}" />`;

  const images = projects.map(({ project, filename }) => {
    const link = safeUrl(project.link || project.github_link);

    // Alt text = title + short description, so the description is embedded
    // in the README's image alt text (tooltip / a11y / fallback).
    const desc = truncate(project.description || "", 120);
    const alt = desc
      ? `${project.title || "Untitled project"} — ${desc}`
      : (project.title || "Untitled project");

    const image = `<img src="assets/${filename}" width="${CARD_WIDTH}" alt="${esc(alt)}" />`;

    return link
      ? `<a href="${esc(link)}">${image}</a>`
      : image;
  });

  return `<p align="center">${banner}</p>

${images.join("\n")}`;
}

// ---------- main ----------

async function main() {
  const hardTimeout = setTimeout(() => {
    console.error(`Aborting: exceeded ${HARD_TIMEOUT_MS / 1000}s hard timeout.`);
    process.exit(2);
  }, HARD_TIMEOUT_MS);
  hardTimeout.unref();

  console.log(`Fetching ${API} ...`);
  const response = await fetchWithTimeout(API);

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  const json = await response.json();
  const projects = json.data ?? [];
  console.log(`Got ${projects.length} projects. Downloading assets...`);

  const cards = await generateCards(projects);
  console.log(`Cards ready: ${cards.length}. Rendering sections...`);

  const groups = {
    game: [],
    website: [],
    discord_bot: [],
  };

  for (const card of cards) {
    (groups[card.project.type] ??= []).push(card);
  }

  for (const group of Object.values(groups)) {
    group.sort(
      (a, b) =>
        new Date(b.project.created_at) - new Date(a.project.created_at)
    );
  }

  const sections = (
    await Promise.all([
      renderSection("Games", groups.game),
      renderSection("Websites & Tools", groups.website),
      renderSection("Discord Bots", groups.discord_bot),
    ])
  ).filter(Boolean);

  await Bun.write(OUT, sections.join("\n\n") + "\n");

  console.log(`Generated ${cards.length} PNG cards.`);
  console.log(`Assets directory: ${ASSET_DIR}`);
  console.log(`README updated: ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});