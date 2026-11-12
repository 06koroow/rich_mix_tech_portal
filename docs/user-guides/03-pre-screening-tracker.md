# Page Guide 03 — Pre-Screening Tracker & Cinema QC Console

**Portal Route**: `#/dcp`  
**Primary Users**: Cinema Technicians, Projectionists, Duty Techs, Technical Managers  
**Access Tier**: Staff Only (restricted from Freelancers)

---

## 1. Executive Summary & Purpose

The **Pre-Screening Tracker & Cinema QC Console** is Rich Mix's standardized quality control system for theatrical screenings across **Screen One**, **Screen Two**, and **Screen Three**.

Built to comply with professional DCI exhibition and BFI/distributor technical standards, the console tracks every screening through a rigorous **7-Point Quality Control Checklist**, auto-calculates sign-off verdicts, allows technician overrides, captures booth observations, and automatically generates branded **PDF QC Reports** and formatted **Client Notification Emails**.

---

## 2. The 7 Standardized QC Evaluation Criteria

Every screening tested in the projection booths must be evaluated against these 7 defined criteria:

| # | QC Category | Requirement | Pass Rule |
|---|---|---|---|
| **1** | **Ingestion & Integrity** | Complete asset transfer with zero hash/bitstream errors | Media block verifies XML/MXF assets without corrupt packets or hash mismatches. |
| **2** | **KDM Validation** | Cryptographic key window valid for test and screening | KDM validity window covers test time and showtime; target Media Block certificate verified. |
| **3** | **CPL Selection** | Correct feature cut, version, language, and subtitles | Correct composition playlist selected (e.g. Theatrical vs Festival cut, Ov vs Subbed). |
| **4** | **Visual Framing & Ratios** | Matching container and screen masking without cropping | Clean picture framing at 1.85:1 (Flat) or 2.39:1 (Scope) with proper masking and no letterbox pillar anomalies. |
| **5** | **Audio Mapping & Sync** | Dialogue anchored to Centre channel, clean surround balance | Dialogue correctly routed to Centre speaker, L/R balance verified, lip-sync latency within &plusmn;1 frame. |
| **6** | **Subtitles & Accessibility** | Timed text render, font legibility, HOH/HI & VI-N tracks | Subtitles render cleanly within safe title area; closed captions or audio description active if programmed. |
| **7** | **Playback Stability** | Seamless playback across reel splits, no stutter or drops | Smooth continuous playback across composition boundaries without frame drops or audio pops. |

---

## 3. Core Workflows (Step-by-Step)

### Workflow 3.1: Performing a DCP Booth Quality Control Test
1. Navigate to **Pre-Screening Tracker** (`#/dcp`).
2. Locate the screening row or card for the film being tested.
3. Click on the **QC Report & 7-Point Checklist** block:
   - *Intelligent Routing*: If the screening is not yet signed off, clicking immediately opens the **Cinema QC Sign-Off Questionnaire (Edit Screen)**.
4. **Fill Out the 7-Point Evaluation**:
   - For each of the 7 criteria, click **PASS**, **CAVEATS**, or **FAIL**.
   - *Shortcut*: Click **"Mark All 7 Passed"** at the top right if the full ingest and playback check ran with zero issues.
   - Enter specific observations in the notes field for any category marked with Caveats or Fail (e.g., "Left surround level 2dB lower; compensated on fader").
5. **Technician Issues & Notes**:
   - Enter any booth observations, framing adjustments, or optical port comments in the dedicated text input field.
   - *Note*: This field is completely decoupled from Artifax event descriptions, ensuring only genuine technical remarks enter the report.
6. **Overall QC Outcome**:
   - The outcome auto-calculates based on your 7 marks:
     - All 7 Pass &rarr; **Passed** (Green)
     - Any Caveats (no Fails) &rarr; **Passed with Caveats** (Amber)
     - Any Fail &rarr; **Failed** (Red)
   - *Manual Override*: If professional judgement dictates (e.g. minor subtitle timing flaw acceptable for private hire), check **"Manual Outcome Override"** and select the desired status.
7. **Sign-off**:
   - Verify your name in the **Tested By** dropdown and confirm the **Test Date & Time**.
8. **Further Actions**:
   - If distributor contact or booth follow-up is needed, check **"Yes, further action required"** and enter the action. This automatically logs a linked task in **Jobs & Tasks**.
9. Click **"Save Pre-Screening Sign-off"**.

### Workflow 3.2: Generating & Exporting the PDF QC Report
1. Once signed off, click the **QC Report** button or block on the screening.
2. The **Official Cinema QC Report & Client Email** modal opens.
3. **Review the Report**:
   - Inspect the official Rich Mix Cultural Foundation header, screening metadata, 7-point evaluation table, and technician sign-off block.
4. **Export / Print PDF**:
   - Click **"Print / Download PDF Report"**.
   - The system triggers a clean, professional print view formatted specifically for A4 portrait export (save to PDF or print hard copy).
5. **Send Client Email Notification**:
   - Switch to or scroll to the **Client Notification Email** section.
   - Review the auto-generated email text formatted according to Rich Mix distribution standards (Passed, Caveats, or Re-Delivery Required).
   - Click **"Copy Email to Clipboard"** to paste directly into your email client.

### Workflow 3.3: Resolving Duplicate Screenings
1. If multiple screenings of the same title exist on the same date, a yellow **Duplicate Screening Detected** pill appears.
2. Click **"Merge"** or open the duplicate group banner.
3. The system consolidates duplicate entries into a single authoritative screening record, preserving all checklist progress and technician notes.

---

## 4. UI Component & Field Reference

### 4.1 Main Table Columns
- **Media & Advance**: Displays target media block (`Screen 1 Media Block`, etc.), media type selector, and screening date/time.
- **Film & Screening**: Film title, duplicate badge, tested technician name, and test timestamp.
- **QC Report & 7-Point Checklist**:
  - Interactive block summarizing the 7 criteria with colored indicator dots.
  - Clicking opens the **Edit Questionnaire** (if pending) or the **Finalized QC Report** (if signed off).
- **Technician Issues & Notes**: Inline text input allowing quick note edits that auto-save on blur or Enter.
- **Outcome**: Status selector (`Pending`, `Passed`, `Passed with Caveats`, `Failed`) with live colored badge.
- **Further Action / Task**: Linked Jobs & Tasks pill showing job ID and completion status.
- **Actions Column**:
  - `QC Report` / `Edit QC`: Opens report viewer or edit questionnaire.
  - `Sign-off`: Opens the full modal questionnaire.
  - `Trash Icon`: Removes screening record after confirmation.

---

## 5. Troubleshooting & FAQ

- **Q: Why does clicking "QC Report" open the edit screen instead of the report?**  
  *A:* By design, until a screening is tested and signed off, clicking the QC report block directs the technician directly into the Questionnaire so the test can be performed first. Once signed off, it opens the formal report.
- **Q: A client sent a replacement DCP after a failure. How do I re-test?**  
  *A:* Open the screening, click **"Edit Checklist / Retest"**, update the affected categories (e.g. Ingestion and KDM to Pass), clear or update technician notes, and re-save. The outcome updates immediately to Passed and a new QC report can be issued.
