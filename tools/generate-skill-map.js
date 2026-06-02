#!/usr/bin/env node
/**
 * generate-skill-map.js
 *
 * Usage: node tools/generate-skill-map.js <slug>
 *
 * Reads:  Skill-Maps/data/<slug>.csv
 * Writes: Skill-Maps/<slug>/data.js       (visualization data)
 *         Skill-Maps/<slug>/index.html    (page shell)
 *
 * The CSV must have these columns:
 *   type, id, name, initials, color, icon, description, clusters
 *
 * Row types:
 *   course  — one per file; metadata for the page and index card
 *   topic   — one planet node
 *   skill   — one moon, id = parent topic id
 *
 * See Skill-Maps/data/graphics-printing.csv for a full example.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const slug = process.argv[2];
if (!slug) {
  console.error('Usage: node tools/generate-skill-map.js <slug>');
  process.exit(1);
}

const root    = path.join(__dirname, '..');
const csvPath = path.join(root, 'Skill-Maps', 'data', slug + '.csv');
const outDir  = path.join(root, 'Skill-Maps', slug);

if (!fs.existsSync(csvPath)) {
  console.error('CSV not found: ' + csvPath);
  process.exit(1);
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function splitCSVLine(line) {
  const result = [];
  let i = 0, field = '';
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else { field += line[i++]; }
      }
    } else if (line[i] === ',') {
      result.push(field.trim()); field = ''; i++;
    } else {
      field += line[i++];
    }
  }
  result.push(field.trim());
  return result;
}

function parseCSV(text) {
  const lines = text
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
    return obj;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toInitials(name) {
  const words = name.replace(/[^a-zA-Z\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2);
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function parseClusters(str) {
  if (!str) return [];
  return str.split('|')
    .map(pair => {
      const colonIdx = pair.lastIndexOf(':');
      if (colonIdx === -1) return null;
      const label = pair.slice(0, colonIdx).trim();
      const color = pair.slice(colonIdx + 1).trim();
      if (!label || !color) return null;
      return { label, color };
    })
    .filter(Boolean);
}

function autoCenterLabel(name) {
  // Split course name into short lines for the center node
  const escaped = name.replace(/&/g, '&amp;');
  const words   = escaped.split(/\s+/);
  const lines   = [];
  let   current = '';
  for (const word of words) {
    const candidate = current ? current + ' ' + word : word;
    if (candidate.replace(/&amp;/g, '&').length > 12 && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.join('<br>');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Parse CSV ─────────────────────────────────────────────────────────────────

const rows    = parseCSV(fs.readFileSync(csvPath, 'utf-8'));
let courseRow = null;
const topics  = [];
const topicMap = {};

for (const row of rows) {
  if (row.type === 'course') {
    courseRow = row;
  } else if (row.type === 'topic') {
    const id    = parseInt(row.id, 10);
    const color = row.color || '#888888';
    const topic = {
      id,
      name:        row.name,
      initials:    row.initials || toInitials(row.name),
      color,
      glow:        hexToRgba(color, 0.35),
      bg:          hexToRgba(color, 0.12),
      icon:        row.icon || '',
      description: row.description,
      clusterTags: parseClusters(row.clusters),
      skills:      [],
    };
    topics.push(topic);
    topicMap[id] = topic;
  } else if (row.type === 'skill') {
    const topicId = parseInt(row.id, 10);
    const parent  = topicMap[topicId];
    if (!parent) {
      console.warn('Warning: skill "' + row.name + '" references unknown topic id ' + topicId);
      continue;
    }
    parent.skills.push({
      name:        row.name,
      icon:        row.icon || '',
      description: row.description,
      clusterTags: parseClusters(row.clusters),
    });
  }
}

if (!courseRow) {
  console.error('CSV must have a "course" row');
  process.exit(1);
}
if (topics.length === 0) {
  console.error('CSV has no topic rows');
  process.exit(1);
}

const centerLabel = courseRow.initials || autoCenterLabel(courseRow.name);
const courseTitle = courseRow.name;
const courseDept  = courseRow.color;
const courseDesc  = courseRow.description;
const cardMeta    = courseRow.clusters ? courseRow.clusters.split('|') : [];

// ── Count totals for display ──────────────────────────────────────────────────

const topicCount = topics.length;
const skillCount = topics.reduce((s, t) => s + t.skills.length, 0);

// ── Serialize topics to JS ────────────────────────────────────────────────────

function jsString(str) {
  return JSON.stringify(str);
}

function serializeClusterTags(tags) {
  if (!tags || tags.length === 0) return '[]';
  return '[\n' + tags.map(t =>
    '        { label: ' + jsString(t.label) + ', color: ' + jsString(t.color) + ' }'
  ).join(',\n') + '\n      ]';
}

function serializeSkills(skills) {
  if (!skills || skills.length === 0) return '[]';
  return '[\n' + skills.map(s =>
    '      {\n' +
    '        name: '        + jsString(s.name)        + ',\n' +
    '        icon: '        + jsString(s.icon)        + ',\n' +
    '        description: ' + jsString(s.description) + ',\n' +
    '        clusterTags: ' + serializeClusterTags(s.clusterTags) + ',\n' +
    '      }'
  ).join(',\n') + '\n    ]';
}

function serializeTopics(topics) {
  return '[\n' + topics.map(t =>
    '  {\n' +
    '    id: '          + t.id                          + ',\n' +
    '    name: '        + jsString(t.name)              + ',\n' +
    '    initials: '    + jsString(t.initials)          + ',\n' +
    '    color: '       + jsString(t.color)             + ',\n' +
    '    glow: '        + jsString(t.glow)              + ',\n' +
    '    bg: '          + jsString(t.bg)                + ',\n' +
    '    icon: '        + jsString(t.icon)              + ',\n' +
    '    description: ' + jsString(t.description)       + ',\n' +
    '    clusterTags: ' + serializeClusterTags(t.clusterTags) + ',\n' +
    '    skills: '      + serializeSkills(t.skills)     + ',\n' +
    '  }'
  ).join(',\n') + '\n]';
}

// ── Write data.js ─────────────────────────────────────────────────────────────

const dataJs =
  '// Generated by tools/generate-skill-map.js — do not edit by hand.\n' +
  '// Edit Skill-Maps/data/' + slug + '.csv and re-run the generator.\n' +
  'window.SKILL_MAP_DATA = {\n' +
  '  centerLabel: ' + jsString(centerLabel) + ',\n' +
  '  topics: '      + serializeTopics(topics) + ',\n' +
  '};\n';

// ── Write index.html ──────────────────────────────────────────────────────────

const metaItems = cardMeta.length
  ? cardMeta
  : [topicCount + ' topics', skillCount + '+ skills'];

const metaHtml = metaItems
  .map(m => '                    <span>' + escapeHtml(m) + '</span>')
  .join('\n');

const indexHtml =
  '<!DOCTYPE html>\n' +
  '<html lang="en">\n' +
  '<head>\n' +
  '  <meta charset="UTF-8">\n' +
  '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
  '  <title>Skill Map &mdash; ' + escapeHtml(courseTitle) + '</title>\n' +
  '  <link rel="icon" href="../../assets/favicon.svg" type="image/svg+xml">\n' +
  '  <link rel="stylesheet" href="../../assets/style.css">\n' +
  '  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,400,1,0">\n' +
  '</head>\n' +
  '<body class="skill-map">\n' +
  '  <nav class="nav">\n' +
  '    <a class="nav-brand" href="../../index.html">Classical Technology</a>\n' +
  '    <div class="nav-links">\n' +
  '      <a href="../../KenKen/">Play KenKen</a>\n' +
  '      <a href="../../SAT-Questions/">Practice SAT</a>\n' +
  '      <a href="../index.html" class="active">Skill Maps</a>\n' +
  '      <a href="../../readme/">ReadMe</a>\n' +
  '      <a href="../../teacher/index.html" class="nav-teacher">Teacher</a>\n' +
  '    </div>\n' +
  '  </nav>\n' +
  '\n' +
  '  <div id="app">\n' +
  '    <div id="web-container">\n' +
  '      <span id="page-title">Course Skill Map &mdash; ' + escapeHtml(courseTitle) + '</span>\n' +
  '      <button id="back-btn" title="Return to overview">&#8592; Overview</button>\n' +
  '      <div id="web-stage">\n' +
  '        <svg id="svg-lines"></svg>\n' +
  '        <div id="center-node"></div>\n' +
  '      </div>\n' +
  '      <span id="hint">Select a topic to explore</span>\n' +
  '    </div>\n' +
  '\n' +
  '    <div id="info-panel">\n' +
  '      <div id="panel-inner">\n' +
  '        <div id="panel-header">\n' +
  '          <button id="close-btn" title="Close">&times;</button>\n' +
  '        </div>\n' +
  '        <div id="panel-body"></div>\n' +
  '      </div>\n' +
  '    </div>\n' +
  '  </div>\n' +
  '\n' +
  '  <script src="./data.js"></script>\n' +
  '  <script src="../../js/skill-map.js"></script>\n' +
  '</body>\n' +
  '</html>\n';

// ── Write outputs ─────────────────────────────────────────────────────────────

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'data.js'),    dataJs,    'utf-8');
fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml, 'utf-8');

console.log('Generated:');
console.log('  Skill-Maps/' + slug + '/data.js');
console.log('  Skill-Maps/' + slug + '/index.html');
console.log('');

// ── Index card reminder ───────────────────────────────────────────────────────

const deptStr  = escapeHtml(courseDept  || '');
const descStr  = escapeHtml(courseDesc  || '');
const cardSlug = './' + slug + '/';

console.log('Add this card to Skill-Maps/index.html if not already present:');
console.log('');
console.log('  <a class="map-card" href="' + cardSlug + '">');
console.log('    <span class="map-card-dept">' + deptStr + '</span>');
console.log('    <h2>' + escapeHtml(courseTitle) + '</h2>');
console.log('    <p>' + descStr + '</p>');
console.log('    <div class="map-card-meta">');
console.log(metaItems.map(m => '      <span>' + escapeHtml(m) + '</span>').join('\n'));
console.log('    </div>');
console.log('  </a>');
console.log('');
