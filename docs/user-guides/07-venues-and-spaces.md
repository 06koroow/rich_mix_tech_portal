# Page Guide 07 — Venues & Spaces

**Portal Route**: `#/venues`  
**Primary Users**: Technical Managers, Senior Technicians, Production Planners  
**Access Tier**: Restricted (Technical Managers and Admins only)

---

## 1. Executive Summary & Purpose

The **Venues & Spaces** module stores the master architectural, electrical, staging, and static equipment specifications for all performance and auxiliary rooms within the Rich Mix building.

It establishes venue capacities, stage dimensions, static audio/lighting inventories, DMX universe patch points, power supply drops (32A / 63A 3-phase), and minimum **Basic Crew Rules** required to operate each room safely.

---

## 2. Rich Mix Venue Directory

The portal tracks 8 distinct spaces across the building:

1. **The Stage (Main Live Venue)**:
   - *Capacity*: 350 standing / 180 seated.
   - *Console*: Behringer Wing / Midas S16 stageboxes.
   - *PA*: JBL VRX932LAP Line Array + VRX918SP Subwoofers.
   - *Lighting*: Avolites Tiger Touch II, 54-ch dimming, Prolights Studio CobFC, Diamond 19, CromoSpot500.
   - *Basic Crew Rule*: Minimum 2 Technicians (Lead Sound + Second / LX).

2. **The Studio (Flexible Theatre / Rehearsal Space)**:
   - *Capacity*: 150 standing / 100 seated.
   - *Console*: Roland M400 / 16x8 digital stagebox.
   - *PA*: KV2 Audio EX10 + RCF art705AS subs.
   - *Lighting*: ETC Element 60, Zero88 Chilli 48-way dimming.
   - *Basic Crew Rule*: Minimum 2 Technicians.

3. **The Mix (Intimate Performance / Cabaret Space)**:
   - *Capacity*: 80 seated / 120 standing.
   - *Console*: Soundcraft EMP12 analogue desk.
   - *PA*: KV2 Audio EX10 active speakers.
   - *Lighting*: 6-way LED controller + ETC Junior profiles.
   - *Basic Crew Rule*: Minimum 1 Technician.

4. **Screen One (Cinema)**:
   - *Capacity*: 181 theatre seats.
   - *Projector*: Christie CP4220 4K DCI Cinema Projector.
   - *Audio*: Dolby AP20, Christie Vive Audio LS5S surrounds, CDA5 5000W amps, Martin Audio LCR.
   - *Screen*: 24ft x 10.2ft silver screen.
   - *Basic Crew Rule*: Minimum 1 Cinema Technician.

5. **Screen Two (Cinema)**:
   - *Capacity*: 132 theatre seats.
   - *Projector*: Christie CP4220 4K DCI Cinema Projector.
   - *Audio*: Dolby AP20, Christie Vive Audio LS3S surrounds, Martin Audio LCR.
   - *Screen*: 23ft x 9.8ft silver screen.
   - *Basic Crew Rule*: Minimum 1 Cinema Technician.

6. **Screen Three (Cinema & Event Space)**:
   - *Capacity*: 59 theatre seats.
   - *Projector*: Christie CP2215 with Cine IPM2K.
   - *Audio*: Dolby CP750, Turbosound Impact 50 surrounds, Martin Audio LCR.
   - *Screen*: 16ft x 6.8ft white screen.
   - *Basic Crew Rule*: Minimum 1 Cinema Technician.

7. **Streetside & Foyer**:
   - Ground floor exhibition and community auxiliary spaces with distributed audio and self-service AV inputs.
   - *Basic Crew Rule*: Minimum 1 Technician on-call.

---

## 3. Core Workflows (Step-by-Step)

### Workflow 3.1: Updating Venue Technical Specifications
1. Navigate to **Venues & Spaces** (`#/venues`).
2. Select the space card (e.g. *The Stage*).
3. Click **"Edit Venue Specs"**.
4. Update:
   - `Capacity` (Standing, Seated, Cabaret).
   - `Stage Dimensions` (Width, Depth, Clearance height to grid).
   - `Basic Crew Requirement` (sets minimum crew warning in Rota and Advancing).
   - `Power Distribution Drops` (13A non-dim, 16A single-phase, 32A/63A 3-phase).
   - `Static Inventory Rigs` (kit permanently mounted in room).
5. Click **"Save Venue Profile"**.

---

## 4. Troubleshooting & FAQ

- **Q: Where does the "Under-crewed Warning" in the Rota come from?**  
  *A:* The Rota checks each event's space against the **Basic Crew** integer set here. If an event on *The Stage* has only 1 technician assigned instead of 2, a yellow warning pill is triggered automatically.
