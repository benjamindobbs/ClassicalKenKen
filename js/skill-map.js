// ── Career Cluster color reference (Modernized National Career Clusters Framework) ──
// Creating & Experiencing  → Arts, Entertainment & Design  #C2185B
// Building & Moving        → Advanced Manufacturing         #D84315
//                          → Supply Chain & Transportation  #795548
// Connecting & Supporting  → Management & Entrepreneurship  #7B1FA2  (cross-cutting)
//                          → Marketing & Sales              #6A1B9A  (cross-cutting)
//                          → Digital Technology             #4527A0  (cross-cutting)
// Caring for Communities   → Education                      #0277BD
// Investing in the Future  → Financial Services             #E65100
// Framework center         → Career Ready Practices         #546E7A

const C = {
  ARTS:    '#C2185B',
  MFG:     '#D84315',
  SUPPLY:  '#795548',
  MGMT:    '#7B1FA2',
  MKTG:    '#6A1B9A',
  DIGITAL: '#4527A0',
  EDU:     '#0277BD',
  FINANCE: '#E65100',
  CRP:     '#546E7A',
};

const topics = [
  {
    id: 1,
    name: "Habits of Mind",
    initials: "HM",
    color: "#8B5CF6",
    glow: "rgba(139,92,246,0.35)",
    bg: "rgba(139,92,246,0.12)",
    description: "Cultivate the professional attitudes and habits that underpin success in any creative or production environment. These foundational dispositions guide students to grow as self-directed learners, persistent problem-solvers, and skilled collaborators.",
    clusterTags: [
      { label: "Career Ready Practices", color: C.CRP },
      { label: "Management & Entrepreneurship", color: C.MGMT },
      { label: "Education", color: C.EDU },
    ],
    skills: [
      {
        name: "Persistence",
        description: "Develop the resilience to work through obstacles without giving up. In design and production, challenges are opportunities to deepen understanding and strengthen technique.",
        clusterTags: [
          { label: "Career Ready Practices", color: C.CRP },
        ]
      },
      {
        name: "Academic Curiosity",
        description: "Cultivate a genuine drive to learn and investigate beyond the minimum. Great designers ask 'why' and 'what if' at every stage of the creative process.",
        clusterTags: [
          { label: "Career Ready Practices", color: C.CRP },
          { label: "Teaching, Training & Facilitation", color: C.EDU },
        ]
      },
      {
        name: "Commitment to Excellence",
        description: "Hold every project—regardless of complexity—to the highest standard you are capable of. Excellence is a habit built through intentional, consistent practice.",
        clusterTags: [
          { label: "Career Ready Practices", color: C.CRP },
          { label: "Safety & Quality Assurance", color: C.MFG },
        ]
      },
      {
        name: "Extending Knowledge",
        description: "Actively seek new skills, techniques, and perspectives that expand what you can bring to your work. Professional growth does not stop at the classroom door.",
        clusterTags: [
          { label: "Career Ready Practices", color: C.CRP },
          { label: "Teaching, Training & Facilitation", color: C.EDU },
        ]
      },
      {
        name: "Application of Previous Knowledge",
        description: "Recognize when and how past skills apply to new challenges. The ability to transfer learning across contexts is the mark of a truly adaptable professional.",
        clusterTags: [
          { label: "Career Ready Practices", color: C.CRP },
          { label: "Leadership & Operations", color: C.MGMT },
        ]
      }
    ]
  },
  {
    id: 2,
    name: "Adobe Illustrator",
    initials: "Ai",
    color: "#F97316",
    glow: "rgba(249,115,22,0.35)",
    bg: "rgba(249,115,22,0.12)",
    description: "Build mastery in the industry-standard vector graphics application at the core of graphic design, branding, and print production. Students develop professional workflows from initial project setup through publication-ready output.",
    clusterTags: [
      { label: "Arts, Entertainment & Design", color: C.ARTS },
      { label: "Marketing & Sales", color: C.MKTG },
    ],
    skills: [
      {
        name: "Working in the Design Industry",
        description: "Understand the professional landscape of graphic design—roles, workflows, client relationships, and industry expectations. Learn how designers collaborate and communicate in real-world studios.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Leadership & Operations", color: C.MGMT },
          { label: "Strategic Sales", color: C.MKTG },
        ]
      },
      {
        name: "Project Setup & Interface",
        description: "Navigate Illustrator's workspace with confidence. Set up documents with correct artboard dimensions, color modes, and units for your intended print or digital output.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
        ]
      },
      {
        name: "Organizing Documents",
        description: "Use layers, groups, and naming conventions to keep complex files manageable. Organized files are faster to edit, easier to hand off, and more professional.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Business Information Management", color: C.MGMT },
        ]
      },
      {
        name: "Creating & Modifying Visual Elements",
        description: "Build and refine vector shapes, paths, and objects using Illustrator's core tools. Develop precision and control over the elements that make up your designs.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
        ]
      },
      {
        name: "Publishing Digital Media",
        description: "Prepare and export artwork for digital and print output in the correct file formats and resolution settings. Understand the technical differences between screen and print-ready files.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Media Production & Broadcasting", color: C.ARTS },
        ]
      }
    ]
  },
  {
    id: 3,
    name: "Silk Screening",
    initials: "Sk",
    color: "#EC4899",
    glow: "rgba(236,72,153,0.35)",
    bg: "rgba(236,72,153,0.12)",
    description: "Learn the complete screen printing process from artwork preparation to finished garment. Students gain hands-on experience with frame preparation, ink mixing, and both single and multi-color production using plastisol inks.",
    clusterTags: [
      { label: "Arts, Entertainment & Design", color: C.ARTS },
      { label: "Advanced Manufacturing", color: C.MFG },
    ],
    skills: [
      {
        name: "Prepare Silk Screens",
        description: "Coat screens with emulsion, dry them in a light-safe environment, and inspect for defects before exposure. Proper preparation is the foundation of a clean, consistent print.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Safety & Quality Assurance", color: C.MFG },
        ]
      },
      {
        name: "Design Positives & Transparencies",
        description: "Create print-ready positive films or transparencies used to expose the screen, ensuring sufficient ink density for a complete and accurate burn.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Expose and Wash Out Frames",
        description: "Use a UV exposure unit to transfer the design onto the coated screen, then wash out unexposed emulsion to reveal a clean, open stencil ready for printing.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Align & Set Up Single and Multi-Color Print Jobs",
        description: "Register screens accurately on the press to ensure precise alignment across one or multiple color layers, preventing misregistration on the finished garment.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Industrial Machinery", color: C.MFG },
        ]
      },
      {
        name: "Prepare & Mix Plastisol Ink",
        description: "Mix and prepare plastisol inks to achieve the correct color, viscosity, and opacity for the substrate and design being printed.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Safety & Quality Assurance", color: C.MFG },
        ]
      },
      {
        name: "Single & Multi-Color Printing",
        description: "Execute print runs with consistent squeegee pressure, angle, and speed for sharp, even coverage across single and multi-color jobs.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Cure & Finish Prints",
        description: "Pass printed garments through a conveyor dryer or use a flash unit to fully cure plastisol ink, producing washfast, durable results ready for delivery.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Safety & Quality Assurance", color: C.MFG },
        ]
      }
    ]
  },
  {
    id: 4,
    name: "Embroidery",
    initials: "Em",
    color: "#14B8A6",
    glow: "rgba(20,184,166,0.35)",
    bg: "rgba(20,184,166,0.12)",
    description: "Explore the intersection of craft and technology in machine embroidery. Students develop skills in digitizing artwork for stitch output, setting up and operating commercial equipment, and maintaining machines for consistent, high-quality results.",
    clusterTags: [
      { label: "Arts, Entertainment & Design", color: C.ARTS },
      { label: "Advanced Manufacturing", color: C.MFG },
    ],
    skills: [
      {
        name: "Design for Embroidery",
        description: "Understand the constraints of embroidery as a medium—minimum detail size, stitch count, and how design decisions translate into thread, needle, and finished texture.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Fashion & Interiors", color: C.ARTS },
        ]
      },
      {
        name: "Embroidery Digitizing",
        description: "Use digitizing software to convert artwork into a stitch file, defining stitch types, directions, densities, and color sequences for accurate machine output.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Software Solutions", color: C.DIGITAL },
        ]
      },
      {
        name: "Machine Maintenance and Setup",
        description: "Perform routine maintenance including cleaning, oiling, and tension adjustments to keep machines running reliably and producing consistent, high-quality embroidery.",
        clusterTags: [
          { label: "Industrial Machinery", color: C.MFG },
        ]
      },
      {
        name: "Machine Operation",
        description: "Thread, hoop, and operate commercial embroidery machines safely and efficiently, monitoring production runs and troubleshooting common issues as they arise.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Industrial Machinery", color: C.MFG },
        ]
      }
    ]
  },
  {
    id: 5,
    name: "Direct to Film",
    initials: "Df",
    color: "#3B82F6",
    glow: "rgba(59,130,246,0.35)",
    bg: "rgba(59,130,246,0.12)",
    description: "Master the end-to-end DTF printing workflow, from digital file preparation to finished heat-applied transfer. Students operate and maintain every piece of equipment in the production chain, producing professional-grade garment decorations.",
    clusterTags: [
      { label: "Arts, Entertainment & Design", color: C.ARTS },
      { label: "Advanced Manufacturing", color: C.MFG },
      { label: "Digital Technology", color: C.DIGITAL },
    ],
    skills: [
      {
        name: "Design for the DTF Process",
        description: "Prepare artwork files with the correct resolution, color profile, and white underbase settings required for successful DTF printing and vibrant transfer results.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
        ]
      },
      {
        name: "Machine Maintenance and Setup",
        description: "Maintain the DTF printer through regular cleaning cycles, printhead care, and film path checks to ensure consistent, clog-free output across production runs.",
        clusterTags: [
          { label: "Industrial Machinery", color: C.MFG },
        ]
      },
      {
        name: "RasterLink 7 Print Setup and Operation",
        description: "Configure RasterLink 7 RIP software with appropriate color profiles, print modes, and layout settings to optimize film output for DTF transfer production.",
        clusterTags: [
          { label: "Software Solutions", color: C.DIGITAL },
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Heater/Shaker Setup, Operation, and Maintenance",
        description: "Operate the powder adhesive heater and shaker at correct temperatures and timing, and perform routine maintenance to ensure even, consistent adhesive application.",
        clusterTags: [
          { label: "Industrial Machinery", color: C.MFG },
        ]
      },
      {
        name: "Heat Press Setup, Operation, and Maintenance",
        description: "Set heat press time, temperature, and pressure for different garment types and transfer materials, and maintain the platen surface for consistent, professional application.",
        clusterTags: [
          { label: "Industrial Machinery", color: C.MFG },
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Heat Press Laser Alignment Setup & Utilization",
        description: "Use laser alignment tools to position transfers accurately and repeatably, minimizing placement errors and improving throughput on production runs.",
        clusterTags: [
          { label: "Industrial Machinery", color: C.MFG },
        ]
      },
      {
        name: "DTF Transfer Application",
        description: "Apply cured DTF transfers to garments using correct heat and pressure parameters, achieving a durable bond with a smooth, professional finish.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Safety & Quality Assurance", color: C.MFG },
        ]
      }
    ]
  },
  {
    id: 6,
    name: "Digital Signmaking & Printing",
    initials: "Ds",
    color: "#22C55E",
    glow: "rgba(34,197,94,0.35)",
    bg: "rgba(34,197,94,0.12)",
    description: "Apply design and wide-format production skills to create professional signage, graphics, and branded materials. Students work with industry-standard software and solvent printing equipment across a broad range of substrates and real-world applications.",
    clusterTags: [
      { label: "Arts, Entertainment & Design", color: C.ARTS },
      { label: "Advanced Manufacturing", color: C.MFG },
      { label: "Marketing & Sales", color: C.MKTG },
    ],
    skills: [
      {
        name: "Design for Digital Signmaking & Printing",
        description: "Create artwork sized, scaled, and colored correctly for wide-format output, accounting for viewing distance, substrate characteristics, and environmental conditions.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Media Production & Broadcasting", color: C.ARTS },
        ]
      },
      {
        name: "Media & Substrate Management",
        description: "Select, load, and handle print media correctly to prevent feed errors, minimize wasted material, and ensure consistent, defect-free print output.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
          { label: "Purchasing & Warehousing", color: C.SUPPLY },
        ]
      },
      {
        name: "RasterLink 7 Print/Cut Setup and Operation",
        description: "Configure RasterLink 7 for print-only, cut-only, and print-then-cut workflows, optimizing settings for each substrate type and finished application.",
        clusterTags: [
          { label: "Software Solutions", color: C.DIGITAL },
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Solvent Printer Setup, Operation, and Maintenance",
        description: "Operate the solvent printer through daily startup, media loading, print runs, and maintenance routines including printhead cleaning and ink system management.",
        clusterTags: [
          { label: "Industrial Machinery", color: C.MFG },
        ]
      },
      {
        name: "Media Application",
        description: "Apply printed media to surfaces cleanly and without bubbles, wrinkles, or lifting, using the tools and techniques appropriate to each substrate and environment.",
        clusterTags: [
          { label: "Production & Automation", color: C.MFG },
        ]
      },
      {
        name: "Design for Banners, Signs, Decals, Stickers, Window Graphics & Wall Wraps",
        description: "Apply design principles and technical knowledge to produce output-ready artwork for a wide range of signage, display, and branded environment applications.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Marketing & Advertising", color: C.MKTG },
        ]
      }
    ]
  },
  {
    id: 7,
    name: "Logistics & Operations",
    initials: "Lo",
    color: "#EAB308",
    glow: "rgba(234,179,8,0.35)",
    bg: "rgba(234,179,8,0.12)",
    description: "Develop the operational skills that keep a production business running efficiently. Students manage client relationships, source and track materials, uphold quality standards, and oversee projects from intake through final delivery.",
    clusterTags: [
      { label: "Management & Entrepreneurship", color: C.MGMT },
      { label: "Supply Chain & Transportation", color: C.SUPPLY },
    ],
    skills: [
      {
        name: "Client Communication",
        description: "Interact professionally with clients from initial inquiry through job completion—taking orders accurately, setting clear expectations, and following up to confirm satisfaction.",
        clusterTags: [
          { label: "Leadership & Operations", color: C.MGMT },
          { label: "Strategic Sales", color: C.MKTG },
        ]
      },
      {
        name: "Procurement, Shipping & Receiving",
        description: "Source materials from vendors, manage purchase orders, and accurately receive and inspect incoming goods to maintain production readiness.",
        clusterTags: [
          { label: "Purchasing & Warehousing", color: C.SUPPLY },
        ]
      },
      {
        name: "Quality Control",
        description: "Inspect finished products against established standards before they leave the shop, identifying and resolving defects to ensure every order meets expectations.",
        clusterTags: [
          { label: "Safety & Quality Assurance", color: C.MFG },
        ]
      },
      {
        name: "Outgoing Packaging & Shipping",
        description: "Package finished orders safely and professionally, generate shipping labels, and coordinate carrier pickup or drop-off for timely, damage-free delivery.",
        clusterTags: [
          { label: "Purchasing & Warehousing", color: C.SUPPLY },
          { label: "Planning & Logistics", color: C.SUPPLY },
        ]
      },
      {
        name: "Project Management",
        description: "Coordinate tasks, timelines, and resources across a job from intake through completion, keeping production on schedule and all stakeholders informed.",
        clusterTags: [
          { label: "Project Management", color: C.MGMT },
        ]
      }
    ]
  },
  {
    id: 8,
    name: "Marketing & Advertisement",
    initials: "Mk",
    color: "#EF4444",
    glow: "rgba(239,68,68,0.35)",
    bg: "rgba(239,68,68,0.12)",
    description: "Build the skills to research, promote, and visually communicate a brand's products and services. Students identify target audiences, capture compelling product imagery, and design marketing materials across both physical and digital channels.",
    clusterTags: [
      { label: "Marketing & Sales", color: C.MKTG },
      { label: "Arts, Entertainment & Design", color: C.ARTS },
    ],
    skills: [
      {
        name: "Market Research",
        description: "Identify target audiences, analyze competitors, and gather insights that inform positioning, messaging, and promotional strategy for products and services.",
        clusterTags: [
          { label: "Market Research, Analytics & Ethics", color: C.MKTG },
        ]
      },
      {
        name: "Product Photography",
        description: "Capture clean, well-lit product images suitable for use in marketing materials, online storefronts, social media, and printed catalogs.",
        clusterTags: [
          { label: "Design & Digital Arts", color: C.ARTS },
          { label: "Marketing & Advertising", color: C.MKTG },
        ]
      },
      {
        name: "Physical & Digital Marketing Design",
        description: "Design cohesive promotional materials for both print distribution and digital channels, applying brand guidelines and effective visual communication principles.",
        clusterTags: [
          { label: "Marketing & Advertising", color: C.MKTG },
          { label: "Design & Digital Arts", color: C.ARTS },
        ]
      }
    ]
  },
  {
    id: 9,
    name: "Storefront & Enterprise",
    initials: "Se",
    color: "#06B6D4",
    glow: "rgba(6,182,212,0.35)",
    bg: "rgba(6,182,212,0.12)",
    description: "Experience running a real business through the school-based enterprise. Students manage retail operations, maintain accurate inventory records, process transactions through point-of-sale systems, and apply foundational bookkeeping principles.",
    clusterTags: [
      { label: "Management & Entrepreneurship", color: C.MGMT },
      { label: "Marketing & Sales", color: C.MKTG },
      { label: "Financial Services", color: C.FINANCE },
    ],
    skills: [
      {
        name: "Operate School-Based Enterprise",
        description: "Run day-to-day business operations in the school store, applying real-world retail and production skills in a supported, professional learning environment.",
        clusterTags: [
          { label: "Entrepreneurship & Small Business", color: C.MGMT },
          { label: "Retail & Customer Experience", color: C.MKTG },
        ]
      },
      {
        name: "Inventory Management",
        description: "Track stock levels, record incoming and outgoing goods, and flag low inventory to ensure the enterprise is always ready to fulfill customer orders.",
        clusterTags: [
          { label: "Purchasing & Warehousing", color: C.SUPPLY },
          { label: "Business Information Management", color: C.MGMT },
        ]
      },
      {
        name: "Point of Sale",
        description: "Process customer transactions accurately using point-of-sale software, handle returns and exchanges, and reconcile end-of-day sales records.",
        clusterTags: [
          { label: "Retail & Customer Experience", color: C.MKTG },
          { label: "Business Information Management", color: C.MGMT },
        ]
      },
      {
        name: "Bookkeeping",
        description: "Record financial transactions, track income and expenses, and maintain accurate books using foundational accounting principles and business practices.",
        clusterTags: [
          { label: "Accounting", color: C.FINANCE },
        ]
      }
    ]
  }
];

