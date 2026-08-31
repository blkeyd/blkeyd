// Generates two self-contained, theme-matched SVG stat cards from the
// GitHub API: assets/generated/overview.svg and assets/generated/languages.svg
//
// Runs entirely inside GitHub Actions using the built-in GITHUB_TOKEN.
// No third-party rendering service is involved, so nothing can go down.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USERNAME = process.env.GH_USERNAME || "blkeyd";
const TOKEN = process.env.GH_TOKEN;

if (!TOKEN) {
  console.error("GH_TOKEN environment variable is required.");
  process.exit(1);
}

const REST_HEADERS = {
  Authorization: `token ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": `${USERNAME}-stats-generator`,
};

const GRAPHQL_HEADERS = {
  Authorization: `bearer ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": `${USERNAME}-stats-generator`,
};

// ---------- palette (matches assets/header.svg) ----------
const COLORS = {
  bg: "#111827",
  bgCard: "#171E2E",
  border: "#22293B",
  amber: "#E59A3A",
  amberSoft: "#F7C77E",
  text: "#E8EBF0",
  muted: "#6E7893",
};

// ---------- data fetching ----------

async function fetchAllOwnedRepos() {
  let page = 1;
  const repos = [];
  while (true) {
    const res = await fetch(
      `https://api.github.com/users/${USERNAME}/repos?per_page=100&page=${page}&type=owner`,
      { headers: REST_HEADERS }
    );
    if (!res.ok) throw new Error(`repos fetch failed: ${res.status}`);
    const batch = await res.json();
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos.filter((r) => !r.fork);
}

async function fetchLanguageTotals(repos) {
  const totals = {};
  for (const repo of repos) {
    const res = await fetch(
      `https://api.github.com/repos/${USERNAME}/${repo.name}/languages`,
      { headers: REST_HEADERS }
    );
    if (!res.ok) continue;
    const langs = await res.json();
    for (const [lang, bytes] of Object.entries(langs)) {
      totals[lang] = (totals[lang] || 0) + bytes;
    }
  }
  return totals;
}

async function fetchUserProfile() {
  const res = await fetch(`https://api.github.com/users/${USERNAME}`, {
    headers: REST_HEADERS,
  });
  if (!res.ok) throw new Error(`user fetch failed: ${res.status}`);
  return res.json();
}

async function fetchContributionCalendar() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: GRAPHQL_HEADERS,
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });
  if (!res.ok) throw new Error(`graphql fetch failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.user.contributionsCollection.contributionCalendar;
}

function computeStreaks(calendar) {
  const days = calendar.weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let longest = 0;
  let running = 0;
  for (const d of days) {
    if (d.contributionCount > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  let current = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const isToday = i === days.length - 1;
    if (days[i].contributionCount > 0) {
      current += 1;
    } else if (!isToday) {
      break;
    }
    // allow "today" to have zero contributions so far without breaking streak
    if (days[i].contributionCount === 0 && !isToday) break;
  }

  return { longest, current };
}

async function fetchTotalStars(repos) {
  return repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
}

// ---------- SVG rendering ----------

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  }[c]));
}

function overviewSvg({ totalContributions, currentStreak, longestStreak, totalStars, publicRepos, followers }) {
  const stats = [
    { label: "Total Contributions", value: totalContributions },
    { label: "Current Streak", value: `${currentStreak} ${currentStreak === 1 ? "day" : "days"}` },
    { label: "Longest Streak", value: `${longestStreak} ${longestStreak === 1 ? "day" : "days"}` },
    { label: "Total Stars", value: totalStars },
    { label: "Public Repos", value: publicRepos },
    { label: "Followers", value: followers },
  ];

  const colWidth = 152;
  const width = colWidth * 3 + 32;
  const rowHeight = 92;
  const height = rowHeight * 2 + 60;

  const cells = stats
    .map((s, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 16 + col * colWidth;
      const y = 56 + row * rowHeight;
      return `
        <text x="${x + colWidth / 2}" y="${y + 26}" text-anchor="middle" class="value">${escapeXml(s.value)}</text>
        <text x="${x + colWidth / 2}" y="${y + 46}" text-anchor="middle" class="label">${escapeXml(s.label)}</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="GitHub stats overview for ${USERNAME}">
  <defs>
    <style>
      .title { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 700; fill: ${COLORS.amber}; }
      .value { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 700; fill: ${COLORS.text}; }
      .label { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 11px; fill: ${COLORS.muted}; letter-spacing: .3px; }
    </style>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${COLORS.bg}" stroke="${COLORS.border}"/>
  <text x="16" y="30" class="title">GitHub Stats</text>
  <line x1="16" y1="40" x2="${width - 16}" y2="40" stroke="${COLORS.border}" stroke-width="1"/>
  ${cells}
</svg>
`;
}

function languagesSvg(languageTotals) {
  const entries = Object.entries(languageTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  const width = 420;
  const rowHeight = 34;
  const height = 56 + entries.length * rowHeight;
  const barMaxWidth = width - 140;

  const rows = entries
    .map(([lang, bytes], i) => {
      const pct = ((bytes / total) * 100).toFixed(1);
      const barWidth = Math.max(4, (bytes / total) * barMaxWidth);
      const y = 56 + i * rowHeight;
      const opacity = (0.45 + (0.55 * (entries.length - i)) / entries.length).toFixed(2);
      return `
        <text x="16" y="${y + 14}" class="lang">${escapeXml(lang)}</text>
        <rect x="120" y="${y + 2}" width="${barMaxWidth}" height="12" rx="6" fill="${COLORS.border}"/>
        <rect x="120" y="${y + 2}" width="${barWidth.toFixed(1)}" height="12" rx="6" fill="${COLORS.amber}" opacity="${opacity}"/>
        <text x="${width - 16}" y="${y + 14}" text-anchor="end" class="pct">${pct}%</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Most used languages for ${USERNAME}">
  <defs>
    <style>
      .title { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 16px; font-weight: 700; fill: ${COLORS.amber}; }
      .lang { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 12px; fill: ${COLORS.text}; }
      .pct { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 11px; fill: ${COLORS.muted}; }
    </style>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${COLORS.bg}" stroke="${COLORS.border}"/>
  <text x="16" y="30" class="title">Most Used Languages</text>
  <line x1="16" y1="40" x2="${width - 16}" y2="40" stroke="${COLORS.border}" stroke-width="1"/>
  ${rows}
</svg>
`;
}

// ---------- main ----------

async function main() {
  console.log(`Generating stats for ${USERNAME}...`);

  const [profile, repos, calendar] = await Promise.all([
    fetchUserProfile(),
    fetchAllOwnedRepos(),
    fetchContributionCalendar(),
  ]);

  const [languageTotals, totalStars] = await Promise.all([
    fetchLanguageTotals(repos),
    fetchTotalStars(repos),
  ]);

  const { current, longest } = computeStreaks(calendar);

  const overview = overviewSvg({
    totalContributions: calendar.totalContributions,
    currentStreak: current,
    longestStreak: longest,
    totalStars,
    publicRepos: profile.public_repos,
    followers: profile.followers,
  });

  const languages = languagesSvg(languageTotals);

  const outDir = path.join(process.cwd(), "assets", "generated");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "overview.svg"), overview, "utf8");
  await writeFile(path.join(outDir, "languages.svg"), languages, "utf8");

  console.log("Done. Wrote assets/generated/overview.svg and languages.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
