# DCP QC Testing Workflow, 7-Criteria Sign-off & Branded PDF Reports

Enhance the Pre-Screening Tracker (`js/views/dcp.js`) with the official 7-parameter Rich Mix Cinema QC testing standard, automated outcome calculation with manual override, professional Rich Mix branded PDF generation, copyable email templates, and full Supabase backend persistence.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following operational preferences were confirmed in Phase 1 and govern the design:

- **Confirmed Decision 1 (Delivery Format)**: Provide **both** a downloadable high-fidelity Rich Mix branded PDF report and an in-browser ready-to-send copyable email template matching the client-facing templates in `QC_Testing_Email_Templates_686a260d.pdf`.
- **Confirmed Decision 2 (QC Outcome Logic)**: Automatically determine the overall QC outcome from the 7 criteria (any single Fail precipitates an overall **Fail**; any Caveats without Fail precipitate **Pass with Caveats**; all Pass yields **Pass**), while allowing technician manual override if booth conditions warrant.
- **Confirmed Decision 3 (Data Persistence)**: Ensure all criteria ratings, notes, sign-offs, and report metadata persist to the Supabase backend in the `dcps` and `reports` tables (via `RMTP.syncSb.drain()`), eliminating reliance on temporary browser cache.

---

## 1. Overview & Core Concept

Rich Mix cinema technicians run rigorous pre-screening QC checks across Screen 1, Screen 2, and Screen 3 before client screenings and festival runs. This update replaces the legacy simplified checklist with the standardized **7 Cinema QC Criteria** established in Rich Mix documentation:

1. **Ingestion & Integrity** (hash verification, transfer completeness)
2. **KDM Validation** (server serial certificate, valid time window)
3. **CPL Selection** (2D/3D, language, cut, naming accuracy)
4. **Visual Framing & Ratios** (Flat 1.85:1 vs Scope 2.39:1, screen masking alignment)
5. **Audio Mapping & Sync** (5.1/7.1 routing, lip-sync, cinema reference volume)
6. **Subtitles & Accessibility** (title safe area, CC/AD receiver sync)
7. **Playback Stability** (high-bitrate throughput, no dropouts, jitter or macroblocking)

At the conclusion of testing, technicians can generate a **Rich Mix Cinema QC Report** containing:
- Standardized Subject Header (`QC Test Results: [Film Name] - [OUTCOME]`)
- Official Rich Mix Cultural Foundation letterhead and registered charity footer
- Formatted summary table of all 7 categories with individual status badges and technical notes
- Tailored client action message (e.g. deadline for replacement drive/KDM on failure, or confirmation of screening on pass)
- One-click **Download PDF** and **Copy Email Text** buttons

---

## 2. User Experience & Visual Design

### Key User Flows

```
┌─────────────────────────┐     ┌──────────────────────────┐     ┌────────────────────────────┐
│  Pre-Screening Queue    │ ──> │   QC Sign-off Modal      │ ──> │   QC Report & Email Modal  │
│  - Film & Screen Info   │     │   - 7 Criteria Selector  │     │   - Branded PDF Preview    │
│  - Overall Outcome Tag  │     │   - Category Notes       │     │   - 1-Click "Download PDF" │
│  - "QC Sign-off" button │     │   - Auto-outcome trigger │     │   - "Copy Email to Buffer" │
│  - "View Report" button │     │   - Save & Sync to SB    │     │   - Client Send Confirmation│
└─────────────────────────┘     └──────────────────────────┘     └────────────────────────────┘
```

1. **Queue View**: Screenings display the current QC status badge (`Passed`, `Passed with Caveats`, `Failed`, `Pending`), test timestamp, and technician name. Screenings with completed tests show a direct **"QC Report"** button.
2. **Interactive 7-Criteria Sign-off Sheet**:
   - Each of the 7 categories features a 3-way segmented button group: **Pass** (Emerald), **Caveats** (Amber), and **Fail** (Crimson), with a default of **Pending**.
   - Under each category, an expandable or inline **Notes** field allows recording specific observations (e.g., "Flat container with 4:3 letterbox", "Stereo L/R mix only; fader set to 6.5").
   - Additional technical inputs: Picture Format (`Flat (1.85:1)` vs `Scope (2.39:1)`), Audio Format (`5.1 Surround`, `7.1 Surround`, `Stereo L/R`), and Client / Distributor Contact.
   - An **Auto-Calculate Banner** indicates the evaluated overall outcome with a toggle for manual technician override.
3. **Report Generation Modal**:
   - Tab 1: **Printable PDF Preview** rendering the official Rich Mix letterhead, metadata grid, 7-criteria matrix, outcome statement, and charity footer. Clicking **"Download / Print PDF"** triggers browser PDF generation with print stylesheets.
   - Tab 2: **Client Email Template** displaying the formatted email ready to be copied into Outlook/Gmail with recipient, subject, and signature. Clicking **"Copy Email Text"** writes to clipboard and displays an instant success toast.

### Visual Styling & Rich Mix Branding

