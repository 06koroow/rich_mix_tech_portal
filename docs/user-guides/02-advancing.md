# Page Guide 02 — Event Advancing

**Portal Route**: `#/advancing`  
**Primary Users**: Technical Managers, Senior Technicians, Production Coordinators  
**Access Tier**: Operational (all staff; restricted operations reserved for TM / Senior Tech)

---

## 1. Executive Summary & Purpose

The **Advancing** module manages the complete pre-production and day-of-show technical specifications for all events hosted at Rich Mix. It serves as the bridge between external artists, promoters, private hire clients, and the venue's house technical team.

Events are synchronized automatically from **Artifax** and enriched with technical input lists, stage layouts, microphone requirements, live schedules (get-in, soundcheck, doors, off-stage, get-out), lighting plots, cinema DCP parameters, and technician shift allocations.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Advancing a Live Music / Performance Event
1. Navigate to **Advancing** (`#/advancing`).
2. Locate the event in the chronological timeline or use the search bar (filter by space or date range).
3. Click the event card to open the **Event Advancing Modal / Drawer**.
4. **Step 1: Timing & Schedule**:
   - Set or confirm: `Load In`, `Soundcheck`, `Doors`, `Curfew`, and `Load Out`.
   - Click **"Add Schedule Item"** to construct the live schedule table (e.g., Support Act 20:00–20:45, Headline 21:15–22:45).
5. **Step 2: Technical Specs & Equipment**:
   - Select the **Floor Package** (e.g. Standard 4-Way Monitor Mix, Full Band Rig).
   - Enter PA, microphone, and backline requirements.
   - Upload or link the external artist rider / technical spec PDF.
6. **Step 3: Lighting & Visuals**:
   - Note any specific lighting presets, haze policies, or special effects.
7. **Step 4: Crew Allocation**:
   - Assign house staff (Lead Sound, Second Tech, AV Operator) from the technician dropdown.
   - If the artist is bringing their own crew, check the **"Guest Sound Engineer"** flag.
8. **Step 5: Status Update**:
   - Change the Advance Status from `Draft` / `Advancing` to `Confirmed`.
   - Click **Save Advance**. All assigned technicians immediately receive the updated specs.

### Workflow 2.2: Advancing an Auxiliary / Self-Service Space Event
- Events booked into auxiliary spaces (e.g. *The Lab*, *Cinema Bar*, *Foyer*, *Green Room*) default automatically to **"No Tech Needed — Self-Service"**.
- If a client requests tech support later, a Technical Manager or Senior Tech can change the status, assign a technician, and specify kit.

### Workflow 2.3: Advancing Cinema Screenings & Q&As
1. For events categorized as `Cinema` or located in `Screen One`, `Screen Two`, or `Screen Three`:
2. Expand the **Cinema & Screening Specifications** section.
3. Verify:
   - `Media Type`: DCP, Laptop via HDMI, Blu-Ray.
   - `Film Duration`: Run-time in minutes.
   - `Q&A Requirements`: Number of radio handheld mics, panel lectern, staging risers.
   - `Intermission`: Enable checkbox if an interval is programmed.
4. Saving automatically initializes or updates the corresponding screening in the **Pre-Screening Tracker**.

---

## 3. UI Component & Field Reference

### 3.1 Timeline & Filter Toolbar
- **Space Filter**: Filter events by space (*The Stage*, *The Studio*, *The Mix*, *Screen One*, *Screen Two*, *Screen Three*, etc.).
- **Category Filter**: *Programme*, *Cinema*, *Private Hires*, *Maintenance*, *DCP Test*.
- **Status Filter**: *Advancing*, *Confirmed*, *Complete*, *Cancelled*.
- **Sort by Date**: Guarantees events are ordered chronologically.
- **"Sync Artifax" Button**: Triggers an on-demand edge-function pull from the Artifax booking database.

### 3.2 Event Card Fields
- **Header**: Event Title, Artifax Event ID, Date, Space Badge.
- **Timing Row**: Start Time, Finish Time, Doors, Curfew.
- **Crew Avatars**: Photos and names of confirmed technicians.
- **Status Pill**:
  - `Draft` (Slate): Initial import from Artifax; tech details pending.
  - `Advancing` (Amber): Communication with artist/client active; requirements gathering in progress.
  - `Confirmed` (Green): Full tech specs verified; equipment prepped.
  - `Complete` (Blue): Event finished; handover logged.
- **Tech Summary**: Displays input count, PA spec, and floor package tags.

### 3.3 Event Advancing Modal
- **Field `Technical Notes & Requirements`**: Freeform operational details, power requirements, guest engineer contacts.
- **Field `Schedule Items`**: JSON-backed dynamic table storing time, duration, and activity name.
- **Field `Tech Spec File`**: Link to uploaded rider, stage plot, or patch sheet.
- **Button `Print Tech Sheet`**: Generates a clean A4 production run sheet for the sound and lighting desks.

---

## 4. Troubleshooting & FAQ

- **Q: An event was updated in Artifax, but the changes do not appear here.**  
  *A:* Click **"Sync with Artifax"** at the top right. The portal compares Artifax change timestamps and updates local records automatically without overwriting manual technical notes entered in the portal.
- **Q: How do I advance an event with multiple acts on the same night?**  
  *A:* In the Advancing modal, use the **Live Schedule Items** builder to add each act's load-in, soundcheck, and stage times sequentially.
