# Digital Cinema Package (DCP) Tracker & Cinema QC Console

A dedicated, high-precision Digital Cinema Package (DCP) management and Quality Control (QC) tracker for Rich Mix cinema technicians and projectionists. Automatically tracks screening DCPs across Screen One, Screen Two, and Screen Three, tracks KDM validity windows and server certificate matches, validates technical DCI specifications, and logs audio/visual QC sign-offs.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> Based on your confirmed choices in Phase 1, the DCP Tracker is architected with the following fundamentals:

- **Top-Level Navigation**: The tracker lives as a primary top-level navigation section (`#dcp` / "DCP Tracker") in the desktop sidebar and mobile navigation drawer, equipped with a dedicated cinema film icon.
- **Data Ingestion Model**: Dual-stream registry that automatically ingests scheduled cinema events from the `advancing` collection where `media_type === 'DCP'` or room is a cinema space, alongside a "+ Add DCP" modal for ad-hoc festival packages, distributor test reels, or Q&A media.
- **Inspection & QC Sign-off**: Detailed full-screen/modal QC console with structured tabbed sections (Core Metadata, Technical Specs, KDM & Server Ingest, Audio/Visual QC Sign-off) and 1-click status pills for rapid projection booth turnarounds.

---

### 1. Overview & Core Concept

- **What It Does**: Replaces fragmented whiteboard notes and verbal booth handovers with an authoritative digital registry for every DCP screened at Rich Mix. Projectionists can verify DCI naming conventions, validate CPL UUIDs, confirm KDM validity windows against specific server media blocks, test masking macros and DaVinci Resolve color matrix conversions, and sign off credit lighting offsets.
- **Target Audience / Persona**: Rich Mix Projectionists, Duty Technicians running cinema shifts, and Technical Managers overseeing multi-screen festivals, distributor previews, and private cinema hires.
- **Key Value**: Prevents black-screen incidents, KDM expiration mid-show, audio channel mapping misconfigurations (dialogue bleeding into surrounds), and incorrect aspect ratio macro firing (Flat vs. Scope).

---

### 2. User Experience & Visual Design

#### A. Top-Level Navigation & Layout
- **Sidebar Integration**: Added to `RMTP.nav` between `Advancing` and `Rota & Shifts` with the `film` icon.
- **Screen Viewport Baseline**: 1440px high-density engineering dashboard adhering to SaaS dashboard guidelines:
  - **KPI Metrics Strip** (4 metrics across):
    1. *Active Packages*: Total DCPs scheduled in the upcoming window.
    2. *QC Passed*: Verified packages ready for audience screening.
    3. *KDM Action Needed*: Packages with pending keys, expiring windows, or server certificate checks.
    4. *Ingest / Hash Alerts*: Failed hash checks or missing files requiring distributor redelivery.
  - **Filter & Search Bar**:
    - Quick screen switch: `All Screens`, `Screen One`, `Screen Two`, `Screen Three`.
    - QC Status filter: `All`, `Ready / Passed`, `Pending QC`, `KDM Alert`, `Hash Error`.
    - Search input: Real-time fuzzy filtering on DCI title, CPL UUID, or distributor.
    - Primary Action: `+ Ingest New DCP` button.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ DCP Tracker · Rich Mix Cinema Tech                               [ + Ingest New DCP ] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────┐ ┌───────────────┐ ┌─────────────────────────┐ ┌────────────────────┐ │
│ │ 12 Packages   │ │ 9 QC Passed   │ │ 2 KDM Windows Expiring  │ │ 0 Hash Corruptions │ │
│ └───────────────┘ └───────────────┘ └─────────────────────────┘ └────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [ Filter Screen: All ▾ ]  [ Status: All ▾ ]  [ Search title, CPL UUID, distributor... ] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Title / DCI Name        CPL UUID      Screen    Aspect  Res  Audio  KDM Window  QC Status  │
│ ──────────────────────  ────────────  ────────  ──────  ───  ─────  ──────────  ─────────  │
│ Film_FTR-1_F_EN-XX...   6b68e98c...   Screen 1  Flat    2K   5.1    Active      ✓ PASSED   │
│ Noir_FTR-2_S_FR-EN...   e8210bf1...   Screen 2  Scope   4K   7.1    Starts 18h  ⏳ PENDING │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### B. High-Density DCP Table View
- **Column 1 — Film & DCI Naming**: Full DCI string rendered in readable monospace font with copy button for Composition Playlist matching, linked to the advancing event and date.
- **Column 2 — Content & Runtime**: Content Type tag (`FTR`, `TLR`, `ADV`, `SHR`) with formatted timecode (`01:54:22`) and frame rate (`24fps` / `25fps` / `48fps HFR`).
- **Column 3 — Target Hardware**: Target screen and media block (e.g. *Screen 1 · Dolby IMS3000*, *Screen 2 · Doremi DCP-2000*, *Screen 3 · GDC SR-1000*).
- **Column 4 — Technical Specs**: Aspect ratio badge (*Flat 1.85:1* vs *Scope 2.39:1*), resolution (*2K* / *4K*), audio channel count (*5.1*, *7.1*, *Atmos*), and color space (*DCI-XYZ*).
- **Column 5 — Ingest & Hash**: Ingest progress/status (*Pass*, *Pending*, *Hash Failed*).
- **Column 6 — KDM Window**: Time-remaining countdown indicator with certificate target hardware match badge (*Hardware Match: Verified* vs *Mismatch Alert*).
- **Column 7 — QC Approval**: Pass / Fail / Pending badge, tested technician name, and credit lighting offset trigger.
- **Column 8 — Actions**: `[Inspect / QC]`, `[Edit]`, and `[Delete]`.

