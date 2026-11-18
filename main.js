
 // generate-readme.js — run with: bun generate-readme.js

import { mkdir, readdir, unlink } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";

const API = process.env.PROJECTS_API ||
  "https://projects.warze.org/api/projects?match=any&sort=created&order=desc";

const OUT = process.env.OUTPUT_FILE || "README.md";

const CARD_WIDTH = 320;
const CARD_HEIGHT = 244;

const THUMB_X = 12;
const THUMB_Y = 12;
const THUMB_WIDTH = 296;
const THUMB_HEIGHT = 140;

const OUTPUT_DIR = dirname(resolve(OUT));

// ---------- helpers ----------

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

function absUrl(path, base = "https://projects.warze.org") {
  if (!path) return null;

  if (/^https?:\/\//i.test(path)) {
    return safeUrl(path);
  }

  return safeUrl(
    base.replace(/\/$/, "") + "/" + path.replace(/^\//, "")
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

  if (text.length <= max) return text;

  return text.slice(0, max - 3).trimEnd() + "...";
}

function wrapText(value, maxChars, maxLines = 2) {
  const words = String(value || "").trim().split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;

      if (lines.length >= maxLines) break;
    } else {
      current = next;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === maxLines) {
    const consumed = lines.join(" ").length;
    if (consumed < String(value || "").trim().length) {
      lines[maxLines - 1] = truncate(lines[maxLines - 1], maxChars);
    }
  }

  return lines;
}

// ---------- SVG generation ----------

function renderSVG(project) {
  const title = truncate(project.title || "Untitled project", 32);
  const description = project.description || "";

  const thumbnail = absUrl(project.thumbnail);
  const icon = absUrl(project.icon);

  const language = primaryLanguage(project.languages || []);
  const languageColor = LANG_COLORS[language] || LANG_COLORS.default;

  const github = parseGithub(project.github_link || project.link);

  const descriptionLines = wrapText(description, 43, 2);

  const thumbnailBlock = thumbnail
    ? `
      <rect
        x="${THUMB_X}"
        y="${THUMB_Y}"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        rx="6"
        fill="#161b22"
      />

      <image
        href="${esc(thumbnail)}"
        x="${THUMB_X}"
        y="${THUMB_Y}"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        preserveAspectRatio="xMidYMid meet"
        clip-path="url(#thumbClip)"
      />
    `
    : `
      <rect
        x="${THUMB_X}"
        y="${THUMB_Y}"
        width="${THUMB_WIDTH}"
        height="${THUMB_HEIGHT}"
        rx="6"
        fill="#161b22"
      />
      <text
        x="${CARD_WIDTH / 2}"
        y="${THUMB_Y + THUMB_HEIGHT / 2 + 5}"
        fill="#8b949e"
        font-size="13"
        text-anchor="middle"
      >No preview available</text>
    `;

  const iconBlock = icon
    ? `
      <image
        href="${esc(icon)}"
        x="16"
        y="164"
        width="20"
        height="20"
        preserveAspectRatio="xMidYMid meet"
      />
    `
    : "";

  const titleX = icon ? 44 : 16;

  const descriptionBlock = descriptionLines
    .map((line, index) => `
      <text
        x="16"
        y="${199 + index * 16}"
        fill="#8b949e"
        font-size="11"
      >${esc(line)}</text>
    `)
    .join("");

  const languageBlock = language
    ? `
      <circle cx="21" cy="228" r="4" fill="${languageColor}"/>
      <text
        x="31"
        y="232"
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
        y="232"
        text-anchor="end"
        fill="#6e7681"
        font-size="9"
      >${esc(truncate(repoText, 35))}</text>
    `
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  xmlns="http://www.w3.org/2000/svg"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${CARD_WIDTH}"
  height="${CARD_HEIGHT}"
  viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}"
  fill="none"
>
  <defs>
    <clipPath id="thumbClip">
      <rect
        x="${THUMB_X}"
        y="${THUMB_Y}"
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
    d="M12 212 H308"
    stroke="#30363d"
    stroke-width="1"
  />

  ${languageBlock}
  ${repoBlock}
</svg>`;
}

// ---------- card files ----------

async function generateCards(projects) {
  await mkdir(OUTPUT_DIR, { recursive: true });

  // Remove previously generated project cards.
  const existing = await readdir(OUTPUT_DIR);

  for (const file of existing) {
    if (/^project-card-.*\.svg$/.test(file)) {
      await unlink(resolve(OUTPUT_DIR, file));
    }
  }

  const cards = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];

    const filename =
      `project-card-${slugify(project.title)}-${i + 1}.svg`;

    await Bun.write(
      resolve(OUTPUT_DIR, filename),
      renderSVG(project)
    );

    cards.push({
      project,
      filename,
    });
  }

  return cards;
}

// ---------- README generation ----------

function renderSection(title, projects) {
  if (!projects.length) return "";

  const rows = [];

  for (let i = 0; i < projects.length; i += 2) {
    const a = projects[i];
    const b = projects[i + 1];

    const renderImage = (card) => {
      if (!card) return "";

      const link = safeUrl(
        card.project.link || card.project.github_link
      );

      const image = `<img src="./${card.filename}" width="${CARD_WIDTH}" alt="${esc(card.project.title)}" />`;

      return link
        ? `<a href="${esc(link)}">${image}</a>`
        : image;
    };

    rows.push(`
<tr>
  <td width="340" valign="top" align="center">
    ${renderImage(a)}
  </td>
  <td width="340" valign="top" align="center">
    ${renderImage(b)}
  </td>
</tr>`);
  }

  return `## ${title}

<table cellspacing="0" cellpadding="4" width="700">
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

  // Match generated cards back to their project categories.
  const cardGroups = {};

  for (const [type, group] of Object.entries(groups)) {
    cardGroups[type] = group.map((project) =>
      cards.find((card) => card.project === project)
    );
  }

  const header = `# Hi, I'm Warze

I build games, tools and web experiences. Here are some of my projects, organized by category.`;

  const sections = [
    renderSection("Games", cardGroups.game),
    renderSection("Websites & Tools", cardGroups.website),
    renderSection("Discord Bots", cardGroups.discord_bot),
  ].filter(Boolean);

  const footer =
    `<sub>Updated ${new Date().toISOString().slice(0, 10)}</sub>`;

  const output = [
    header,
    ...sections,
    footer,
  ].join("\n\n") + "\n";

  await Bun.write(OUT, output);

  console.log(`Generated ${cards.length} SVG cards.`);
  console.log(`Updated ${basename(OUT)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
