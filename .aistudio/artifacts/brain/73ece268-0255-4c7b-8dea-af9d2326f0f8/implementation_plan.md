# End-to-End Venue Operations Mapping & Process Streamlining Plan

A comprehensive architectural blueprint and operational roadmap to eliminate duplicate data entry, unify fragmented workflows, and establish seamless bi-directional data flow across all Rich Mix Technical Platform modules (Advancing, Rota, Pre-Screening, Maintenance, Inventory, Jobs, Venues, and Artifax/Supabase Sync).

---

### User Review & Critical Decisions

> [!IMPORTANT]
> Based on your confirmed choices in Phase 1, the systems optimization is architected around these core operational foundations:

- **Optimization Scope**: **Comprehensive end-to-end alignment across all venue modules** — Rather than optimizing one silo, data flow will be streamlined across the entire operational lifecycle: from Artifax event ingest and space requirements, to crew shift scheduling, cinema pre-screening QC, equipment maintenance dispatch, and end-of-shift reporting.
- **Data Synchronization Model**: **Automated background two-way sync with status change tracking** — Local state changes (advancing notes, crew sign-offs, equipment faults, screening outcomes) track dirty/revision flags and automatically sync with Supabase and prepare payloads for Artifax updates, maintaining a unified audit trail.
- **Change Propagation & Cascading Rule**: **Prompt for confirmation before updating linked jobs or shifts** — When an event time, date, or space changes (or when a screening format is altered), the system will calculate the downstream impact and present a clear confirmation dialog (e.g., *"Event moved to Screen One at 19:30. Update 2 linked Rota shifts and 1 Cinema QC task?"*) before mutating related records, preventing accidental schedule overwrites.

---

## 1. Overview & Core Concept

Rich Mix operates as a high-throughput multi-arts venue encompassing live concert spaces (The Stage, The Studio, The Mix), three digital cinema screens (Screen One, Screen Two, Screen Three), and public spaces (Streetside, Cinema Bar). 

Currently, technical teams must interact with separate modules for:
1. **Event Advancing** (`#/advancing`) — event tech riders, run orders, sound/lighting specs, and crew assignments.
2. **Master Rota & Shifts** (`#/rota`) — crew shift allocations, technician booking statuses (Pencil/Confirmed), and freelancer availability.
3. **Cinema Pre-Screening Tracker** (`#/dcp`) — media ingest, KDM validation, CPL checks, and projection QC sign-offs.
4. **Maintenance & Consumables** (`#/maintenance`) — equipment fault logging, repair tracking, and restock orders.
5. **Equipment Inventory** (`#/inventory`) — asset tags, kit condition, quantities, and storage locations.
6. **Jobs & Operational Tasks** (`#/tasks`) — centralized operational to-do lists, room prep, and follow-up actions.
7. **Venues & Spaces** (`#/venues`) — space specifications, audio I/O architecture, DMX patches, and minimum crew requirements.
8. **Shift Handover Reports** (`#/reports`) — end-of-night duty technician shift logs, sound readings, and incidents.

### The Problem: Fragmented Data & Replicated Effort
When an event or screening is scheduled, key data is currently re-typed or updated manually across up to four separate sections:
- **Screening Details**: Entered in Advancing Section 4, but separately checked and logged in the Pre-Screening Tracker.
- **Crew Staffing**: Space specs define minimum disciplines (e.g. 1x Sound, 1x Lighting), but the Advancing sheet requires manually picking technicians, and the Rota requires manually creating shifts for those same technicians.
- **Damaged Equipment & Consumables**: Techs record damaged gear in their End-of-Shift Report, then re-enter the fault in Maintenance, then create a task in the Jobs list to assign someone to fix it.
- **Inventory Condition**: Faults logged against an asset tag in Maintenance do not always automatically lock that item in the Inventory or prevent it from being allocated to a live show.

### The Solution: A Unified Bi-Directional Event & Operational Data Bus
This plan establishes a central data bus where:
- Single Source of Truth for each entity.
- Upstream changes intelligently cascade downstream with user confirmation.
- Downstream actions (e.g. completing a QC test or fixing a microphone) immediately reflect back on the parent event and equipment registry.

