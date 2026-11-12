# Page Guide 08 — Maintenance & Fault Tracking

**Portal Route**: `#/maintenance`  
**Primary Users**: All Technicians, Senior Techs, Technical Managers  
**Access Tier**: Operational (all staff can report faults; Technical Managers manage repair budgets and sign-offs)

---

## 1. Executive Summary & Purpose

The **Maintenance & Fault Tracking** module ensures that damaged, malfunctioning, or scheduled service equipment is logged, isolated, repaired, and restored safely to the venue inventory.

It tracks work orders, diagnostic notes, repair costs, parent-child kit splitting (separating a single broken unit from a multi-quantity batch), and automatically links faults with affected performance spaces so duty staff know immediately if a room has compromised capabilities.

---

## 2. Core Workflows (Step-by-Step)

### Workflow 2.1: Reporting a Fault During a Shift
1. Navigate to **Maintenance** (`#/maintenance`).
2. Click **"Report New Fault"** (also accessible from Dashboard quick-actions).
3. **Item Identification**:
   - Search the item from inventory (by Name, Tag, or scan QR code).
   - If reporting an uninventoried or general venue fault, check "Manual Item Entry".
4. **Fault Description**:
   - Enter concise title (e.g. "Prolights Studio CobFC #04 — Pan motor skipping steps", "Screen One surround amplifier ch 7/8 crackling").
   - Detailed symptoms and how the issue was reproduced.
5. **Severity & Space**:
   - `Priority`: *Critical* (Show-stopping), *High* (Requires fix before next show), *Medium* (Working with workaround), *Low* (Cosmetic/minor).
   - `Location Found`: The space where the fault occurred.
6. Click **"Submit Fault Report"**.
   - The item status in Inventory updates automatically to `Faulty / Under Repair`.
   - The fault appears in the Dashboard active alerts.

### Workflow 2.2: Splitting Broken Units from a Batch (Parent-Child Splitting)
- Example: Rich Mix owns 8x Shure SM58 microphones under tag `STG-008`. One microphone has a damaged capsule.
- Instead of marking all 8 units out of service:
  1. Click **"Split Faulty Quantity"** on the fault card.
  2. Enter Quantity: `1`.
  3. The system splits the batch: 7 remain in active stock under `STG-008`, while 1 child unit `STG-008-F1` is isolated into the repair workshop.

### Workflow 2.3: Repairing and Restoring Equipment to Service
1. Open the fault record in the Maintenance board.
2. Update the status: `Under Investigation` &rarr; `Awaiting Parts` &rarr; `In Repair` &rarr; `Repaired`.
3. Enter resolution details (e.g., "Replaced XLR socket and re-soldered pin 2; PAT tested and clean signal verified").
4. Click **"Mark Resolved & Return to Stock"**.
5. The system prompts for return location (defaults to original home location) and restores inventory quantity to active status.

---

## 3. UI Component & Field Reference

### 3.1 Maintenance Kanban & List Views
- **Status Columns**:
  - `Logged / Triage`: Newly reported, pending assessment.
  - `In Progress`: Actively being worked on by house tech or external specialist.
  - `Awaiting Parts / External Repair`: Out for factory repair or waiting for spares.
  - `Resolved / Returned`: Completed repairs history.
- **Priority Filter**: Filter by Critical, High, Medium, Low.
- **Space Filter**: Filter faults affecting specific rooms.

### 3.2 Fault Card Details
- **Equipment Asset Reference**: Name, Tag, Serial Number.
- **Reported By**: Technician name and date reported.
- **Linked Task**: Link to Jobs & Tasks queue.
- **Spare Parts & Cost Tracking**: Records replacement part numbers and supplier invoice amounts.

---

## 4. Troubleshooting & FAQ

- **Q: How do I know if an event space is safe to use if an amplifier failed?**  
  *A:* The Dashboard and Advancing views flag spaces with active *Critical* or *High* maintenance tickets. Check the fault record for workarounds (e.g. "Fader rerouted to backup amp channel B").
