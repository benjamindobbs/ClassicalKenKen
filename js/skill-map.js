// â”€â”€ Career Cluster color reference (Modernized National Career Clusters Framework) â”€â”€
// Creating & Experiencing  â†’ Arts, Entertainment & Design  #C2185B
// Building & Moving        â†’ Advanced Manufacturing         #D84315
//                          â†’ Supply Chain & Transportation  #795548
// Connecting & Supporting  â†’ Management & Entrepreneurship  #7B1FA2  (cross-cutting)
//                          â†’ Marketing & Sales              #6A1B9A  (cross-cutting)
//                          â†’ Digital Technology             #4527A0  (cross-cutting)
// Caring for Communities   â†’ Education                      #0277BD
// Investing in the Future  â†’ Financial Services             #E65100
// Framework center         â†’ Career Ready Practices         #546E7A

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
        description: "Hold every projectâ€”regardless of complexityâ€”to the highest standard you are capable of. Excellence is a habit built through intentional, consistent practice.",
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
        description: "Understand the professional landscape of graphic designâ€”roles, workflows, client relationships, and industry expectations. Learn how designers collaborate and communicate in real-world studios.",
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
        description: "Understand the constraints of embroidery as a mediumâ€”minimum detail size, stitch count, and how design decisions translate into thread, needle, and finished texture.",
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
        name: "Design for Banners, Signs, & More",
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
        description: "Interact professionally with clients from initial inquiry through job completionâ€”taking orders accurately, setting clear expectations, and following up to confirm satisfaction.",
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


// ── Node icons ───────────────────────────────────────────────────────────────
const TOPIC_ICONS = {
  1: 'psychology',       // Habits of Mind
  2: 'brush',            // Adobe Illustrator
  3: 'massage',          // Silk Screening
  4: 'laundry',          // Embroidery
  5: 'layers',           // Direct to Film
  6: 'signpost',         // Digital Signmaking & Printing
  7: 'local_shipping',   // Logistics & Operations
  8: 'campaign',         // Marketing & Advertisement
  9: 'storefront',       // Storefront & Enterprise
};

const SKILL_ICONS = {
  // Habits of Mind
  't1s0': 'fitness_center',       // Persistence
  't1s1': 'menu_book',            // Academic Curiosity
  't1s2': 'grade',                // Commitment to Excellence
  't1s3': 'explore',              // Extending Knowledge
  't1s4': 'bolt',                 // Application of Previous Knowledge
  // Adobe Illustrator
  't2s0': 'work',                 // Working in the Design Industry
  't2s1': 'dashboard',            // Project Setup & Interface
  't2s2': 'folder_open',          // Organizing Documents
  't2s3': 'draw',                 // Creating & Modifying Visual Elements
  't2s4': 'publish',              // Publishing Digital Media
  // Silk Screening
  't3s0': 'grid_on',              // Prepare Silk Screens
  't3s1': 'image',                // Design Positives & Transparencies
  't3s2': 'wb_sunny',             // Expose and Wash Out Frames
  't3s3': 'tune',                 // Align & Set Up Print Jobs
  't3s4': 'colorize',             // Prepare & Mix Plastisol Ink
  't3s5': 'photo_library',        // Single & Multi-Color Printing
  't3s6': 'local_fire_department',// Cure & Finish Prints
  // Embroidery
  't4s0': 'design_services',      // Design for Embroidery
  't4s1': 'code',                 // Embroidery Digitizing
  't4s2': 'build',                // Machine Maintenance and Setup
  't4s3': 'settings',             // Machine Operation
  // Direct to Film
  't5s0': 'image',                // Design for the DTF Process
  't5s1': 'handyman',             // Machine Maintenance and Setup
  't5s2': 'computer',             // RasterLink 7 Print Setup and Operation
  't5s3': 'whatshot',             // Heater/Shaker Setup, Operation, and Maintenance
  't5s4': 'compress',             // Heat Press Setup, Operation, and Maintenance
  't5s5': 'gps_fixed',            // Heat Press Laser Alignment Setup & Utilization
  't5s6': 'touch_app',            // DTF Transfer Application
  // Digital Signmaking & Printing
  't6s0': 'landscape',            // Design for Digital Signmaking & Printing
  't6s1': 'inventory',            // Media & Substrate Management
  't6s2': 'content_cut',          // RasterLink 7 Print/Cut Setup and Operation
  't6s3': 'print',                // Solvent Printer Setup, Operation, and Maintenance
  't6s4': 'content_paste',        // Media Application
  't6s5': 'panorama',             // Design for Banners, Signs, Decals, etc.
  // Logistics & Operations
  't7s0': 'forum',                // Client Communication
  't7s1': 'unarchive',            // Procurement, Shipping & Receiving
  't7s2': 'fact_check',           // Quality Control
  't7s3': 'send',                 // Outgoing Packaging & Shipping
  't7s4': 'assignment',           // Project Management
  // Marketing & Advertisement
  't8s0': 'analytics',            // Market Research
  't8s1': 'photo_camera',         // Product Photography
  't8s2': 'photo_album',          // Physical & Digital Marketing Design
  // Storefront & Enterprise
  't9s0': 'business',             // Operate School-Based Enterprise
  't9s1': 'warehouse',            // Inventory Management
  't9s2': 'point_of_sale',        // Point of Sale
  't9s3': 'calculate',            // Bookkeeping
};

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