---

## 2. Complete Process & Data Flow Map

The diagram below maps how operational data currently moves through the application and highlights the target streamlined integration points.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   EXTERNAL SYSTEMS & INGESTION                                   │
│                                                                                                  │
│   ┌────────────────────────┐                    ┌────────────────────────────────────────────┐   │
│   │  Artifax Event System  │                    │  Distributor DCPs, KDMs & Drive Deliveries │   │
│   └───────────┬────────────┘                    └─────────────────────┬──────────────────────┘   │
└───────────────┼───────────────────────────────────────────────────────┼──────────────────────────┘
                │ (Artifax Ingest & Sync Edge Function)                 │ (Physical / Aspera / Signiant)
                ▼                                                       ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 CORE OPERATIONAL HUB (RICH MIX)                                  │
│                                                                                                  │
│   ┌────────────────────────────────┐         Prompt to Sync          ┌───────────────────────┐   │
│   │    1. ADVANCING EVENTS         │◄───────────────────────────────►│    2. MASTER ROTA     │   │
│   │  - Date, Times, Space          │     Shift Generation & Crew     │  - Shift Slots        │   │
│   │  - Technical Rider & Schedule  │                                 │  - Freelancer Avail   │   │
│   │  - Minimum Discipline Needs    │                                 │  - Bookings (Pencil)  │   │
│   └───────────┬────────────────────┘                                 └───────────┬───────────┘   │
│               │                                                                  │               │
│               │ (Cinema Space Check)                                             │ (Crew Tag)    │
│               ▼                                                                  ▼               │
│   ┌────────────────────────────────┐         1-Click Action          ┌───────────────────────┐   │
│   │  3. PRE-SCREENING TRACKER      │────────────────────────────────►│   4. JOBS & TASKS     │   │
│   │  - Media & KDM Reception       │      Follow-up Action Needed    │  - Operational To-Dos │   │
│   │  - Playlist & Subtitle Sync    │                                 │  - Tagged Techs       │   │
│   │  - QC Pass/Fail Outcome        │◄────────────────────────────────│  - Space Setup Prep   │   │
│   └───────────┬────────────────────┘         Status Sync             └───────────▲───────────┘   │
│               │                                                                  │               │
│               │ (QC Sync back to Advancing)                                      │ (Dispatch)    │
│               ▼                                                                  │               │
│   ┌────────────────────────────────┐                                 ┌───────────┴───────────┐   │
│   │      5. VENUES & SPACES        │                                 │   6. MAINTENANCE      │   │
│   │  - Audio I/O & DMX Patches     │                                 │  - Equipment Faults   │   │
│   │  - Space Inventory Allocation  │                                 │  - Consumables Order  │   │
│   │  - Discipline Headcounts       │                                 └───────────▲───────────┘   │
│   └───────────┬────────────────────┘                                             │               │
│               │                                                                  │ (Damaged Flag)│
│               │                                                                  │               │
│   ┌───────────▼────────────────────┐                                 ┌───────────▼───────────┐   │
│   │  7. END-OF-SHIFT REPORTS       │────────────────────────────────►│     8. INVENTORY      │   │
│   │  - Sound Levels & Incidents    │   Auto-spawns Fault & Job       │  - Asset Condition    │   │
│   │  - Space Handover Status       │   from Handover Report          │  - Location & Qty     │   │
│   └────────────────────────────────┘                                 └───────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Audit: Duplication, Replicated Tasks & Missing Bi-Directional Loops

### A. Cinema Screenings: Advancing (`#/advancing`) vs. Pre-Screening Tracker (`#/dcp`)
* **Current Redundancy**:
  - Advancing Section 4 captures "Cinema Screening & DCP Details" (Media format, audio format, aspect ratio, KDM notes, projectionist notes).
  - The Pre-Screening Tracker (`#/dcp`) separately maintains a `dcps` collection containing checkboxes for Media Received, KDM Received, Playlist Created, Audio/Sub Sync, Issues, and QC Outcome.
  - When a projectionist runs a QC test in the booth and flags an issue or signs off the film as "Passed", the Advancing sheet does not update its status. Conversely, if a producer changes the film format in Advancing, the booth projectionist might still be expecting a DCP.