#### C. In-Depth Technical QC Inspection Modal
Clicking any row opens the full-screen / multi-column QC console divided into four clean panels:

1. **Panel 1: Core Metadata & Identification**:
   - Full DCI Naming Convention String (with quick parser for Title, Aspect, Language, Audio, Resolution, Facility, Package Type).
   - Composition Playlist CPL UUID (with 1-click UUID generator or clipboard paste).
   - Content Type (`Feature`, `Trailer`, `Advertisement`, `Short Film`).
   - Exact Duration (HH:MM:SS) & Screening Event Link.

2. **Panel 2: Technical Specifications & Macro Triggers**:
   - Aspect Ratio: `Flat (1.85:1)` vs `Scope (2.39:1)` with prompt for projector lens/masking macro preset.
   - Resolution & Frame Rate: `2K` / `4K` and `24fps` / `25fps` / `48fps (HFR)`.
   - Audio Mapping: `5.1 (L, R, C, LFE, Ls, Rs)`, `7.1 (L, R, C, LFE, Lss, Rss, Lsr, Rsr)`, `Dolby Atmos`, `Stereo (Lt/Rt)`.
   - Color Space & Gamma: `DCI-XYZ (DCI P3)` verification checkbox with warning note for DaVinci Resolve custom export gamma shifts.

3. **Panel 3: KDM & Server Ingest Management**:
   - Target Media Block & Server Serial: Screen 1, Screen 2, Screen 3 server selector with hardware serial cross-reference.
   - Ingest Status: `Pass / Verified`, `Ingesting`, `Corrupted Hash / Incomplete`, `Not Ingested`.
   - KDM Window: Start Date/Time and Expiry Date/Time with live status badge (Active, Pre-window, Expired).
   - KDM Certificate Match: Verification toggle confirming the supplied KDM certificate matches the target server's media block certificate.

4. **Panel 4: Quality Control (QC) Sign-off**:
   - Audio/Visual Checklist:
     - `[✓] Visual Framing & Masking`: Clean borders, zero optical spill onto auditorium masking.
     - `[✓] Center Channel Dialogue Anchor`: Speech is firmly routed to center horn with no phantom phase bleed.
     - `[✓] Subtitle Sync & Rendering`: Timed-text XML / PNG renders with proper font and zero lag.
   - Credit Offset Timecode: Exact offset (e.g. `01:48:15`) to trigger house lights up macro at end credits.
   - Fader Reference Level: Booth fader recommendation (e.g. `7.0`, `6.8`, `5.5`).
   - Tester & Sign-off: Projectionist/Technician selector, test timestamp, and overall approval status (`Passed`, `Passed with Caveats`, `Failed`, `Pending`).

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Auto-Sync Bridge from `advancing` to `dcps` Collection**:
  - *Chosen Approach*: When cinema events in `advancing` specify `media_type === 'DCP'` or are scheduled in cinema spaces, the system automatically materializes a corresponding linked DCP record in `dcps` if one does not exist.
  - *Why*: Eliminates dual data entry. Projectionists immediately see all upcoming DCP screenings populated with event title, screening space, date, run time, and initial tester assignments.
- **Decision 2: Standalone DCP Capability**:
  - *Chosen Approach*: Provide a "+ Ingest New DCP" button allowing manual entry independent of an advancing event.
  - *Why*: Meets the user's explicit preference; accommodates festival distributor screeners, test clips, and trailer reels tested prior to final event scheduling.
- **Decision 3: DCI Naming Convention Helper**:
  - *Chosen Approach*: Provide a built-in DCI syntax parser that automatically populates Content Type, Aspect Ratio, Audio Format, and Resolution when a projectionist pastes a standard DCI filename (e.g. `Movie_FTR-1_F_EN-XX_UK_51_2K_...`).
  - *Why*: Saves time, reduces human error, and reinforces industry-standard naming discipline in the booth.

---

