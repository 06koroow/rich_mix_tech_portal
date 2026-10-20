# Unified Rota Timeline, Venue Staffing Disciplines & Streamlined Advancing

A comprehensive overhaul of shift management and event advancing for the Rich Mix Technical Portal: unifying venue-wide crew requirements into a single-page timeline with collapsible spaces, providing dedicated "No Tech Needed" self-service handling, and automating draft shift generation directly from event technical specs.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following key decisions were confirmed with the user in Phase 1 and govern this architecture:

- **Confirmed Decision 1: Single-Page Rota Architecture**: Instead of forcing users to switch tabs or filter room-by-room, the primary Rota & Shifts board will feature a **Unified Multi-Room Timeline Grid with Collapsible Space Rows**, giving technical managers and crew an instantaneous venue-wide view of all rooms, shifts, and staffing levels on one screen.
- **Confirmed Decision 2: "No Tech Needed" Self-Service State**: When a room, shift, or advancing event is designated as "No Tech Needed", all missing-crew alerts and understaffing warnings are suppressed. The session is visually designated as **Self-Service / Dark Room** with clear visual quietness, keeping the technician rota focused on events that actually require physical staffing.
- **Confirmed Decision 3: Advancing-to-Shift Workflow Streamlining**: Eliminate duplicate data entry by introducing an **Auto-Generate Draft Shifts** engine. Technical specifications agreed during advancing (roles, call times, and discipline breakdowns) can be converted directly into scheduled shift bookings with a single click, or synced automatically to the live rota.
- **Confirmed Decision 4: Cross-Site Venue Discipline Enforcement**: The minimum crew headcount and discipline breakdowns configured on the Venues & Spaces page (Sound, Lighting, Cinema, AV, Stage, Support, Duty Manager) will carry through automatically to Advancing, the Booking Modal, and the Unified Timeline.

---

### 1. Overview & Core Concept

- **What It Does**: Provides technical managers, venue duty managers, and freelance technicians with an integrated, cohesive scheduling environment. Venues define exact baseline crew disciplines; advancing events inherit these specifications or customize them; the rota presents an all-in-one timeline across all spaces with collapsible rows; and shifts can be auto-generated without manual re-entry.
- **Target Audience / Persona**:
  - *Technical Managers*: Advancing complex productions, reviewing multi-room takeovers, monitoring crew gaps, and generating rosters.
  - *Duty Engineers & Lead Techs*: Checking venue-wide staffing on the night, identifying who is on FOH sound or lighting in which room.
  - *Freelancers & Technicians*: Viewing their scheduled call times and seeing room technical requirements in advance.
- **Key Value**: Replaces fragmented multi-tab browsing and manual shift duplication with an automated, synchronized workflow where venue specifications dictate staffing needs and advancing directly populates the operational rota.

---

### 2. User Experience & Visual Design

#### Key User Flows
1. **Configuring Room Minimum Crew (Venues & Spaces)**:
   - Technical manager navigates to *Venues & Spaces*.
   - In the *Minimum Crew & Disciplines* panel, manager selects baseline roles (e.g. The Stage: `1x Sound, 1x Lighting, 1x Stage`) using quick-add chips and steppers.
   - Updates persist immediately across the application with visual tags in the venue list sidebar and summary pills.
2. **Advancing an Event with Staffing Requirements**:
   - Manager or producer opens an event in *Advancing*.
   - A new staffing toolbar provides options: "Auto-Populate from Venue Specs", "+ Add Technician", or toggle **"No Tech Needed"**.
   - If "No Tech Needed" is toggled, crew headcount warnings disappear, self-service notes appear, and the event is tagged as self-managed.
   - For events with tech needs, a prominent action button **"Generate Rota Shifts from Tech Specs"** creates draft bookings for the rota in one step.
