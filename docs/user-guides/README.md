# Rich Mix Technical Portal — User Guides & Documentation Library

Welcome to the official User Guide and Operational Manual for the **Rich Mix Technical Portal**. This documentation library provides comprehensive, page-by-page operational walkthroughs and technical field references for all 11 core modules of the application.

---

## Guide Index (One Document Per Page)

| # | Guide Document | Portal Route | Primary Audience | Key Responsibilities |
|---|---|---|---|---|
| **01** | [`01-dashboard.md`](./01-dashboard.md) | `#/dashboard` | All Staff & Technicians | Venue pulse, today's schedule, active duty reports, quick-action shortcuts |
| **02** | [`02-advancing.md`](./02-advancing.md) | `#/advancing` | Technical Managers, Senior Techs | Event technical advancing, run-times, multi-technician bookings, live schedules, tech specs, floor packages, Artifax synchronization |
| **03** | [`03-pre-screening-tracker.md`](./03-pre-screening-tracker.md) | `#/dcp` | Cinema Technicians, Technical Managers | 7-point DCP verification checklist, KDM/CPL checks, outcome overrides, technician notes, PDF QC report generation, client emails |
| **04** | [`04-jobs-and-tasks.md`](./04-jobs-and-tasks.md) | `#/tasks` | All Duty Technicians, Technical Managers | Duty job tracking, priority levels, task assignment, automated QC follow-ups, maintenance work orders |
| **05** | [`05-rota-and-shifts.md`](./05-rota-and-shifts.md) | `#/rota` | All Staff, Freelancers, Technical Managers | Shift calendars, discipline scheduling (Sound, LX, AV, Cinema), technician confirmation states, availability, Artifax shift sync |
| **06** | [`06-patch-and-preset-manager.md`](./06-patch-and-preset-manager.md) | `#/presets` | Technical Managers, Senior Sound/LX Techs | Audio patch sheets, stage box routing (Midas S16, Behringer Wing), DMX fixture personalities, channel assignments, recall presets |
| **07** | [`07-venues-and-spaces.md`](./07-venues-and-spaces.md) | `#/venues` | Technical Managers, Senior Techs, Planners | Venue specifications (The Stage, The Studio, The Mix, Screen 1/2/3, Streetside, Foyer), capacities, dimensions, basic crew rules, static kit |
| **08** | [`08-maintenance.md`](./08-maintenance.md) | `#/maintenance` | All Technicians, Technical Managers | Fault logging, condition tracking, equipment repairs, work orders, parent-child kit splitting, location restoration on fix |
| **09** | [`09-inventory.md`](./09-inventory.md) | `#/inventory` | All Technicians, Technical Managers | Kit inventory register, QR barcode lookup/scanning, kit check-out/in, kit displacements, asset movements history |
| **10** | [`10-procedures.md`](./10-procedures.md) | `#/procedures` | All Technicians, Freelancers, Trainees | Standard Operating Procedures (SOPs), venue opening/closing sequences, PA/lighting power sequences, emergency/H&S protocols, trainer sign-offs |
| **11** | [`11-users-and-permissions.md`](./11-users-and-permissions.md) | `#/users` | Technical Managers, System Administrators | Role-Based Access Control (Admin, TM, Senior Tech, Duty Tech, Freelancer), trainer qualification privileges, user disciplines, active statuses |

---

## Role-Based Access Matrix

| Role | Access Level | Permissions & Capabilities |
|---|---|---|
| **Technical Manager / Admin** | Complete (Unrestricted) | Full read/write access to all 11 modules, including restricted views (`Venues & Spaces`, `Patch & Preset Manager`, `Users & Permissions`). Can override QC outcomes, publish rotas, create DMX profiles, and manage user accounts. |
| **Senior Technician** | Advanced Operational | Full operational access to Advancing, Pre-Screenings, Tasks, Maintenance, Inventory, Procedures, and Rota. Can sign off trainees if granted Trainer status. |
| **Duty Technician** | Standard Operational | Read/write access to Advancing, DCP testing, Tasks, Maintenance fault reporting, Kit check-in/out, and viewing Procedures and Rotas. |
| **Freelancer** | Limited Operational | Restricted access to personal rota/shifts, assigned event technical sheets, and safety procedures. Blocked from DCP Pre-Screening Tracker, Patch/Presets, Venues, and User administration. |

---

## Common Key Conventions

- **Auto-Syncing**: The Technical Portal synchronizes in real time with Supabase and polls Artifax scheduling. Yellow or spinning indicators denote active synchronization.
- **Jobs & Tasks Linkage**: Actions marked "Further action required" in Advancing, Pre-Screenings, or Maintenance automatically create trackable entries in the **Jobs & Tasks** module.
- **One-Click Printing**: Every module supports clean print output (`Ctrl+P` or `Cmd+P` / dedicated print buttons) stripped of web navigation for physical distribution and booth records.