### 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                     Rich Mix Navigation                         │
│   Dashboard  |  Advancing  |  DCP Tracker (#dcp)  |  Rota ...   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                        js/views/dcp.js                          │
│                                                                 │
│  ┌────────────────────────┐      ┌───────────────────────────┐  │
│  │ Auto-Sync Engine       │      │ Manual Entry Form         │  │
│  │ Scans `advancing`      │◄────►│ "+ Ingest New DCP"        │  │
│  │ where media === 'DCP'  │      │ Standalone / festival     │  │
│  └───────────┬────────────┘      └─────────────┬─────────────┘  │
│              │                                 │                │
│              └────────────────┬────────────────┘                │
│                               ▼                                 │
│                     `store` collection: 'dcps'                  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ High-Density DCP Table View                               │  │
│  │ - KPI summary cards (Total, Passed, KDM Alert, Hash Err)  │  │
│  │ - Screen tabs (All Screens, Screen 1, Screen 2, Screen 3) │  │
│  │ - Real-time title & CPL UUID search                       │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│              User clicks row or [Inspect / QC]                  │
│                               │                                 │
│  ┌────────────────────────────▼──────────────────────────────┐  │
│  │ In-Depth QC Inspection Modal                              │  │
│  │ - Core Metadata (DCI title, CPL UUID, type, runtime)      │  │
│  │ - Technical Specs (Flat/Scope, 2K/4K, 5.1/7.1, DCI-XYZ)   │  │
│  │ - KDM & Server (Target screen, window countdown, cert)    │  │
│  │ - QC Sign-off (Masking, Center anchor, Credits, Approval) │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### Data Model (`dcps` Collection)
```typescript
interface DcpPackage {
  id: string;                      // e.g. "dcp-evt123" or "dcp-manual-456"
  eventId?: string;                // optional link to advancing event
  dciTitle: string;                // e.g. "Movie_FTR-1_F_EN-XX_UK_51_2K_ST_20261023_FAC_IOP_OV"
  filmName: string;                // e.g. "Movie Title"
  cplUuid: string;                 // e.g. "urn:uuid:6b68e98c-8f4b-4b68-963b-61012b1d7d3b"
  contentType: 'Feature' | 'Trailer' | 'Ad' | 'Short' | 'Test Reel';
  duration: string;                // e.g. "01:54:22" or "114 min"
  
  // Technical Specifications
  screen: 'Screen One' | 'Screen Two' | 'Screen Three';
  aspectRatio: 'Flat (1.85:1)' | 'Scope (2.39:1)';
  resolution: '2K' | '4K';
  frameRate: '24fps' | '25fps' | '48fps (HFR)' | 'Other';
  audioFormat: '5.1' | '7.1' | 'Dolby Atmos' | 'Stereo (Lt/Rt)';
  colorSpace: 'DCI-XYZ' | 'Rec.709' | 'sRGB';
  colorNotes?: string;             // notes on DaVinci Resolve gamma shifts
  
  // KDM & Server Management
  targetHardware: string;          // e.g. "Screen 1 · Dolby IMS3000 (Serial: #IMS-84920)"
  ingestStatus: 'Pass' | 'Ingesting' | 'Fail' | 'Corrupt Hash';
  kdmRequired: boolean;
  kdmValidFrom?: string;           // ISO date string
  kdmValidTo?: string;             // ISO date string
  kdmTargetMatch: boolean;         // certificate matches hardware serial
  
  // Quality Control Sign-off
  avCheck: {
    maskingClean: boolean;         // visual masking macro matches ratio
    dialogCenterAnchored: boolean; // dialogue anchored to center horn
    subtitleSync: boolean;         // subtitle sync accurate
  };
  creditOffset?: string;           // e.g. "01:48:15" for lighting automation
  soundFaderLevel?: string;        // e.g. "7.0", "6.8"
  qcStatus: 'Passed' | 'Passed with Caveats' | 'Failed' | 'Pending';
  testedByUserId?: string;
  testedByUserName?: string;
  testDateTime?: string;
  qcNotes?: string;
  
  createdAt: string;
  updatedAt: string;
}
```

#### Step-by-Step Execution Plan
1. **Navigation Registration**:
   - Update `RMTP.nav` in `js/config.js` to insert `{ id: 'dcp', label: 'DCP Tracker', icon: 'film' }`.
   - Update `index.html` to load `<script src="js/views/dcp.js"></script>`.
   - Update `package.json` lint script to include `js/views/dcp.js`.
2. **Auto-Sync Engine**:
   - Query `store.all('advancing')` for cinema events with `media_type === 'DCP'` or screen space.
   - Synchronize with `store.all('dcps')`, preserving projectionist technical updates while reflecting changes from Artifax/Advancing schedules.
3. **Core DCP Tracker View (`js/views/dcp.js`)**:
   - Render KPI summary counter cards.
   - Render tabbed filter controls by Screen and QC Status.
   - Render high-density, tabular-numeric data table with color-coded status badges and countdown clocks.
4. **In-Depth QC Modal & DCI String Parser**:
   - Structured modal for editing and signing off all technical specifications.
   - Instant DCI string parser button that decomposes naming conventions into Content Type, Aspect, Audio, and Resolution automatically.
   - 1-click QC Pass/Fail toggle with credit offset and tester stamp.
5. **Advancing Integration**:
   - Add a direct "Open in DCP Tracker" shortcut button inside the View Advance modal for any cinema screening event.
6. **Verification**:
   - Test syntax with `npm run lint` (`lint_applet`).
   - Test build with `compile_applet`.
