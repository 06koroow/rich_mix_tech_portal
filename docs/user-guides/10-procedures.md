# Page Guide 10 — Standard Operating Procedures (SOPs) & Health & Safety

**Portal Route**: `#/procedures`  
**Primary Users**: All Staff, Freelancers, Apprentices, Health & Safety Officers  
**Access Tier**: Universal View (Sign-offs granted by certified Trainers and Technical Managers)

---

## 1. Executive Summary & Purpose

The **Procedures** module houses the official Standard Operating Procedures (SOPs), venue checklists, and Health & Safety compliance guidelines for Rich Mix.

It provides step-by-step sequences for venue opening, late-night venue closing, audio PA power-up and shutdown, lighting console startup, projector alignment, fire evacuation, working at height, and electrical safety (PAT). Furthermore, it tracks **Competency Sign-offs**, ensuring technicians are formally signed off by certified Trainers before operating high-risk venue machinery.

---

## 2. Master SOP Catalog

The portal categorizes procedures into 6 core operational domains:

### 2.1 Opening & Closing
- **Venue Opening Checklist (`venue-open`)**: Building unlock, emergency exits clear, fire panel check, house lighting presets, comms check.
- **End-of-Night Shutdown (`night-close`)**: Audio amps down first, lighting desks saved and parked, screen shutters closed, projector lamps cooled before mains cut, fire doors secure.

### 2.2 Sound Procedures
- **PA Power-up Sequence (`pa-powerup`)**: Essential order: Consoles first &rarr; DSP / processing &rarr; Amplifiers last. Prevents damaging speaker thumps.
- **FOH Desk (dLive / Wing) Startup (`foh-dlive`)**: Show file loading, clock synchronization, stagebox link check, gain structure calibration.
- **Monitor World Setup (`monitors`)**: IEM wireless frequency coordination, wedge routing, feedback suppression ringing.
- **Radio Frequency (RF) Management (`rf-management`)**: Sennheiser wireless mic frequency scanning, intermodulation avoidance, battery replacement standards.

### 2.3 Lighting Procedures
- **Lighting Desk Startup (`lx-startup`)**: Avolites / ETC desk booting, universe DMX node link verification, fixture homing.
- **House Lights & Presets (`house-lights`)**: Architectural dimmer overrides, cleaner states, show states.
- **Haze & Atmospheric FX (`haze`)**: Look Solutions hazer warm-up, venue smoke detector isolation protocol, extraction clearance.

### 2.4 AV & Presentation Procedures
- **Cinema & Conference Projector Setup (`projector`)**: Panasonic / Christie lamp striking sequence, optical port inspection, input aspect ratio scaling.
- **Patching Laptop / HDMI (`patching`)**: Extron / Kramer matrix switching, EDID handshake troubleshooting, audio embedder verification.
- **Hybrid & Streamed Event Setup (`hybrid`)**: Video switcher inputs, presentation audio delay sync, return monitor feeds.

### 2.5 Stage & Rigging Procedures
- **Stage Build & Get-In (`get-in`)**: Stage deck locking clamps, leg safety pins, handrail installation.
- **Rigging & Flying Points (`rigging`)**: Safe Working Load (SWL) verification, secondary safety bonds on all flown fixtures, shackle mouse wires.
- **Get-Out Procedure (`get-out`)**: Cable coiling standards, flightcase packing, stage clearance.

### 2.6 Health & Safety (Mandatory Compliance)
- **Fire & Evacuation Procedure (`evac`)**: Alarm responses, assembly points (Bethnal Green Road), roll-call duties.
- **Working at Height (`height`)**: Tallescope inspection, ladder 1-in-4 rule, harness and lanyard requirements.
- **Manual Handling (`handling`)**: Two-person lifts for flightcases over 20kg, ramp protocols.
- **Incident Reporting (`incident`)**: Immediate reporting protocol for near-misses, injuries, or structural hazards.
- **Electrical Safety & PAT (`pat`)**: Visual cable checks, testing schedules, damaged lead quarantine.

---

## 3. Competency Sign-Offs & Qualifications

To guarantee safety and equipment longevity, certain technical roles require verified sign-offs:
- **Trainee / Duty Technician**: Reviews the procedure, demonstrates practical execution to a certified **Trainer** or **Technical Manager**.
- **Trainer Sign-off**: The Trainer logs into the portal, opens the procedure, and clicks **"Sign Off Competency"**.
- The portal records:
  - Technician Name & ID.
  - Trainer Name & Verification Timestamp.
  - Expiry / Refresher schedule.

---

## 4. Troubleshooting & FAQ

- **Q: Who has authority to sign off competency?**  
  *A:* Only users with the `trainer: true` or `admin: true` flag set in **Users & Permissions** can grant competency sign-offs.
- **Q: Can procedures be printed for clipboard use during venue opening?**  
  *A:* Yes. Click **"Print Checklist"** at the top right of any procedure for a high-contrast printable checklist with tick-boxes.