* **Streamlined Bi-Directional Flow**:
  - **Shared Data Object**: When an event in Advancing is located in a cinema space (Screen One, Two, Three) or specifies `media_type === 'DCP' / 'Blu-Ray' / 'Laptop'`, it links to a single `dcps` record via `screeningId`.
  - **Auto-Syncing QC Status**: Marking "Media Received", "KDM Validated", or "Passed" in `#/dcp` immediately updates Advancing Section 4 and badges the event card on the Advancing dashboard.
  - **Change Prompt**: If the event date, screening time, or space changes in Advancing, the system prompts: *"Event moved to Screen Two at 20:00. Update the Pre-Screening QC card?"*

### B. Staffing & Rostering: Space Requirements vs. Event Crew vs. Master Rota
* **Current Redundancy**:
  - `venues.js` defines "Minimum Crew & Disciplines" (e.g. The Stage requires 1x Sound, 1x Lighting, 1x Stage Tech).
  - `advancing.js` Section 1 allows manual input of required crew headcount and assigning specific technician names.
  - `rota.js` requires managers to manually create shifts for that day and space, re-selecting the discipline, hours, and technicians.
  - If an event is cancelled, moved, or extended in Advancing, the Rota shifts remain unchanged unless the manager remembers to manually adjust them.
* **Streamlined Bi-Directional Flow**:
  - **Auto-Derive Shift Slots**: When an event is scheduled in a space, Advancing inherits the space's minimum discipline slots (e.g. `[Sound Tech]`, `[Lighting Tech]`).
  - **1-Click "Sync with Rota"**: Clicking "Generate / Sync Shifts" in Advancing pushes shift slots directly into `rota.js` matching the event call times (e.g., Event 19:00–23:00 $\rightarrow$ Shift 17:00–23:30 with 2h get-in/break).
  - **Roster Reflection**: When a technician is confirmed in Rota, their name automatically populates the Advancing event's crew roster.
  - **Change Detection Prompt**: If an event's times change in Advancing (or via Artifax pull), the system displays: *"Event call times changed from 18:00 to 17:00. Update 2 linked Rota shifts?"* with an approval prompt.

### C. Handover Reports vs. Maintenance Faults vs. Operational Jobs
* **Current Redundancy**:
  - At the end of a shift, technicians fill out an End-of-Shift report in `#/advancing` (`reports` collection), typing notes about faulty microphones, broken DMX cables, or empty haze fluid.
  - The technician must then separately go to `#/maintenance` to log a fault or consumable restock ticket.
  - Then someone must go to `#/tasks` to dispatch a technician to repair it.
* **Streamlined Bi-Directional Flow**:
  - **In-Report Action Dispatch**: Inside the End-of-Shift report modal, adding an equipment issue or consumable item features a checkbox: `[✓] Log as Fault & Dispatch Job`.
  - **Instant Multi-Record Creation**: Saving the report automatically creates the `maintenance` record, links the inventory asset, sets the asset condition to `Damaged`, and posts an actionable task in `tasks.js` assigned to the equipment lead.

### D. Maintenance Faults vs. Inventory Asset Status
* **Current Redundancy**:
  - When equipment is reported faulty in `#/maintenance`, the record exists in the maintenance table.
  - The item in `#/inventory` may still show condition "Good" unless the technician manually opens Inventory and edits the row.
  - A faulty item could inadvertently be allocated to another room's technical advance.
* **Streamlined Bi-Directional Flow**:
  - **Live Condition Lock**: When an asset tag is linked to an active fault in Maintenance, its Inventory condition automatically switches to `Damaged` / `Out of service` and its location reflects `Workshop / Repair`.
  - **Resolution Prompt**: When the maintenance task is marked "Resolved" in Maintenance or "Completed" in Jobs, the system prompts: *"Mark [Equipment Name] as 'Good' and return location to [Home Space]?"*.