const MAIN_CENTER_HTML = 'Graphics &amp;<br>Printing<br>Technology';
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
  const baseSkillR = Math.round(minR * 0.27);

  svg.setAttribute('width',  container.offsetWidth);
  svg.setAttribute('height', container.offsetHeight);

  centerNode.innerHTML = MAIN_CENTER_HTML;
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

    drawLine(cx, cy, topicX, topicY, topic.color, 't' + topic.id);

    const topicNode = createNode(
      't' + topic.id, topicX, topicY,
      topic.color, topic.glow, topic.bg,
      iconHtml(TOPIC_ICONS[topic.id] || topic.initials), topic.name, ''
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

      drawLine(topicX, topicY, skillX, skillY, topic.color, skillId);
      document.getElementById('line-' + skillId).style.opacity = '0';

      const skillNode = createNode(
        skillId, skillX, skillY,
        topic.color, topic.glow, topic.bg,
        iconHtml(SKILL_ICONS[skillId] || toInitials(skill.name)), skill.name, 'skill-node'
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
  const baseR      = Math.round(Math.min(cx, cy) * 0.27);
  const neededR    = n > 1 ? Math.ceil(120 / (2 * Math.sin(Math.PI / n))) : baseR;
  const skillR     = Math.max(baseR, neededR);
  const extraPush  = skillR - baseR;

  const expandedX = cx + (dx / dist) * (dist + extraPush);
  const expandedY = cy + (dy / dist) * (dist + extraPush);

  topicNode.style.transition = 'none';
  void topicNode.offsetWidth;
  topicNode.style.left = expandedX + 'px';
  topicNode.style.top  = expandedY + 'px';

  const topicLine = document.getElementById('line-t' + topicId);
  if (topicLine) {
    topicLine.setAttribute('x2', expandedX);
    topicLine.setAttribute('y2', expandedY);
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
      skillLine.setAttribute('x1', expandedX);
      skillLine.setAttribute('y1', expandedY);
      skillLine.setAttribute('x2', skillX);
      skillLine.setAttribute('y2', skillY);
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
    topicLine.setAttribute('x2', compactX);
    topicLine.setAttribute('y2', compactY);
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
        skillLine.setAttribute('x1', compactX);
        skillLine.setAttribute('y1', compactY);
        skillLine.setAttribute('x2', csx);
        skillLine.setAttribute('y2', csy);
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