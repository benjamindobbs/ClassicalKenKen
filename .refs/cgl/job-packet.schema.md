# CGL job packet format (v1.2)

The CGL website exports a **job packet**: one JSON file per job. ClassicalKenKen imports it as a live job (a Work Event with `kind = 'job'`). This file is the contract between the two repos. Change it here first, then on both sides.

- **Owner:** ClassicalKenKen (CGL handoff §7). CGL-Website doesn't build the export yet.
- **Import:**
  - In the teacher app, go to **Work Events → Import Job Packet** and paste the JSON or pick the file.
  - Or call `POST /api/wbl/programs/:id/work-events/import` with the packet as the JSON body, or `{ "text": "<the JSON>" }`.
  - Teacher auth only. For now the integration is file-based (export, then import). Server-to-server auth can come later.
- **Code:** `server/wbl/packets.js`. Tests: `tools/test-wbl-shop.js`.
- **v1.1 (2026-10-29)** adds the CGL request form's apparel fields:
  - `product.garment_type` and `product.blank_url`;
  - a color count per design location (`placement[].colors`);
  - standard labels for location and garment type;
  - a quantity with no size, meaning a plain total.

  Every addition is optional, so a v1 packet still imports. The CGL side's build notes are in `HANDOFF-CGL-Website.md`.
- **v1.2 (2026-10-29)** adds what the CGL request form grew afterwards:
  - several garment colors in one job (`order.quantities[].color`);
  - a banner's or decal's finished size and surface (`product.size`, `product.surface`);
  - a location made by another method than the job's (`placement[].method`), whose color limit follows that method;
  - team rosters (`roster`) and locations that print each player's name and/or number (`placement[].name_number`).

  Again every addition is optional, so a v1.1 packet imports unchanged.

## Example

```json
{
  "job_number": "CGL-26-014",
  "is_house": false,
  "order":     { "customer": "Acme Band", "contact": "Jo Rivera", "due_date": "2026-11-14",
                 "quantities": [{ "size": "M", "qty": 12 }, { "size": "L", "qty": 8 }], "invoice_ref": "INV-0142" },
  "product":   { "type": "garment", "garment_type": "Tee-Shirt", "brand_style": "Gildan 5000", "blank_url": "",
                 "color": "Navy", "supplied_by": "ordered" },
  "process":   { "method": "screen", "ink_or_thread": ["PMS 286 C", "White"], "media_finish": "" },
  "placement": [{ "location": "Full Chest", "colors": 2, "size": "11 in wide", "from": "3 in below collar", "notes": "" },
                { "location": "Sleeve", "colors": "not_sure" }],
  "files":     { "drive_folder_url": "https://drive.google.com/drive/folders/…", "approved_art_url": "", "proof_url": "", "stitch_file_url": "" },
  "assessment":{ "roles_needed": ["job_lead", "buyer_receiver", "qc_inspector", "shipper", "photographer", "production"],
                 "machines": ["screen-press", "x-vactor-exposure"],
                 "suggested_skills": [{ "credential": "Silk Screening", "skill": "Single & Multi-Color Printing" }] }
}
```

A job ordered as one total quantity rather than by size uses `"quantities": [{ "qty": 120 }]`.

A team order (v1.2), abridged: two garment colors, a roster, and locations made by other methods than the job's screen printing.

```json
{
  "job_number": "CGL-26-001",
  "order":     { "customer": "Coach Rivera (Bulkeley HS)",
                 "quantities": [{ "size": "M", "qty": 1, "color": "Navy" }, { "size": "L", "qty": 1, "color": "Navy" },
                                { "size": "M", "qty": 1, "color": "White" }] },
  "product":   { "type": "garment", "garment_type": "Tee-Shirt", "color": "Navy, White" },
  "process":   { "method": "screen" },
  "placement": [{ "location": "Full Chest", "colors": 2 },
                { "location": "Full Back", "method": "dtf", "name_number": "name_number" },
                { "location": "Sleeve", "colors": 8, "method": "embroidery", "name_number": "number" },
                { "location": "Front Pocket", "method": "dtf", "name_number": "name" }],
  "roster":    { "name": "Varsity Soccer", "jersey_style": "female",
                 "players": [{ "name": "Reyes", "number": "12", "size": "M", "color": "Navy", "info": "" },
                             { "name": "Park", "number": "", "size": "M", "color": "White", "info": "Captain" }] },
  "assessment":{ "machines": ["screen-press", "mimaki-txf150", "heat-press", "ricoma-mt1501"] }
}
```

