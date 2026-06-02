// Skill map visualization engine.
// Data is provided by the per-course data.js loaded before this script.
// To add a new course: create Skill-Maps/data/<slug>.csv and run:
//   node tools/generate-skill-map.js <slug>

const { centerLabel, topics } = window.SKILL_MAP_DATA;

function iconHtml(name) {
  return '<span class="material-symbols-rounded">' + name + '</span>';
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const container  = document.getElementById('web-container');
const stage      = document.getElementById('web-stage');
const svg        = document.getElementById('svg-lines');
const centerNode = document.getElementById('center-node');
const infoPanel  = document.getElementById('info-panel');
const closeBtn   = document.getElementById('close-btn');
const backBtn    = document.getElementById('back-btn');
const hintEl     = document.getElementById('hint');
const panelBody  = document.getElementById('panel-body');

// ── State ────────────────────────────────────────────────────────────────────
let currentTopic    = null;   // topic object when a topic is focused
let activeNodeId    = null;   // 't{id}s{i}' when a skill node is selected
let focusPanX       = 0;      // stage X when topic is focused, panel closed
let focusPanY       = 0;
let panTimer        = null;
let panelSlideTimer = null;

const PANEL_W  = 340;
const PANEL_MS = 300;
const PAN_MS   = 480;

// ── Helpers ──────────────────────────────────────────────────────────────────
function getCenter() {
  return { x: container.offsetWidth / 2, y: container.offsetHeight / 2 };
}

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

function clusterTagHTML(tag) {
  const bg     = hexToRgba(tag.color, 0.12);
  const border = hexToRgba(tag.color, 0.30);
  return '<span class="cluster-tag" style="background:' + bg + ';color:' + tag.color + ';border:1px solid ' + border + '">' + tag.label + '</span>';
}

// Both .topic-node and .skill-node share the same flex layout: circle on top,
// label below, whole div centered at (anchorX, anchorY). The visual circle center
// therefore sits CIRCLE_DY px above anchorY (midpoint of the 13–21 px range from
// 1–2 line labels). Lines are shortened to stop at the circle edge.
const SKILL_NODE_R    = 36;  // half of 72px .skill-node circle
const SKILL_CIRCLE_DY = 20;  // estimated offset for skill nodes (1–3 line labels)
const PLANET_NODE_R   = 43;  // half of 86px .topic-node circle
const PLANET_CIRCLE_DY = 17; // estimated offset for planet nodes (1–2 line labels)

function lineEnd(px, py, anchorX, anchorY, dy, r) {
  const cx = anchorX, cy = anchorY - dy;
  const dx = cx - px, ddy = cy - py;
  const len = Math.sqrt(dx * dx + ddy * ddy);
  if (len <= r) return { x: cx, y: cy };
  return { x: cx - (dx / len) * r, y: cy - (ddy / len) * r };
}

function moonLineEnd(px, py, skillX, skillY) {
  return lineEnd(px, py, skillX, skillY, SKILL_CIRCLE_DY, SKILL_NODE_R);
}

function planetLineEnd(px, py, topicX, topicY) {
  return lineEnd(px, py, topicX, topicY, PLANET_CIRCLE_DY, PLANET_NODE_R);
}

function drawLine(x1, y1, x2, y2, color, id) {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-opacity', '0.25');
  line.setAttribute('stroke-dasharray', '5 5');
  line.id = 'line-' + id;
  svg.appendChild(line);
}

function setLineActive(id, active) {
  const line = document.getElementById('line-' + id);
  if (!line) return;
  if (active) {
    line.setAttribute('stroke-opacity', '0.80');
    line.setAttribute('stroke-width', '2');
    line.removeAttribute('stroke-dasharray');
  } else {
    line.setAttribute('stroke-opacity', '0.25');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '5 5');
  }
}

function createNode(id, nx, ny, color, glow, bg, initials, label, extraClass) {
  const node = document.createElement('div');
  node.className = 'topic-node' + (extraClass ? ' ' + extraClass : '');
  node.id = 'node-' + id;
  node.style.left = nx + 'px';
  node.style.top  = ny + 'px';
  node.style.setProperty('--nc',      color);
  node.style.setProperty('--nc-glow', glow);
  node.style.setProperty('--nc-bg',   bg);
  node.innerHTML =
    '<div class="node-circle">' + initials + '</div>' +
    '<span class="node-label">' + label + '</span>';
  return node;
}