3. **Managing the Unified Multi-Room Rota**:
   - Manager navigates to *Rota & Shifts*.
   - The default Master Board presents the **Unified Multi-Room Timeline Grid**:
     - A pinned time ruler (e.g. 08:00 to 00:00) sits atop the grid.
     - Each venue space (The Stage, Studio 1, Studio 2, Cinema 1, Cinema 2, Cinema 3, The Boardroom, Lower Cafe) is represented as a dedicated collapsible row.
     - The row header displays the space name, color accent, minimum crew spec (e.g., `Min: 2 · Sound, Lighting`), and real-time fulfillment status (`Filled`, `1 Unfilled`, or `Self-Service`).
     - Within the row, horizontal event blocks depict start and finish times, assigned crew members with their discipline chips, or a clean self-service badge.
     - Clicking any unfilled slot or "+ Add Shift" in the row opens the Shift Booking Modal pre-populated with that room and its missing discipline.
4. **Booking Modal with "No Tech Needed"**:
   - In the Shift Booking Modal, a prominent toggle or technician selection item **"No Tech Needed (Self-Service)"** is available.
   - Selecting this suppresses the need for an assigned technician and marks the shift as a self-managed venue block.

#### Visual Identity & Theme
- **Aesthetic Direction**: High-density, utilitarian SaaS scheduling console following anti-slop visual discipline: clean hairline borders, single-elevation surfaces, and zero unnecessary decorative badges.
- **Color Palette & Mood**:
  - Dominant Neutral: Dark slate background (`#0B0F17` / `#131B2A`) and structured surface panels (`#1A2333` / `#222E42`).
  - Text & Accents: Crisp white for primary text (`#F8FAFC`), subdued slate for labels (`#94A3B8`), and vibrant amber/cyan accents for active states (`#F59E0B` / `#06B6D4`).
  - Semantic Status:
    - *Filled / Nominal*: Emerald green (`#10B981`) text and subtle emerald border.
    - *Unfilled Crew Gap*: Warm amber (`#F59E0B`) with subtle call-to-action button.
    - *No Tech Needed / Self-Service*: Quiet muted slate (`#64748B`) with clear italicized text label (no alarmist warning colors).
- **Typography & Hierarchy**:
  - Display & Headers: Contemporary sans-serif (`Plus Jakarta Sans` / `Outfit`) for crisp section titles and room headers.
  - Body & Form Controls: Legible prose at 12px–14px (`DM Sans`).
  - Timeline & Metrics: Monospace tabular numerals (`font-mono tabular-nums`) for exact call times, shift durations, and crew totals.
- **Zero-Pill Discipline**:
  - Metadata (counts, times, room disciplines) rendered as clean unboxed text separated by subtle middots (`·`) rather than nested colored pills.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unified Timeline Grid vs. Tabbed Switching**:
  - *Chosen Approach*: Replace the fragmented workflow (having to tab through individual days or toggle between spaces) with a unified multi-room timeline board where all spaces are visible simultaneously on a single master page, each collapsible on demand.
  - *Why*: Eliminates context switching; technical managers can instantly spot scheduling clashes or unstaffed rooms across the entire venue at a single glance.
  - *Alternatives Considered*: Multi-tab carousel was deemed cumbersome and prone to missing understaffed spaces in secondary rooms.
- **Decision 2: Dedicated "No Tech Needed" Semantic Entity**:
  - *Chosen Approach*: Treat "No Tech Needed" as a first-class status across advancing events, space rosters, and shift bookings rather than leaving fields blank.
  - *Why*: In a live venue, an unassigned slot could either mean a critical staffing shortfall or an intentional dry hire / self-managed screening. Explicitly marking "No Tech Needed" disambiguates this and suppresses alarming red/amber warning badges.
  - *Trade-off*: Requires small additions to the booking and technician schema, but provides 100% clarity.
- **Decision 3: Direct Draft Shift Generation from Advancing**:
  - *Chosen Approach*: Provide a 1-click generation tool that reads an advancing event's required disciplines and timings and creates matching draft bookings in the rota store.
  - *Why*: Saves technical staff from re-entering the event name, date, start time, finish time, and required roles twice (once in advancing and once in shifts).
  - *Safety Guard*: Generated shifts are marked as draft/pencil holds so technical managers can review and assign specific freelancers before publishing.