### E. Freelancer Availability vs. Shift Offers vs. Rota Swimlanes
* **Current Redundancy**:
  - Freelancers submit day availability (All Day, Day, Night, or custom hours).
  - When managers create shifts on the Master Rota, they have to visually compare names against the availability matrix.
* **Streamlined Bi-Directional Flow**:
  - **Smart Availability Highlighting**: When clicking an empty shift slot on the Rota, the technician selector automatically sorts and badges users who are marked available for that exact date, space, and discipline.
  - **Instant Booking Lock**: When a shift is penciled or confirmed for a freelancer, that time block on their personal availability calendar displays as "Booked (Confirmed)", preventing double booking.

### F. Artifax Sync $\leftrightarrow$ Supabase $\leftrightarrow$ Local Store
* **Current Redundancy**:
  - Artifax pushes event data into Supabase `advancing` table.
  - Technicians enrich the event locally with custom technical riders, patch sheets, and notes.
  - Without automated change tracking, local technician modifications risk being overwritten by downstream Artifax sync updates.
* **Streamlined Bi-Directional Flow**:
  - **Revision & Field-Level Merge**: Artifax schedule fields (Title, Date, Time, Room, Category) sync automatically. Local technical fields (Sound Rider, Lighting Setup, Crew Assignments, QC Sign-off) are protected and marked with a dirty flag.
  - **Outbound Change Queue**: Changes made in the app that need to reflect in Artifax (e.g. technical sign-off status, event confirmed hours) are staged in an `artifax_outbound_queue` table ready for the Supabase Edge Function to push back.

---

## 4. User Experience & Visual Design

### A. The "Prompt-for-Confirmation" Change Cascade Interface
To honor the user's explicit preference (*"Prompt for confirmation before updating linked jobs or shifts"*), cascading changes will never silently mutate linked records without technician awareness.

Instead, a unified **Change Impact Modal** is displayed whenever an upstream modification occurs:

```
┌────────────────────────────────────────────────────────────────────────┐
│  Review Downstream Operational Updates                                 │
│  Event: "London Symphony Orchestra · The Stage"                        │
├────────────────────────────────────────────────────────────────────────┤
│  Upstream Change Detected:                                             │
│  Event times moved from 18:00 – 22:30  ➔  17:00 – 23:00 (+90 mins)     │
│                                                                        │
│  The following 3 linked operational records can be updated:            │
│                                                                        │
│  [✓] Rota Shift: Sound Engineer (Jane Doe)                             │
│      Update shift hours from 17:30–23:00 ➔ 16:30–23:30 (+1h)           │
│                                                                        │
│  [✓] Rota Shift: Lighting Operator (Sam Taylor)                        │
│      Update shift hours from 17:30–23:00 ➔ 16:30–23:30 (+1h)           │
│                                                                        │
│  [✓] Operational Job: "The Stage: Set up 40x Music Stands & DPA Mics"  │
│      Update task due time from 17:00 ➔ 16:00 (1h prior to get-in)      │
│                                                                        │
│  [ Keep Existing Schedules ]              [ Update Selected Records ]  │
└────────────────────────────────────────────────────────────────────────┘
```

### B. Visual Identity & Theme Tokens
The interface continues adhering to Rich Mix's high-contrast, production-grade technical console theme:
- **Canvas Neutrals (60%)**: Dark slate background (`#0B0F17` / `#0F172A`) with hairline 1px borders (`rgba(255,255,255,0.08)`).
- **Structural Surfaces (30%)**: Compact panel containers (`bg-panel` / `bg-panel2`), flat single-elevation cards, high-density data tables ($36\text{px}$–$40\text{px}$ row height).
- **Accent Budget (10%)**:
  - Emerald (`#10B981`): QC Passed, Shift Confirmed, Equipment Good.
  - Amber (`#F59E0B`): Shift Penciled, QC Caveats, Maintenance Pending.
  - Rose/Crimson (`#EF4444`): KDM Mismatch, Equipment Damaged, Shift Declined.
  - Indigo/Cyan (`#06B6D4` / `#6366F1`): Active Sync, Bi-directional Links.