// ── Build (once on init and on resize) ───────────────────────────────────────
function buildAll() {
  svg.innerHTML = '';
  document.querySelectorAll('.topic-node').forEach(n => n.remove());

  const { x: cx, y: cy } = getCenter();
  const minR  = Math.min(cx, cy);
  const mainR = Math.round(minR * 0.64);
  const baseSkillR = Math.round(minR * 0.34);

  svg.setAttribute('width',  container.offsetWidth);
  svg.setAttribute('height', container.offsetHeight);

  centerNode.innerHTML = centerLabel;
  centerNode.removeAttribute('style');
  centerNode.classList.remove('sub-view');
  centerNode.onclick = () => { if (currentTopic) goBack(); };
  centerNode.title   = '';
  centerNode.style.left = cx + 'px';
  centerNode.style.top  = cy + 'px';

  topics.forEach((topic, i) => {
    const tAngle = (i / topics.length) * 2 * Math.PI - Math.PI / 2;
    const topicX = cx + mainR * Math.cos(tAngle);
    const topicY = cy + mainR * Math.sin(tAngle);

    const pep = planetLineEnd(cx, cy, topicX, topicY);
    drawLine(cx, cy, pep.x, pep.y, topic.color, 't' + topic.id);

    const topicNode = createNode(
      't' + topic.id, topicX, topicY,
      topic.color, topic.glow, topic.bg,
      iconHtml(topic.icon || toInitials(topic.name)), topic.name, ''
    );
    topicNode.addEventListener('click', () => enterSubView(topic.id));
    topicNode.dataset.compactLeft = topicX;
    topicNode.dataset.compactTop  = topicY;
    stage.appendChild(topicNode);

    topic.skills.forEach((skill, j) => {
      const sAngle  = (j / topic.skills.length) * 2 * Math.PI - Math.PI / 2;
      const skillX  = topicX + baseSkillR * Math.cos(sAngle);
      const skillY  = topicY + baseSkillR * Math.sin(sAngle);
      const skillId = 't' + topic.id + 's' + j;

      const ep = moonLineEnd(topicX, topicY, skillX, skillY);
      drawLine(topicX, topicY, ep.x, ep.y, topic.color, skillId);
      document.getElementById('line-' + skillId).style.opacity = '0';

      const skillNode = createNode(
        skillId, skillX, skillY,
        topic.color, topic.glow, topic.bg,
        iconHtml(skill.icon || toInitials(skill.name)), skill.name, 'skill-node'
      );
      skillNode.style.opacity       = '0';
      skillNode.style.pointerEvents = 'none';
      skillNode.dataset.compactLeft = skillX;
      skillNode.dataset.compactTop  = skillY;
      skillNode.addEventListener('click', () => selectSkill(skillId, skill));
      stage.appendChild(skillNode);
    });
  });

  hintEl.textContent = 'Select a topic to explore';
  backBtn.classList.remove('visible');
}

// ── Camera ───────────────────────────────────────────────────────────────────
function applyPan(x, y, animated) {
  if (animated) {
    stage.style.transition = 'transform ' + PAN_MS + 'ms cubic-bezier(0.4, 0, 0.2, 1)';
  } else {
    stage.style.transition = 'none';
    void stage.offsetWidth;
  }
  stage.style.transform = 'translate(' + x + 'px, ' + y + 'px)';
}

function adjacentIndices(topicId) {
  const idx = topics.findIndex(t => t.id === topicId);
  const n   = topics.length;
  return new Set([ ((idx - 1) + n) % n, idx, ((idx + 1) + n) % n ]);
}

// ── Topic visibility ──────────────────────────────────────────────────────────
function focusTopicVisibility(topicId) {
  const adj = adjacentIndices(topicId);
  topics.forEach((t, i) => {
    const node = document.getElementById('node-t' + t.id);
    const line = document.getElementById('line-t' + t.id);
    let opacity;
    if (t.id === topicId) opacity = '';
    else if (adj.has(i))  opacity = '0.30';
    else                  opacity = '0.07';
    if (node) node.style.opacity = opacity;
    if (line) line.style.opacity = opacity;
  });
}

function restoreTopicVisibility() {
  topics.forEach(t => {
    const node = document.getElementById('node-t' + t.id);
    const line = document.getElementById('line-t' + t.id);
    if (node) node.style.opacity = '';
    if (line) line.style.opacity = '';
  });
}