- **Decision 4: Venue Staffing Discipline Inheritance**:
  - *Chosen Approach*: `RMTP.getSpaceCrewSpecs(spaceName)` acts as the single source of truth across the entire app. If an event is created in "The Stage", it automatically defaults to The Stage's configured disciplines (`Sound`, `Lighting`, etc.) unless specifically customized.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        RICH MIX TECH PORTAL                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   [ Venues & Spaces ]           [ Advancing ]         [ Rota & Shifts] │
│           │                           │                      │         │
│   Define Minimum Crew        Specify Event Tech      Unified Timeline  │
│   & Disciplines              & "No Tech Needed"      Collapsible Rows  │
│           │                           │                      │         │
│           └───────────────────────────┼──────────────────────┘         │
│                                       ▼                                │
│                     ┌───────────────────────────────────┐              │
│                     │       RMTP Shared Services        │              │
│                     │  ───────────────────────────────  │              │
│                     │  • RMTP.getSpaceCrewSpecs(space)  │              │
│                     │  • RMTP.syncAdvancingToRota(ev)   │              │
│                     │  • RMTP.eventTechnicians(ev)      │              │
│                     └───────────────────────────────────┘              │
│                                       │                                │
│                                       ▼                                │
│                     ┌───────────────────────────────────┐              │
│                     │       Client State & Store        │              │
│                     │  ───────────────────────────────  │              │
│                     │  • store.all('venues')            │              │
│                     │  • store.all('advancing')         │              │
│                     │  • store.all('bookings')          │              │
│                     │  • store.all('availability')      │              │
│                     └───────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────────────┘
```

#### Detailed System Interactions & State Changes

1. **Venues Data Model (`store: 'venues'`)**:
   - Entity: `{ id, name, basicCrew, crewDisciplines: [{ role: 'Sound', count: 1 }, { role: 'Lighting', count: 1 }], ... }`
   - Real-time updates trigger custom event `rmtp:venues-updated`, notifying the rota and advancing modules to refresh cached room specs.

2. **Advancing Data Model (`store: 'advancing'`)**:
   - Added fields:
     - `noTechNeeded: boolean` — when `true`, suppresses all staffing gap notifications.
     - `technicians: [{ role, userId, freelancerName, startTime, finishTime, isNoTech }]`
   - Added Action: `Generate Rota Shifts` — queries the event's technician requirements and creates matching entries in `store: 'bookings'`.

3. **Rota Data Model & Unified Timeline (`store: 'bookings'`)**:
   - Added support for `isNoTech: boolean` on bookings.
   - Master View: **Unified Multi-Room Timeline Grid**:
     - Space Rows: Sorted by venue footprint or custom order.
     - Collapsible state persisted in `RMTP._rotaState.collapsedSpaces`.
     - Timeline intervals calculated from min/max event hours or standard 08:00–00:00 range.
     - Single-page view shows all rooms simultaneously with instant filter toggles (e.g. "Only Unfilled Gaps", "Hide Self-Service").
   - Booking Modal:
     - Includes "No Tech Needed (Self-Service)" option in the technician selector.
     - Displays live room staffing requirements banner with 1-click discipline role assignment.

---

### 5. Implementation Stages & Verification Strategy

- **Stage 1**: Verify and finalize the cross-site propagation of venue crew specifications from `venues.js` and `config.js` into advancing and rota helpers.
- **Stage 2**: Enhance `advancing.js` with the explicit "No Tech Needed" toggle and the "Generate Rota Shifts from Tech Specs" automation tool.
- **Stage 3**: Build the **Unified Multi-Room Timeline Grid** in `rota.js` with collapsible space rows, replacing the need to tab through separate views, and integrate "No Tech Needed" self-service handling into the schedule items and booking modal.
- **Stage 4**: Verify all interactive controls, state persistence, shift creation, and build integrity using `compile_applet`.