- **Typographic Hierarchy**:
  - Display headers: `Plus Jakarta Sans` (18px–24px, SemiBold).
  - Body & Labels: `Public Sans` / `DM Sans` (12px–14px).
  - Telemetry & Numbers: Monospace tabular numerals (`font-mono tabular-nums`) for timecodes, serials, and dates.
  - Zero-pill metadata: Unboxed metadata tags separated by quiet `·` glyphs.

---

## 5. Technical Architecture & Data Strategy

### A. System Architecture & Inter-Module Bus

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT ARCHITECTURE (BROWSER)                                   │
│                                                                                                   │
│   ┌───────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              RMTP.bus (Event & Sync Dispatcher)                           │   │
│   │     - dispatches: 'rmtp:event-updated', 'rmtp:screening-qc', 'rmtp:fault-logged'          │   │
│   │     - checks: confirmation prompts before cascading updates                               │   │
│   └─────────────▲─────────────────────────────▲─────────────────────────────▲─────────────────┘   │
│                 │                             │                             │                     │
│   ┌─────────────┴──────────────┐┌─────────────┴──────────────┐┌─────────────┴──────────────┐      │
│   │ Advancing (`advancing.js`) ││ Master Rota (`rota.js`)    ││ Cinema QC (`dcp.js`)       │      │
│   │ Section 1: Crew Roster     ││ Swimlanes & Shifts         ││ Pre-Screening Checkboxes   │      │
│   │ Section 4: Screening Specs ││ Freelancer Day Avail       ││ KDM / CPL Validation       │      │
│   │ Section 5: Linked Jobs     ││ Auto-matching Techs        ││ Follow-up Action Creation  │      │
│   └─────────────┬──────────────┘└─────────────┬──────────────┘└─────────────┬──────────────┘      │
│                 │                             │                             │                     │
│   ┌─────────────┴──────────────┐┌─────────────┴──────────────┐┌─────────────┴──────────────┐      │
│   │ Jobs Queue (`tasks.js`)    ││ Maintenance (`maint.js`)   ││ Inventory (`inventory.js`) │      │
│   │ Central Action Queue       ││ Faults & Consumables       ││ Condition Lock & Store Loc │      │
│   │ Assignee & Tagged Crew     ││ Dispatched Job Bridge      ││ Barcodes & Asset Tracking  │      │
│   └─────────────┬──────────────┘└─────────────┬──────────────┘└─────────────┬──────────────┘      │
│                 │                             │                             │                     │
│                 └─────────────────────────────┼─────────────────────────────┘                     │
│                                               ▼                                                   │
│                                 `RMTP.store` (Local Storage)                                      │
│                                               ▲                                                   │
│                                               │ (Automated Background Sync)                       │
│                                               ▼                                                   │
│                              `RMTP.syncSb` (Supabase Real-Time Client)                            │
└───────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                │ (WebSocket / Postgres RPC)
                                                ▼
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   BACKEND SERVICES (SUPABASE)                                     │
│                                                                                                   │
│   ┌───────────────────────────┐  Edge Function   ┌────────────────────────────────────────────┐   │
│   │ Postgres DB Tables        │◄────────────────►│ Artifax Sync Edge Function                 │   │
│   │ (advancing, dcps, tasks,  │  Scheduled Cron  │ - Pulls new events & room bookings         │   │
│   │  bookings, inventory)     │                  │ - Pushes back technical notes & status     │   │
│   └───────────────────────────┘                  └────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### B. Entity Relationship & Linking Keys