// ── Layout expansion ─────────────────────────────────────────────────────────
function expandTopicLayout(topicId) {
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return { expandedX: 0, expandedY: 0 };

  const { x: cx, y: cy } = getCenter();
  const topicNode = document.getElementById('node-t' + topicId);
  if (!topicNode) return { expandedX: 0, expandedY: 0 };

  const compactX = parseFloat(topicNode.dataset.compactLeft);
  const compactY = parseFloat(topicNode.dataset.compactTop);
  const dx   = compactX - cx;
  const dy   = compactY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const n          = topic.skills.length;
  const baseR      = Math.round(Math.min(cx, cy) * 0.34);
  const neededR    = n > 1 ? Math.ceil(160 / (2 * Math.sin(Math.PI / n))) : baseR;
  const skillR     = Math.max(baseR, neededR);
  const MIN_EXPAND = 120;
  const extraPush  = Math.max(skillR - baseR, 0) + MIN_EXPAND;

  const expandedX = cx + (dx / dist) * (dist + extraPush);
  const expandedY = cy + (dy / dist) * (dist + extraPush);

  topicNode.style.transition = 'none';
  void topicNode.offsetWidth;
  topicNode.style.left = expandedX + 'px';
  topicNode.style.top  = expandedY + 'px';

  const topicLine = document.getElementById('line-t' + topicId);
  if (topicLine) {
    const pep = planetLineEnd(cx, cy, expandedX, expandedY);
    topicLine.setAttribute('x2', pep.x);
    topicLine.setAttribute('y2', pep.y);
  }

  topic.skills.forEach((skill, j) => {
    const skillId   = 't' + topicId + 's' + j;
    const sAngle    = (j / n) * 2 * Math.PI - Math.PI / 2;
    const skillX    = expandedX + skillR * Math.cos(sAngle);
    const skillY    = expandedY + skillR * Math.sin(sAngle);
    const skillNode = document.getElementById('node-' + skillId);
    const skillLine = document.getElementById('line-' + skillId);
    if (skillNode) {
      skillNode.style.transition = 'none';
      skillNode.style.left = skillX + 'px';
      skillNode.style.top  = skillY + 'px';
    }
    if (skillLine) {
      const ep = moonLineEnd(expandedX, expandedY, skillX, skillY);
      skillLine.setAttribute('x1', expandedX);
      skillLine.setAttribute('y1', expandedY);
      skillLine.setAttribute('x2', ep.x);
      skillLine.setAttribute('y2', ep.y);
    }
  });

  return { expandedX, expandedY };
}

function restoreTopicLayout(topicId) {
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return;

  const topicNode = document.getElementById('node-t' + topicId);
  if (!topicNode || !topicNode.dataset.compactLeft) return;

  const compactX = parseFloat(topicNode.dataset.compactLeft);
  const compactY = parseFloat(topicNode.dataset.compactTop);

  topicNode.style.transition = 'none';
  topicNode.style.left = compactX + 'px';
  topicNode.style.top  = compactY + 'px';

  const topicLine = document.getElementById('line-t' + topicId);
  if (topicLine) {
    const { x: scx, y: scy } = getCenter();
    const pep = planetLineEnd(scx, scy, compactX, compactY);
    topicLine.setAttribute('x2', pep.x);
    topicLine.setAttribute('y2', pep.y);
  }

  topic.skills.forEach((skill, j) => {
    const skillId   = 't' + topicId + 's' + j;
    const skillNode = document.getElementById('node-' + skillId);
    const skillLine = document.getElementById('line-' + skillId);
    if (skillNode && skillNode.dataset.compactLeft) {
      const csx = parseFloat(skillNode.dataset.compactLeft);
      const csy = parseFloat(skillNode.dataset.compactTop);
      skillNode.style.transition = 'none';
      skillNode.style.left = csx + 'px';
      skillNode.style.top  = csy + 'px';
      if (skillLine) {
        const ep = moonLineEnd(compactX, compactY, csx, csy);
        skillLine.setAttribute('x1', compactX);
        skillLine.setAttribute('y1', compactY);
        skillLine.setAttribute('x2', ep.x);
        skillLine.setAttribute('y2', ep.y);
      }
    }
  });
}