- **Typography**: Clean sans display hierarchy (`Plus Jakarta Sans` / `DM Sans`) paired with monospace tabular figures (`font-mono tabular-nums`) for technical details, timestamps, and hardware serials.
- **Palette**: Dark slate booth interface (`#0B0F17` background, `#161D2B` panels) accented with Cinema Rich Mix red/crimson accents, crisp emerald for Pass (`#16A34A`), warm amber for Caveats (`#D97706`), and bold crimson for Fail (`#DC2626`).
- **PDF & Email Layout**: Matches the attached PDF documents verbatim: clean corporate white paper background, authentic Rich Mix header, 3-column table (`Category`, `Pass/Fail`, `Notes`), and Rich Mix Bethnal Green Road registered office footer.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: 7-Criteria Data Structure & Supabase Column Compatibility
- **Chosen Approach**: Store the 7 criteria inside a structured `qc_criteria` JSON object within the `dcps` record, while simultaneously updating standard top-level fields (`outcome`, `issuesNoted`, `mediaReceived`, `kdmCplReceived`, `tested`, etc.).
- **Why**: Supabase PostgreSQL tables might reject unmigrated column names with error `42703 (undefined column)`. By storing `qc_criteria` as JSON / composite payload while updating `issuesNoted` and `outcome`, the sync layer (`sync-supabase.js`) succeeds immediately without crashing, while preserving rich 7-parameter ratings across devices.
- **SQL Migration**: We will also update `docs/supabase-setup.sql` with `alter table public.dcps add column if not exists "qc_criteria" jsonb default '{}'::jsonb;` and `alter table public.dcps add column if not exists "clientName" text default '';` for permanent schema compliance.

### Decision 2: Client-Side PDF Generation Strategy
- **Chosen Approach**: Implement a zero-dependency HTML-to-print/PDF engine via a dedicated printable stylesheet and hidden iframe / print window, paired with optional `html2pdf.js`/canvas fallback.
- **Why**: Eliminates heavy external server dependencies, executes instantly in the browser without network latency, and produces pixel-accurate vector typography adhering strictly to the user's provided Rich Mix PDF template.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Pre-Screening Console                           │
│  js/views/dcp.js                                                       │
│  ├─ 7-Criteria Evaluation Matrix (Pass / Caveats / Fail / Notes)       │
│  ├─ Automated Outcome Engine (Fail > Caveats > Pass)                   │
│  ├─ Report Generator (PDF Renderer & Email Formatter)                  │
│  └─ Bi-directional Event Advancing Bridge (dcp <-> advancing)          │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                       Storage & Sync Layer                             │
│  js/store.js & js/sync-supabase.js                                     │
│  ├─ store.upsert('dcps', dcpRecord)                                    │
│  ├─ store.upsert('reports', qcReportRecord)                            │
│  └─ RMTP.syncSb.drain() ──> Supabase PostgreSQL ('dcps', 'reports')   │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Model Enhancements on `dcps`

```typescript
interface DcpRecord {
  id: string;                    // 'dcp-evt-...' or 'dcp-manual-...'
  eventId?: string;              // Linked Artifax advancing event
  eventName: string;
  filmTitle: string;
  screen: 'Screen One' | 'Screen Two' | 'Screen Three';
  mediaType: string;             // 'DCP', 'Laptop via HDMI', etc.
  eventDate: string;             // 'YYYY-MM-DD'
  clientName?: string;           // Client / distributor contact name
  pictureFormat?: string;        // 'Flat (1.85:1)' | 'Scope (2.39:1)'
  audioFormat?: string;          // '5.1 Surround' | '7.1' | 'Stereo'
  deadlineDate?: string;         // Deadline for revised delivery
  
  // 7 Standardized Cinema QC Parameters
  qc_criteria: {
    ingestion: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
    kdm: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
    cpl: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
    framing: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
    audio: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
    subtitles: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
    playback: { status: 'Pass' | 'Caveats' | 'Fail' | 'Pending'; notes: string };
  };

  outcome: 'Passed' | 'Passed with Caveats' | 'Failed' | 'Pending';
  outcomeManualOverride?: boolean;
  issuesNoted: string;
  tested: boolean;
  testedByUserId: string;
  testedByUserName: string;
  testDateTime: string;
  updatedAt: string;
}
```

---

## 5. Implementation Steps (To Be Executed Upon Approval)

1. **Update `js/views/dcp.js`**:
   - Define `RMTP.QC_CRITERIA_DEFINITIONS` with the 7 standardized criteria names, requirements, and test prompts from `Cinema_QC_Pass_Fail_Criteria_a8305426.pdf`.
   - Implement `calculateOverallQcOutcome(criteria)` auto-calculation function.
   - Refactor `openSignoffModal` to render the 7 criteria selection grid, Picture/Audio format dropdowns, Client Name, and real-time outcome indicator.
   - Build `openQcReportModal(dcp)` with:
     - **Branded PDF View**: Rich Mix Cultural Foundation header, summary table, action text, and Bethnal Green Road footer.
     - **Email Template View**: Formatted Subject line and greeting text with 1-click **Copy to Clipboard**.
     - **Download PDF**: Printable trigger generating clean PDF without UI clutter.
   - Add "QC Report" action button to desktop rows and mobile cards when a screening has been tested.
2. **Backend Persistence Hardening**:
   - Ensure every save immediately calls `store.upsert('dcps', dcp)`, updates `store.upsert('reports', reportItem)`, calls `syncDcpToAdvance(dcp)`, and drains to Supabase via `RMTP.syncSb.drain()`.
   - Update `docs/supabase-setup.sql` to include `qc_criteria` and client metadata columns.
3. **Verification**:
   - Run `lint_applet` and `compile_applet` to ensure zero compilation or syntax errors.
   - Test PDF generation and clipboard copying across desktop and mobile screen sizes.
