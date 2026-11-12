# Page Guide 06 — Patch & Preset Manager

**Portal Route**: `#/presets`  
**Primary Users**: Technical Managers, Senior Sound Technicians, Senior Lighting Technicians  
**Access Tier**: Restricted (Technical Managers, Senior Techs, and Admins only)

---

## 1. Executive Summary & Purpose

The **Patch & Preset Manager** controls audio console routing, digital stagebox configurations, and DMX lighting fixture profiles across Rich Mix's performance venues (*The Stage*, *The Studio*, and *The Mix*).

It allows sound engineers to create show-specific input/output patch sheets, save standard festival repatch templates, configure digital stageboxes (e.g. Midas S16, Behringer Wing), and manage DMX personality profiles for moving heads, LED parcans, profiles, and atmospheric units.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Creating an Audio Patch Sheet for a Band
1. Navigate to **Patch & Preset Manager** (`#/presets`).
2. Click **"New Patch Sheet"**.
3. **Event Association**:
   - Link to today's advanced event or create a standalone template.
   - Select Venue (*The Stage*, *The Studio*, or *The Mix*).
4. **Input Channel Mapping**:
   - Click **"Add Channel"** or load a standard band template (e.g. Standard 24-ch Band: Drums 1–8, Bass 9–10, Guitars 11–14, Keys 15–18, Vocals 19–24).
   - For each channel, specify:
     - `Channel #` (FOH / Monitor desk strip).
     - `Source / Instrument` (e.g., Kick In, Snare Top, Lead Vocal).
     - `Transducer / Mic` (e.g. Shure Beta 91A, SM58, Active DI).
     - `Stagebox Patch` (Stagebox 1: Ch 1–16, Stagebox 2: Ch 17–32).
     - `Phantom Power (+48V)` toggle.
     - `Stand Type` (Small Boom, Tall Boom, Clamp, Direct).
5. **Stage Repatches**:
   - If multiple acts perform, use the **Repatches** tab to map festival line changes (e.g. Act 2 swap channels 11–14).
6. Click **"Save Patch Sheet"**.
7. Click **"Print A4 Patch Sheet"** to generate laminated booth/stagebox sheets for house and guest engineers.

### Workflow 2.2: Managing DMX Fixture Personalities & Addressing
1. Switch to the **DMX Lighting Personalities** tab.
2. Search the Rich Mix fixture library (includes Robe Spiider, Robe Pointe, Chauvet Maverick Force S, COLORado 1-Quad, ETC Source Four LED, Astera Titan Tubes).
3. To add a new fixture:
   - Click **"Add Fixture Personality"**.
   - Enter `Manufacturer`, `Model`, `DMX Mode` (e.g. Mode 1 Standard 24ch), `Footprint` (channels), and `Category` (Moving Wash, Profile, LED Par).
4. Use the **DMX Patch Calculator** to auto-calculate dip switches and start addresses across universes without overlaps.

---

## 3. UI Component & Field Reference

### 3.1 Patch Sheet Builder
- **Stagebox Selector**: Toggles between Stage Left (Drop 1), Stage Right (Drop 2), and Drum Riser sub-snakes.
- **Phantom Power Checkbox**: Highlights in red (+48V) to warn against patching sensitive ribbon microphones.
- **Patch Point Dropdown**: Shows available physical XLR patch panel sockets on venue walls.
- **Home Run Matrix**: Visualizes Cat5/Cat6 digital multicore connections running between stage racks and FOH booth.

### 3.2 Presets Library
- **Recall Preset**: One-click recall of default house presets:
  - `The Stage — Standard Band 32-way`
  - `The Studio — Theatre / Spoken Word 16-way`
  - `The Mix — DJ / Corporate 8-way`
- **Duplicate & Edit**: Creates a new preset draft based on an existing show setup.

---

## 4. Troubleshooting & FAQ

- **Q: Why cannot Freelancers access this page?**  
  *A:* The Patch & Preset Manager alters venue-wide default routing templates and hardware media block profiles. To prevent accidental overrides during live handovers, editing is limited to staff Technical Managers and Senior Techs.
- **Q: Can patch sheets be saved to PDF for guest engineers?**  
  *A:* Yes. Clicking **"Print Patch Sheet"** formats a high-contrast tabular layout designed specifically for print-to-PDF or black-and-white clipboard printing.