// ── Skill visibility ──────────────────────────────────────────────────────────
function showTopicSkills(topicId) {
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return;
  topic.skills.forEach((skill, j) => {
    const skillId   = 't' + topicId + 's' + j;
    const skillNode = document.getElementById('node-' + skillId);
    const skillLine = document.getElementById('line-' + skillId);
    if (skillNode) {
      skillNode.style.animationDelay = (j * 0.05) + 's';
      skillNode.classList.remove('skill-entering');
      void skillNode.offsetWidth;
      skillNode.classList.add('skill-entering');
      skillNode.style.opacity       = '';
      skillNode.style.pointerEvents = '';
    }
    if (skillLine) skillLine.style.opacity = '';
  });
}

function hideTopicSkills(topicId) {
  const topic = topics.find(t => t.id === topicId);
  if (!topic) return;
  topic.skills.forEach((skill, j) => {
    const skillId   = 't' + topicId + 's' + j;
    const skillNode = document.getElementById('node-' + skillId);
    const skillLine = document.getElementById('line-' + skillId);
    if (skillNode) {
      skillNode.classList.remove('skill-entering');
      skillNode.style.opacity       = '0';
      skillNode.style.pointerEvents = 'none';
    }
    if (skillLine) skillLine.style.opacity = '0';
    if (activeNodeId === skillId) {
      if (skillNode) skillNode.classList.remove('active');
      setLineActive(skillId, false);
    }
  });
  restoreTopicLayout(topicId);
}

// ── Navigation ───────────────────────────────────────────────────────────────
function enterSubView(topicId) {
  clearTimeout(panTimer);
  if (currentTopic && currentTopic.id === topicId) return;

  const prevTopic = currentTopic;

  if (activeNodeId) {
    const an = document.getElementById('node-' + activeNodeId);
    if (an) an.classList.remove('active');
    setLineActive(activeNodeId, false);
    activeNodeId = null;
  }
  if (infoPanel.classList.contains('open')) {
    infoPanel.classList.remove('open');
    stage.style.transition = 'none';
    void stage.offsetWidth;
  }

  if (prevTopic) hideTopicSkills(prevTopic.id);

  currentTopic = topics.find(t => t.id === topicId);

  const { x: cx, y: cy } = getCenter();
  const { expandedX, expandedY } = expandTopicLayout(topicId);
  focusPanX = cx - expandedX;
  focusPanY = cy - expandedY;

  centerNode.style.cursor = 'pointer';
  centerNode.title = 'Return to overview';
  focusTopicVisibility(topicId);
  applyPan(focusPanX, focusPanY, true);

  panTimer = setTimeout(() => {
    stage.style.transition = '';
    showTopicSkills(topicId);
    hintEl.textContent = 'Select a skill to learn more';
    backBtn.classList.add('visible');
  }, PAN_MS + 20);
}

function goBack() {
  clearTimeout(panTimer);
  if (!currentTopic) return;

  if (activeNodeId) {
    const an = document.getElementById('node-' + activeNodeId);
    if (an) an.classList.remove('active');
    setLineActive(activeNodeId, false);
    activeNodeId = null;
  }
  if (infoPanel.classList.contains('open')) {
    infoPanel.classList.remove('open');
    stage.style.transition = 'none';
    void stage.offsetWidth;
  }

  hideTopicSkills(currentTopic.id);
  currentTopic = null;

  centerNode.style.cursor = '';
  centerNode.title = '';
  restoreTopicVisibility();
  applyPan(0, 0, true);

  panTimer = setTimeout(() => {
    stage.style.transition = '';
    hintEl.textContent = 'Select a topic to explore';
    backBtn.classList.remove('visible');
  }, PAN_MS + 20);
}

// ── Panel ─────────────────────────────────────────────────────────────────────
function openPanel() {
  clearTimeout(panelSlideTimer);
  infoPanel.classList.add('open');
  if (currentTopic) {
    topics.forEach(t => {
      if (t.id === currentTopic.id) return;
      const node = document.getElementById('node-t' + t.id);
      const line = document.getElementById('line-t' + t.id);
      if (node) node.style.opacity = '0';
      if (line) line.style.opacity = '0';
    });
    stage.style.transition = 'transform ' + PANEL_MS + 'ms ease-out';
    stage.style.transform  = 'translate(' + (focusPanX - PANEL_W / 2) + 'px, ' + focusPanY + 'px)';
    panelSlideTimer = setTimeout(() => { stage.style.transition = ''; }, PANEL_MS + 20);
  }
}