| Entity | Primary Key | Linked Foreign Keys | Bi-Directional Synchronization Trigger |
| :--- | :--- | :--- | :--- |
| **Advancing Event** | `id` (e.g. `evt-101`) | `screeningId`, `space`, `artifaxId` | When time/space changes $\rightarrow$ Prompts to update linked `bookings` & `tasks` |
| **Cinema Screening** | `id` (e.g. `dcp-evt-101`) | `eventId`, `linkedTaskId`, `space` | When QC status changes $\rightarrow$ Updates Advancing Section 4 & completes `task` |
| **Rota Shift** | `id` (e.g. `sh-201`) | `eventId`, `technicianId`, `space` | When technician confirmed $\rightarrow$ Updates event crew roster in Advancing |
| **Maintenance Fault**| `id` (e.g. `fault-301`)| `itemId` (inventory), `jobId` (task)| When fault logged $\rightarrow$ Sets asset condition to `Damaged`; resolving restores `Good` |
| **Operational Job** | `id` (e.g. `task-401`) | `eventId`, `screeningId`, `maintenanceId` | When completed $\rightarrow$ Updates screening follow-up, resolves fault, or marks event prep |
| **Inventory Asset** | `id` (e.g. `inv-501`) | `location` (space), `faultId` | When allocated to space $\rightarrow$ Reflects in venue equipment inventory |
| **User Profile** | `id` (e.g. `user-601`) | `availability` (by date) | When shift booked $\rightarrow$ Marks calendar day/hours as `Booked` |

---

## 6. Implementation Phasing & Work Breakdown

### Phase 1: Cinema QC $\leftrightarrow$ Event Advancing Unification
- Connect `views/dcp.js` and `views/advancing.js` with shared screening states.
- When an event in Advancing is in Screen 1, 2, or 3, Section 4 renders a live mirror of the Pre-Screening Tracker card.
- Completing pre-screening checks in `#/dcp` instantly sets Advancing Section 4 status to "Passed".

### Phase 2: Advancing $\leftrightarrow$ Master Rota Bi-Directional Bridge
- Add "Generate Shifts from Space Specs" in Advancing Section 1, inheriting space headcount requirements from `views/venues.js`.
- Wire the Change Impact Modal: When an event date/time or space is edited in Advancing, prompt the user with a checkbox list to update linked Rota shifts.
- When a technician's shift is confirmed in Rota, auto-populate them into the Advancing event's confirmed crew.

### Phase 3: End-of-Shift Reports $\rightarrow$ Maintenance & Inventory Auto-Dispatch
- Add inline "Log as Fault & Dispatch Job" affordance to the Shift Report modal in `advancing.js`.
- Wire automatic asset condition locking: Reporting an inventory item as damaged marks it `Damaged` and moves location to `Workshop` in `inventory.js`.
- Resolving the fault or job prompts to restore asset condition to `Good`.

### Phase 4: Freelancer Availability & Smart Shift Booking
- Enhance the Rota shift assignment dropdown to automatically highlight and rank technicians who have marked themselves available for that specific date and discipline.
- When a shift is confirmed, automatically flag the user's personal availability calendar as `Booked`.

### Phase 5: Automated Two-Way Sync with Change Tracking
- Enhance `sync-supabase.js` with dirty-field tracking to ensure local technical notes and sign-offs are protected during Artifax pull cycles.
- Create an outbound staging queue for changes destined for Artifax push-back via the Supabase Edge Function.

---

## 7. Verification & Testing Strategy

1. **Syntax & Compilation Validation**:
   - Run `npm run lint` (`lint_applet`) across all modified view and sync files.
   - Run `compile_applet` to confirm zero build errors.
2. **Scenario Testing**:
   - **Scenario A (Cinema QC)**: Ingest a screening in `#/dcp` $\rightarrow$ verify it appears in `#/advancing` Section 4 $\rightarrow$ mark QC passed $\rightarrow$ confirm status reflected in both views.
   - **Scenario B (Shift Cascade Prompt)**: Change an event's times in Advancing $\rightarrow$ verify Change Impact Modal opens $\rightarrow$ confirm linked shifts in Rota update their start/end times upon approval.
   - **Scenario C (Handover Fault Dispatch)**: File an End-of-Shift report with damaged kit $\rightarrow$ verify `maintenance` record is created, asset in `inventory` is flagged `Damaged`, and a job appears in `tasks.js`.
   - **Scenario D (Job Completion Feedback)**: Mark a repair task completed in `#/tasks` $\rightarrow$ verify prompt to restore inventory condition and close the maintenance ticket.