The 8-color sleeve is allowed because the sleeve is embroidered (limit 15), even though the job is screen printed (limit 4). Park has no number, so the import warns for Full Back and for Sleeve.

A decal uses `"product": { "type": "substrate", "size": "24 in x 12 in", "surface": "Window" }` with `"process": { "method": "solvent" }`.

## Fields

| Field | Type | Rule |
|---|---|---|
| `job_number` | string, ≤ 64 chars | **Required.** This is the identity of the job: it's stored as the event's `external_ref`, and re-importing the same number updates that job instead of creating a second one. |
| `is_house` | boolean | Marks a house (internal) job. Optional. |
| `order.customer`, `.contact`, `.invoice_ref` | string | Optional. The customer name starts the job's title. |
| `order.due_date` | `YYYY-MM-DD` | Optional. If present it must be a real date. It's shown to students as the due date. It doesn't close the job. |
| `order.quantities` | array of `{size?, qty, color?}` | Optional. If present it must be an array, and each `qty` must be a whole number ≥ 1; otherwise the import is refused. An entry with no `size` is a total for the job. Sizes are YS, YM, YL, YXL, XS, S, M, L, XL, 2XL, 3XL, 4XL; any other size imports with a warning. The sum of the quantities goes into the title. |
| `order.quantities[].color` | string | Optional (v1.2). The garment color this quantity is for. The job page groups quantities by color when any entry has one. |
| `product.type` | `garment` \| `substrate` | Optional. |
| `product.garment_type` | Tee-Shirt \| Long Sleeve Tee \| Crew Neck \| Pull Over \| Full Zip \| Polo \| `Other: …` | Optional. Any other value imports with a warning. Used in the title when there's no `brand_style`. |
| `product.brand_style`, `.color` | string | Optional. The blank's model name and the garment color. Used in the title. On a multi-color job `color` holds the colors joined with `", "`, e.g. `"Navy, White"`. |
| `product.size` | string | Optional (v1.2). A banner's, sticker's, decal's or sign's finished size, free text, e.g. `"3 ft x 6 ft"`. Used in a substrate job's title. |
| `product.surface` | Wall \| Window \| Floor \| Vehicle \| Sign \| `Other: …` \| `Not sure yet` | Optional (v1.2). Where a sticker, decal or sign goes. Any other value imports with a warning. |
| `product.blank_url` | `http(s)://` URL or empty | Optional. A link to the blank. **A non-web value refuses the import.** |
| `product.supplied_by` | `customer` \| `ordered` | Optional. |
| `process.method` | `screen` \| `dtf` \| `embroidery` \| `solvent` | Optional. Any other value imports with a warning. |
| `process.colors` | whole number ≥ 1, or `"not_sure"` | Optional, for one count for the whole job. Prefer `placement[].colors`. The same per-method maximum applies. Any other value **refuses the import**. |
| `process.ink_or_thread`, `.media_finish` | string array / string | Optional. Shown on the job page. |
| `placement` | array of `{location, method?, name_number?, colors?, size?, from?, notes?}` | Optional. If present it must be an array of objects; anything else refuses the import. |
| `placement[].location` | Full Chest \| Full Back \| Front Pocket \| Sleeve \| `Other: …` | Any other value imports with a warning. |
| `placement[].colors` | whole number ≥ 1, or `"not_sure"` | Optional. It's asked for screen printing and embroidery, not DTF. The maximum per location is **4** for `screen` and **15** for `embroidery`, by the location's own `method` if it has one, else `process.method`. Any other value, or a count over the maximum, **refuses the import**. |
| `placement[].method` | `screen` \| `dtf` \| `embroidery` \| `solvent` | Optional (v1.2). This location is made this way instead of by `process.method`, and its color limit follows. Any other value imports with a warning. The CGL site always sends `dtf` for names/numbers on Full Chest or Full Back, and `dtf` or `embroidery` on Front Pocket or Sleeve. |
| `placement[].name_number` | `name_number` \| `name` \| `number` | Optional (v1.2). This location prints each roster player's name and number, name only, or number only. Any other value imports with a warning, as does a name/number location on a packet with no roster, or a player missing the name or number a location prints (one warning per location). |
| `roster` | `{name, jersey_style, players[]}` | Optional (v1.2). Present only when the job has a team roster. A `roster` that isn't an object, `players` that isn't an array, or a player that isn't an object **refuses the import**. |
| `roster.name` | string | E.g. `"Varsity Soccer"`. |
| `roster.jersey_style` | `male` \| `female` | The jersey cut for the whole roster. Any other value imports with a warning. |
| `roster.players[]` | `{name, number, size, color, info}`, all strings | One per player. `number` may be empty. `info` is the coach's note, e.g. "Captain". What gets produced is `order.quantities`, which may include spares, not the player count. |
| `files.drive_folder_url`, `.approved_art_url`, `.proof_url`, `.stitch_file_url` | `http(s)://` URL or empty | **Any non-web link refuses the import**, because these are rendered as links. The Drive folder is the source of truth for files, and it's the "packet link" students see on their Today screen. |
| `assessment.roles_needed` | array of role codes | Shown on the job page. Codes not in the program's role list import with a warning. |
| `assessment.machines` | array of machine codes | Shown on the job page. Unknown codes import with a warning. |
| `assessment.suggested_skills` | array of `{credential, skill}` | Each pair is resolved through the credential's skills, the same way template skills are, and added to the job's planned skills. Pairs that don't resolve import with a warning. |