function closePanel(resetActive) {
  if (resetActive === undefined) resetActive = true;
  clearTimeout(panelSlideTimer);

  if (resetActive && activeNodeId !== null) {
    const an = document.getElementById('node-' + activeNodeId);
    if (an) an.classList.remove('active');
    setLineActive(activeNodeId, false);
    activeNodeId = null;
  }

  if (infoPanel.classList.contains('open')) {
    infoPanel.classList.remove('open');
    if (currentTopic) {
      focusTopicVisibility(currentTopic.id);
      stage.style.transition = 'transform ' + PANEL_MS + 'ms ease-out';
      stage.style.transform  = 'translate(' + focusPanX + 'px, ' + focusPanY + 'px)';
      panelSlideTimer = setTimeout(() => { stage.style.transition = ''; }, PANEL_MS + 20);
    }
  }
}

// ── Skill Selection ───────────────────────────────────────────────────────────
function selectSkill(nodeId, skill) {
  const prev = activeNodeId;

  if (prev !== null) {
    const pn = document.getElementById('node-' + prev);
    if (pn) pn.classList.remove('active');
    setLineActive(prev, false);
  }

  if (prev === nodeId) {
    activeNodeId = null;
    closePanel(false);
    return;
  }

  activeNodeId = nodeId;
  const sn = document.getElementById('node-' + nodeId);
  if (sn) sn.classList.add('active');
  setLineActive(nodeId, true);

  populateSkillPanel(currentTopic, skill);

  if (!infoPanel.classList.contains('open')) openPanel();
}

// ── Skill Panel Content ───────────────────────────────────────────────────────
function populateSkillPanel(topic, skill) {
  const clusterSection = (topic.clusterTags && topic.clusterTags.length)
    ? '<div class="cluster-section">' +
        '<div class="cluster-section-title">Career Clusters</div>' +
        '<div class="cluster-tag-row">' +
          topic.clusterTags.map(clusterTagHTML).join('') +
        '</div>' +
      '</div>'
    : '';

  const subClusterSection = (skill.clusterTags && skill.clusterTags.length)
    ? '<div class="cluster-section">' +
        '<div class="cluster-section-title">Sub-Cluster Areas</div>' +
        '<div class="cluster-tag-row">' +
          skill.clusterTags.map(clusterTagHTML).join('') +
        '</div>' +
      '</div>'
    : '';

  panelBody.innerHTML =
    '<div class="panel-parent-badge" style="background:' + topic.bg + ';color:' + topic.color + ';border:1px solid ' + hexToRgba(topic.color, 0.38) + '">' +
      topic.name +
    '</div>' +
    '<div class="panel-topic-name">' + skill.name + '</div>' +
    '<span class="panel-accent-bar" style="background:' + topic.color + '"></span>' +
    '<p class="panel-description">' + skill.description + '</p>' +
    clusterSection +
    subClusterSection;
}

// ── Init ─────────────────────────────────────────────────────────────────────
closeBtn.addEventListener('click', () => closePanel(true));
backBtn.addEventListener('click', goBack);

window.addEventListener('resize', () => {
  clearTimeout(panTimer);
  const prevTopic  = currentTopic;
  const prevActive = activeNodeId;
  const panelOpen  = infoPanel.classList.contains('open');

  stage.style.transition = 'none';
  stage.style.transform  = '';
  currentTopic = null;
  activeNodeId = null;

  buildAll();

  if (prevTopic) {
    currentTopic = prevTopic;

    const { x: cx, y: cy } = getCenter();
    const topicNode = document.getElementById('node-t' + prevTopic.id);
    if (topicNode) {
      const { expandedX, expandedY } = expandTopicLayout(prevTopic.id);
      focusPanX = cx - expandedX;
      focusPanY = cy - expandedY;
      const panelOffset = panelOpen ? -(PANEL_W / 2) : 0;
      applyPan(focusPanX + panelOffset, focusPanY, false);
    }

    focusTopicVisibility(prevTopic.id);
    if (panelOpen) {
      topics.forEach(t => {
        if (t.id === prevTopic.id) return;
        const node = document.getElementById('node-t' + t.id);
        const line = document.getElementById('line-t' + t.id);
        if (node) node.style.opacity = '0';
        if (line) line.style.opacity = '0';
      });
    }
    showTopicSkills(prevTopic.id);
    backBtn.classList.add('visible');
    hintEl.textContent = 'Select a skill to learn more';

    if (prevActive) {
      const an = document.getElementById('node-' + prevActive);
      if (an) an.classList.add('active');
      setLineActive(prevActive, true);
      activeNodeId = prevActive;
    }
  }
});

buildAll();