// ── DOM refs ────────────────────────────────────────────────────────────────
const container  = document.getElementById('web-container');
const svg        = document.getElementById('svg-lines');
const centerNode = document.getElementById('center-node');
const infoPanel  = document.getElementById('info-panel');
const closeBtn   = document.getElementById('close-btn');
const backBtn    = document.getElementById('back-btn');
const hintEl     = document.getElementById('hint');
const panelBody  = document.getElementById('panel-body');

// ── State ───────────────────────────────────────────────────────────────────
let currentView    = 'main';
let currentTopic   = null;
let activeNodeId   = null;
let webRevealTimer = null;

const MAIN_CENTER_HTML = 'Graphics &amp;<br>Printing<br>Technology';
const PANEL_MS = 300; // matches CSS panel width transition

// ── Helpers ─────────────────────────────────────────────────────────────────
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

function fadeTransition(callback) {
  clearTimeout(webRevealTimer);
  container.style.opacity = ''; // clear any inline opacity so class can take over
  container.classList.add('fading');
  setTimeout(() => {
    callback();
    container.classList.remove('fading');
  }, 160);
}

function clearCanvas() {
  svg.innerHTML = '';
  document.querySelectorAll('.topic-node').forEach(n => n.remove());
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
    line.setAttribute('stroke-opacity', '0.75');
    line.setAttribute('stroke-width', '2.5');
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

// ── Main View ────────────────────────────────────────────────────────────────
function buildMainWeb() {
  const { x: cx, y: cy } = getCenter();
  const radius = Math.min(cx, cy) * 0.62;

  centerNode.innerHTML = MAIN_CENTER_HTML;
  centerNode.removeAttribute('style');
  centerNode.classList.remove('sub-view');
  centerNode.onclick = null;
  centerNode.title = '';
  centerNode.style.left = cx + 'px';
  centerNode.style.top  = cy + 'px';

  svg.setAttribute('width',  container.offsetWidth);
  svg.setAttribute('height', container.offsetHeight);
  clearCanvas();

  backBtn.classList.remove('visible');
  hintEl.textContent = 'Select a topic to explore';

  topics.forEach((topic, i) => {
    const angle = (i / topics.length) * 2 * Math.PI - Math.PI / 2;
    const nx = cx + radius * Math.cos(angle);
    const ny = cy + radius * Math.sin(angle);

    drawLine(cx, cy, nx, ny, topic.color, 't' + topic.id);

    const node = createNode(
      't' + topic.id, nx, ny,
      topic.color, topic.glow, topic.bg,
      topic.initials, topic.name, ''
    );
    node.addEventListener('click', () => enterSubView(topic.id));
    container.appendChild(node);
  });
}

// ── Sub View ─────────────────────────────────────────────────────────────────
function buildSubWeb() {
  const topic = currentTopic;
  const { x: cx, y: cy } = getCenter();
  const radius = Math.min(cx, cy) * 0.60;

  centerNode.innerHTML = topic.name;
  centerNode.classList.add('sub-view');
  centerNode.style.left        = cx + 'px';
  centerNode.style.top         = cy + 'px';
  centerNode.style.borderColor = topic.color;
  centerNode.style.color       = topic.color;
  centerNode.style.background  = 'radial-gradient(circle at 40% 35%, ' + topic.bg + ', #0b0b1a)';
  centerNode.style.boxShadow   = '0 0 0 8px ' + topic.bg + ', 0 0 40px ' + topic.glow;
  centerNode.onclick = goBack;
  centerNode.title = 'Back to overview';

  svg.setAttribute('width',  container.offsetWidth);
  svg.setAttribute('height', container.offsetHeight);
  clearCanvas();

  backBtn.classList.add('visible');
  hintEl.textContent = 'Select a skill to learn more';

  topic.skills.forEach((skill, i) => {
    const angle = (i / topic.skills.length) * 2 * Math.PI - Math.PI / 2;
    const nx = cx + radius * Math.cos(angle);
    const ny = cy + radius * Math.sin(angle);
    const nodeId = 's' + i;

    drawLine(cx, cy, nx, ny, topic.color, nodeId);

    const node = createNode(
      nodeId, nx, ny,
      topic.color, topic.glow, topic.bg,
      toInitials(skill.name), skill.name, 'skill-node'
    );

    if (activeNodeId === nodeId) node.classList.add('active');

    node.addEventListener('click', () => selectSkill(nodeId, skill));
    container.appendChild(node);
  });
}

// ── Navigation ───────────────────────────────────────────────────────────────
function enterSubView(topicId) {
  currentTopic = topics.find(t => t.id === topicId);
  currentView  = 'sub';
  activeNodeId = null;
  closePanel(false);
  fadeTransition(buildSubWeb);
}

function goBack() {
  currentView  = 'main';
  currentTopic = null;
  activeNodeId = null;
  closePanel(false);
  fadeTransition(buildMainWeb);
}

// ── Panel open/close ─────────────────────────────────────────────────────────
function openPanel() {
  // 1. Instantly hide web (bypass the CSS opacity transition)
  container.style.transition = 'opacity 0s';
  container.style.opacity = '0';
  void container.offsetWidth; // force reflow
  container.style.transition = '';

  // 2. Force panel to final width with no animation so buildWeb reads correct size
  infoPanel.style.transition = 'none';
  infoPanel.style.width = '340px';
  void infoPanel.offsetWidth;
  buildWeb();
  infoPanel.style.width = '';
  infoPanel.style.transition = '';

  // 3. Slide panel in; reveal web only after panel is nearly settled
  requestAnimationFrame(() => {
    infoPanel.classList.add('open');
    webRevealTimer = setTimeout(() => {
      container.style.opacity = ''; // CSS takes over: 0 → 1 with 0.15s transition
    }, PANEL_MS - 30);
  });
}

// ── Skill Selection ──────────────────────────────────────────────────────────
function selectSkill(nodeId, skill) {
  const prev = activeNodeId;

  if (prev !== null) {
    document.getElementById('node-' + prev)?.classList.remove('active');
    setLineActive(prev, false);
  }

  if (prev === nodeId) {
    activeNodeId = null;
    closePanel(false, true);
    return;
  }

  activeNodeId = nodeId;
  document.getElementById('node-' + nodeId)?.classList.add('active');
  setLineActive(nodeId, true);

  populateSkillPanel(currentTopic, skill);

  if (!infoPanel.classList.contains('open')) {
    openPanel();
  }
  // Panel already open (switching skills): content updated above, no layout change
}

// ── Panel ────────────────────────────────────────────────────────────────────
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

function closePanel(resetActive = true, withAnimation = false) {
  clearTimeout(webRevealTimer);

  if (resetActive && activeNodeId !== null) {
    document.getElementById('node-' + activeNodeId)?.classList.remove('active');
    setLineActive(activeNodeId, false);
    activeNodeId = null;
  }

  if (withAnimation && infoPanel.classList.contains('open')) {
    // Instantly hide web, slide panel shut, rebuild and reveal after
    container.style.transition = 'opacity 0s';
    container.style.opacity = '0';
    void container.offsetWidth;
    container.style.transition = '';

    infoPanel.classList.remove('open');

    webRevealTimer = setTimeout(() => {
      buildWeb();
      container.style.opacity = ''; // CSS takes over: 0 → 1 with 0.15s transition
    }, PANEL_MS + 20);
  } else {
    infoPanel.classList.remove('open');
    container.style.opacity = ''; // clear any lingering inline style
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
function buildWeb() {
  if (currentView === 'main') buildMainWeb();
  else buildSubWeb();
}

closeBtn.addEventListener('click', () => closePanel(true, true));
backBtn.addEventListener('click', goBack);
window.addEventListener('resize', buildWeb);


buildWeb();