Unknown extra fields are kept in the stored packet and ignored.

## What an import does

- **New `job_number`:** creates a `kind = 'job'` Work Event.
  - It opens today.
  - Its title is the customer plus a short product description: total quantity, color, then the blank's model, else the garment type. For example, `Acme Band · 20 Navy Gildan 5000`, `Acme Band · 20 Navy Tee-Shirt` or `Coach Rivera (Bulkeley HS) · 3 Navy, White Tee-Shirt`. A substrate job with a `product.size` is titled by count, size and surface instead: `Acme Band · 4 × 24 in x 12 in (Window)`; an `Other: …` surface drops the prefix and `Not sure yet` is left out. A house job with no customer is titled `House job · …`.
  - The full packet is stored in `wbl_work_events.packet_json`, and the resolved suggested skills become its planned skills.
- **Existing `job_number`:**
  - Updates the title, the house flag and the stored packet, so roster changes come through. Nothing is tracked per player, so there's nothing to match up.
  - Adds any newly resolved suggested skills. It never removes planned skills, because the teacher may have added some.
  - Participants, status and dates are left alone.
- **The job page and the student's job card** show the packet, including a roster table: one row per player, plus a column per name/number location showing what's made there for that player (e.g. `REYES 12`), with a missing name or number flagged.
- **Machines** are whatever `assessment.machines` lists, across every method the job uses. Gate checks are per machine a participant runs, not per method.
- **Participants** are assigned after import in the teacher app, with the role and gate checks (CGL handoff §5–§6).
- **The response** is `{ id, created, title, warnings[], unresolved[] }`. On a refused import it's 400 `{ error, errors[] }`.

## The other direction

The CGL Job Sheet reads gate clearances from `GET /api/wbl/programs/:id/gates?student_id=…`, which returns `{ student_id, cleared: [{ machine_code, label, cleared_at, cleared_by, work_event_id }] }`. It should check this before assigning a machine task.
