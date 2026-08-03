-- Rich Mix Tech Portal — load the four documented procedure pages into Supabase.
-- Paste into the SQL Editor and Run. Safe to re-run (updates existing rows).

insert into public.procedures ("id","category","title","body","icon") values
  ('best-practice-guide', 'Best Practice', 'Technical Best Practice Guide', $body$RICH MIX — TECHNICAL BEST PRACTICE GUIDE
Live Audio  ·  Live Lighting  ·  Live AV — general principles for duty technicians
Version 0.2 (Draft). Based on Colours Hoxton Audio Documentation (2022), to be adapted further for Rich Mix.

This is a living document. Where it disagrees with a formal safety document, the safety document wins; where it disagrees with a manufacturer instruction, follow the manufacturer and flag the conflict to the Technical Manager. Console features are named generically — read "scenes / groups / palettes / executors" as whatever your platform calls them.


1 — PURPOSE AND SCOPE
Sets out the best-practice principles expected of anyone in a live technical role at Rich Mix — audio, lighting or AV; employed, freelance or visiting. Deliberately discipline-agnostic at the top, then specific underneath, so a duty technician covering a room outside their specialism still has a baseline. It does not replace manufacturer documentation, the venue H&S policy, method statements or risk assessments.
PLACEHOLDER: add named contacts, on-call/escalation numbers, incident-reporting route, and links to the current H&S policy, RAMS library and asset register.


2 — UNIVERSAL PRINCIPLES (ALL DISCIPLINES)
If you only read one section, read this one.

2.1 Safety is the first deliverable
No show is worth an injury. A gig that starts ten minutes late because a rig was made safe is a success. You are empowered and expected to stop or delay work that can't be done safely, and to escalate rather than improvise around a hazard.
- Know where the nearest first aid kit, fire exits, extinguishers and assembly point are before doors, in every room you work.
- Know who the duty manager and first aider are for the session, and how to reach them.
- Keep gangways, fire exits and access routes clear at all times — cases live in storage, not in an escape route.
- Report near-misses, not just accidents. A near-miss is a free lesson; log it so the cause gets fixed.

2.2 Electrical safety and power
- Inspect before you connect. Anything with exposed conductors, cracked bodies or a failed/expired PAT label comes out of service and gets tagged, not used.
- Respect the supply. Know the rating of the circuit you're drawing from and stay within it. Distribute load across phases/circuits rather than daisy-chaining into one outlet.
- One path to earth. Be alert to earth loops (hum/buzz) and never defeat an earth to solve one — fix the loop properly (see 8.2).
- Isolate before you work. Power down and unplug before re-patching or opening enclosures. Treat a rig as live until proven dead.
- Water and power don't mix. Keep drinks away from consoles, racks and dimmers.
PLACEHOLDER: add main incoming supply per room, available distro, PAT cycle and owner, and the policy on freelancers' own gear.

2.3 Working at height and rigging
Anything overhead can kill someone below it.
- Only work at height if trained, competent and authorised for the access method in use. If not, stop and get someone who is.
- Every flown item carries a rated secondary safety (bond/wire) in addition to its primary fixing. No exceptions.
- Establish an exclusion zone below any work at height. Nobody works or walks under a live rigging operation.
- Know the rated capacity of every bar, truss, clamp, hook-clamp and fixing, and stay well within it. If you don't know the rating, don't load it.
- Tools and loose items at height are tethered or pocketed.
- Ladders are for short, light work with three points of contact — not a substitute for a tower or MEWP on longer tasks.
PLACEHOLDER: add the LOLER inspection regime and dates, rated capacities per room, the approved access-equipment list, and any permit-to-work requirements.

2.4 Cabling and the floor
- Dress it as you lay it — neat, logically grouped, run along architecture not across open floor.
- Cover or route around traffic. Any cable crossing a walkway or audience route is matted or ramped — never a trip hazard.
- Leave a service loop; don't run cables tight.
- Label the ambiguous, both ends. The person who de-rigs may not be you.
- Separate power and signal; cross at 90° rather than running parallel.

2.5 Communication and comms discipline
- Agree the comms plan before doors: who's on headset/radio, the channels, and who calls the show.
- Keep the ring clear during the show — brief, clear, standard phrasing.
- Confirm back instructions ("standby LX 12" … "LX 12 standing by"). Say "GO" only to execute.
- If you lose comms, have a fallback agreed in advance.

2.6 Professionalism and the visiting artist
- Be there early, be visible, introduce yourself.
- Read the rider and tech spec in advance.
- Under-promise and over-deliver on what the room can do; be honest about limitations early.
- Stay calm and solution-focused when things go wrong in front of an audience.
- Respect the artist's creative decisions unless it's a safety issue — advise, don't override.

2.7 Preparation, get-in and get-out
- Prep is where shows are won — in the advance, the patch, the line-check and the soundcheck.
- Work to a schedule: get-in, soundcheck, doors, curfew. Communicate slippage early.
- De-rig is part of the job. Coil to the venue standard (over-under), return every item home, leave the room ready to walk into cold tomorrow.
- Never de-rig into a mess for the next person.

2.8 Documentation and handover
- If it isn't written down, it didn't happen. Log faults, rig changes, and anything the next crew needs.
- Keep show files, patch sheets and plots in the venue's shared location, clearly and dated — not only on a personal laptop or USB.
- Complete a handover every session: what's working, what's broken, what changed, what's outstanding.
- Faulty equipment is tagged, taken out of service, and logged — never quietly put back in the rack.
PLACEHOLDER: link the fault log, standing-rig docs per room, show-file archive, and the naming convention.


3 — RECOMMENDED WORKFLOWS
Understand the job, prepare offline, build methodically, verify systematically, then run.

3.1 The universal arc (every job, scaled to the show — don't skip a phase)
- Advance — read the rider/spec/running order; confirm what's coming, what the room provides, and the gaps. Ask questions now, in writing.
- Prep offline — build the show file/plot from a template, write the patch/input list, pre-rig, pre-test content.
- Setup / get-in — build to the plan; keep the physical build matching the paperwork.
- Systematic check — prove every signal path before you need it. The highest-value habit of the day.
- Soundcheck / tech / show — refine to a working starting point, save it, then run actively.
- De-rig and reset — strike safely, restore the standing config, log faults, hand over.
PRINCIPLE: anything that can be done offline should be done offline.

3.2 Audio workflow
- Start from the written input list (the source of truth).
- Build the show file from a house template — labelled, coloured, control groups and buses structured.
- Patch the stage; label both ends; confirm the digital/analog boundary.
- Set gain structure at the preamp with processing neutral.
- Line-check every input in order, then every monitor mix before the act plays.
- Soundcheck to a starting point, then save the show file immediately and to the archive.
- Run actively; save again after any significant change.

3.3 Lighting workflow (structure before content)
- Work to the plot; keep the rig matching the paperwork.
- Patch and address: set each fixture's address and mode to match the console and paperwork.
- Rig-check: prove every fixture responds, in position, at the right address, before focus.
- Focus cold and empty, then verify with people on stage.
- Build the operating structure — groups, then palettes — before cues.
- Program cues (or set the busk layout), label everything, save to the archive.
- Keep a blackout and a worklight/safe state reachable throughout.

3.4 AV workflow (test on real content; always have a fallback)
- Advance the content and formats.
- Standardise a resolution/refresh for the event; confirm every source and display agrees.
- Build and label the signal chain: source → scaler/switcher/matrix → distribution → display.
- Test every source end-to-end on the actual content and output settings.
- Prepare fallbacks: holding slide, safe/black output, backup source.
- Confirm capture/stream routing and verify it's actually recording/live before doors.


4 — PATCH MANAGEMENT

4.1 Principles of good patching
- One source of truth: paper, physical and console patch must always agree.
- Label both ends of every ambiguous cable, tail and multicore leg.
- Be logical and contiguous; keep the layout predictable.
- Leave room to grow; logical gaps cost nothing and save re-work.
- Standardise the house patch per room.

4.2 Building and documenting a patch
The input/patch list is the document the day hangs off. Record per channel: channel number, source/instrument, transducer (mic/DI model), stand type, phantom requirement, the physical input (stagebox and socket), and notes.
- Agree the list with the visiting engineer where there is one.
- Name and scribble every channel on the console to match the list.
- Colour-code by family (drums, bass, guitars, keys, vox, playback, FX).
- Save the patch sheet with the show file, dated and named to convention.
PLACEHOLDER: attach the RM input-list template and house default patch per room.

4.3 Digital stageboxes and analog breakouts together
Know where the boundary is:
- Map which channels arrive via the digital stagebox and which via analog breakouts; write it on the patch sheet.
- A digital network carries far more channels over one light cable; analog breakouts are separate, self-contained failure domains — sometimes exactly what you want for a critical feed.
Own the gain (the classic trap):
- With a digital stagebox, the preamp lives at the box. If FOH and monitors share it, changing gain affects both consoles.
- Where two consoles share a stagebox, agree who owns the analog gain (usually monitors); the other console uses digital trim/gain compensation. Never fight over a shared preamp mid-show.
- Where a source must feed two systems independently (e.g. broadcast), split in the analog domain before the preamp using a proper mic split.
Splits, isolation and earth loops:
- Use a proper transformer/active mic split; take the isolated outputs to the second destination.
- Lift the ground on the split's iso side to prevent loops — never by defeating a mains earth.
- Know whether a breakout is mic- or line-level and set the receiving input to match.
Clock, sample rate and latency:
- Everything on the digital network shares one clock and sample rate; one clock master, every device locked. Clock faults present as clicks, dropouts or silence.
- A digital transport adds small fixed latency — harmless alone; the risk is summing the same source across two domains with different delays (comb filtering).
Redundancy:
- If the network supports a redundant link, patch it and know how it fails over.
- An analog breakout is an independent path: if the digital network fails, analog copper is unaffected.

4.4 Lighting patch discipline
- Plan the universe/address layout before setting a fixture, accounting for each fixture's footprint and mode.
- Keep physical addressing, paperwork and console patch in agreement.
- Document universe, address, mode, position and circuit for every fixture; leave address gaps for expansion.

4.5 AV routing discipline
- Label every input/output on switchers, matrices and distribution; keep a routing map with the paperwork.
- Record the format on each leg (resolution/refresh/standard).
- Pick the transport per run: SDI/fibre for long robust runs; keep HDMI short; plan networked video on its own switching.


5 — LIVE AUDIO
Good live sound is discipline before taste.

5.1 Signal flow and gain structure
Path: source → transducer/DI → stagebox/preamp → console → processing → matrix/output → amplification → loudspeaker.
- Set gain at the preamp first, fader and processing neutral, with headroom for the loudest passage.
- Chase the loudest realistic moment, not the soundcheck murmur.
- Keep unity as your reference; if faders are pinned or scraping, fix the gain structure upstream.
- Watch every meter in the chain, not just the output.

5.2 System setup and optimisation
- Know the house system: boxes, drive, crossover/DSP, and the presets that must not change casually.
- Verify polarity and alignment (mains, subs, fills); time-align for coherent coverage.
- Set for even coverage across the whole audience, not just FOH.
- Ring out / verify the room at operating level before the act arrives.
- Respect SPL limits and noise obligations.
PLACEHOLDER: add per-room PA (mains/subs/fills), amp/DSP platform, house presets and who may edit them, SPL limits; note The Stage system once the Allen & Heath SQ-6+ build is commissioned.

5.3 Microphone and DI technique
- Choose the right transducer, then place it well — placement earns more than EQ.
- Mind the proximity effect; use the pattern to reject spill.
- Use DIs for line/pickup sources; choose active vs passive appropriately.
- Manage phase between multiple mics on one source.

5.4 Patch, line-check and soundcheck
A methodical, unhurried line-check is the highest-value habit in live audio.
- Build and label the patch from a written input list.
- Line-check every input in order: signal, correct channel, phantom where needed, no noise/hum.
- Check monitors before the band plays a note — every mix, every wedge/IEM.
- Soundcheck to a working start point; save it immediately.
- Resolve line-check anomalies; don't carry a known fault into the show.

5.5 Monitors
- The monitor mix is the artist's world.
- Give the performer what they ask for first, then refine.
- Prioritise gain-before-feedback on wedges.
- With IEMs, protect hearing and plan for a pack/battery failure mid-set.

5.6 Mixing the show
- Mix for the song and the room, not the meter.
- Get a balance first — vocal intelligible, rhythm section solid — before effects.
- Ride the show actively.
- Keep a hand near the vocal and the master.

5.7 Structuring a show file and a mix
Build from a house template, never a blank desk.
Input and channel layout: order channels by instrument family; name, scribble and colour-code everything.
Control groups and buses: ride families on control groups (DCAs/VCAs); keep the same layout show to show; structure subgroups, aux sends and matrix outputs deliberately; keep a small set of labelled FX returns; protect master headroom.
Scenes / snapshots: use for genuinely distinct states, not as a substitute for mixing; understand recall scope so a scene never stamps on your live ride or shared input gain.
Save discipline: maintain a house template per room; save before doors and after any significant change, incrementally and dated; archive the final file to the shared location.
PLACEHOLDER: attach the RM house template show file(s) and the channel-order/colour convention.

5.8 Wireless and RF management
- Coordinate frequencies before the show; avoid known conflicts (other wireless, IEMs, comms, LED walls, local TV).
- Work within licensed/licence-exempt UK bands only; record what's on which frequency.
- Manage batteries proactively — fresh cells, spares to hand, known runtime margin.
- Keep antennas in line-of-sight and sensibly placed; fix the cause of dropouts, not the symptom (see 8.3).

5.9 Recording and capture
- Confirm routing and record-arm before the first note, and verify it's actually recording.
- Keep capture gain independent of the FOH mix where possible.
- Confirm consent and any recording restrictions with the artist/promoter first.


6 — LIVE LIGHTING
Half the job is data, power and rigging done correctly; the other half is using light to serve the performance.

6.1 Rigging and focusing fixtures
- Every fixture: rated clamp + independent rated safety bond, always (see 2.3).
- Rig to the plan; keep the rig matching the paperwork.
- Dress and strain-relieve cabling so weight is off the connectors.
- Focus with the stage as used; focus cold and empty, then check with people on stage.
- Let fixtures cool before handling; never look into a high-output source at close range.

6.2 Patch and addressing
- Plan the DMX universe/address layout before setting a fixture.
- Keep physical addressing, paperwork and console patch in agreement.
- Document universe, address, mode, position and circuit; leave gaps for expansion.

6.3 Data distribution (DMX / network)
- Respect the DMX standard: correct cable, sensible runs, splitters/buffers over long daisy-chains, termination on the last device.
- On sACN/Art-Net, plan universes, IP addressing and switch topology; isolate lighting traffic.
- Label data lines; know which universe goes where.
- Carry known-good spare data cable and a spare node/splitter.

6.4 Power and dimming
- Never put an LED/moving-head fixture or its PSU on a dimmed circuit.
- Balance load across circuits and phases; stay within rating (see 2.2).
- Power up/down in a sensible order; let movers home/reset before expecting response.
PLACEHOLDER: add per-room lighting infrastructure — dimmer vs LED provision, house rig and plots, console(s), DMX/network topology, house patch.

6.5 Console and programming
- Save early, save often, save to the shared archive.
- Build structure — groups, palettes, presets — then cues on top; reference palettes so a re-focus updates everywhere.
- Label everything.
- Program cue timing intentionally.
- Keep a blackout and a safe/worklight state instantly reachable.

6.6 Console layout best practice
Build the tools before the looks: groups first (logically named and laid out), then position/colour/beam palettes referenced in cues.
Lay out the operating surface with intent: consistent fader/executor scheme kept the same show to show; for busking, put what you reach for most where your hands fall; always keep a grand master, instant blackout and worklight within reach; label everything.
Separate programming from running: a clean main cue stack numbered to match the caller's book; clear the programmer before you run; back up to the archive.

6.7 Designing and operating the show
- Light the performance, not the rig — every look has a reason.
- Motivate direction, colour and intensity.
- For cued shows, take cues from the caller and hit them cleanly; for busked shows, stay ahead of the music.
- Consider audience sightlines and comfort; mind strobe/haze and photosensitivity warnings.

6.8 Haze, smoke and effects
- Check haze/smoke against fire detection and building policy before running it.
- Warn FOH and the audience where strobe/haze/smoke effects are used; display notices.
- Keep fluid topped up and the machine maintained.


7 — LIVE AV / VIDEO
AV fails in the most public way possible; the defence is boring, thorough preparation.

7.1 Signal flow and formats
- Map the whole chain: source → scaler/switcher/matrix → distribution → display. Know the format at every stage.
- Standardise resolution and refresh; confirm every source and display agrees.
- Understand EDID/HDCP handshaking — the most common failure is devices that won't negotiate, not a dead cable.
- Pick the right transport for the run: SDI/fibre for long runs; keep HDMI short.

7.2 Sources and playback
- Test every source in advance on the actual content and output settings.
- Sort presenter/laptop input early: adapters, tested resolution, mirror vs extended plan.
- Use dedicated playback where reliability matters; pre-load and pre-test.
- Always have a fallback: holding slide, safe/black output, backup source.

7.3 Displays, projection and LED
- For projection, get geometry right: throw, lens, keystone/warp, focus, brightness for the ambient light.
- Mind light interaction between projection and stage lighting; coordinate with LX.
- For LED walls, confirm processor config, pixel pitch/mapping, and content resolution.
- Where content is mapped to a surface, lock the physical position and map together and document it.

7.4 Cameras and IMAG
- Match camera output format to the switcher and screens; confirm end-to-end before doors.
- Manage latency; keep the video path short.
- Agree framing, shot discipline and who's cutting before the show.

7.5 Streaming and capture
- Confirm the whole chain end-to-end before going live: capture, encoder, upload bandwidth, destination settings.
- Test the upload on the actual network, at the actual bitrate.
- Get a clean audio feed (a dedicated mix/stream feed, not a camera mic).
- Have someone monitor the outgoing stream as the audience sees it.
PLACEHOLDER: add per-room AV infrastructure — projectors/screens/LED, switchers/scalers, distribution, streaming setup and bandwidth, standard formats.

7.6 Networked AV and IT
- Plan the network deliberately — VLANs, bandwidth, switch capability, isolation from public traffic.
- Don't mix heavy AV traffic with the venue's business/guest network.
- Document IP addressing and keep it consistent.


8 — TROUBLESHOOTING (ALL DISCIPLINES)
Faults are inevitable; flailing is optional. Method beats intuition.

8.1 The universal method
- Stay calm and change one thing at a time.
- Work from a known-good point toward the fault.
- Halve the path (binary search) to localise fast.
- Substitute, don't assume — most "impossible" faults are a cable.
- Ask what changed last.
- Know your normal (healthy meters, indicator LEDs, lock lights).
- Log the fault and the fix.

8.2 Audio faults
- No signal: trace source to output; check mute, fader, routing, phantom, cable — one variable at a time.
- Hum/buzz: usually an earth loop; lift at the correct point, fix the cabling — never disconnect a mains earth.
- Feedback: pull the offending send/channel first, then fix the cause (open mic, gain too high, mic into wedge).
- Distortion/clipping: find which stage is clipping and fix it, don't just pull the master.
- Clicks/dropouts on digital: suspect clock/sample-rate mismatch or a network link first.
- Intermittent: suspect connectors and cables first — wiggle-test, swap, reseat.

8.3 RF and wireless faults (work in this order)
- Battery first — a dying cell mimics an RF dropout.
- Line of sight and antenna placement — get antennas up, out, looking at the stage; not too far, not so close they overload.
- Interference and coordination — rescan when the RF environment changes; LED walls and video processing are notorious noise sources; separate antennas from them.
- Frequency plan / intermod — use a coordinated plan; individually-clear channels can beat together.
- Gain and squelch — set both deliberately.
- Antenna distribution and cable — account for cable loss; check diversity receivers see both antennas.
- Substitute a known-good pack/receiver to split coordination from hardware.
NOTE: the RF environment changes when the room fills (bodies absorb RF) — pressure-test coordination late and keep margin.

8.4 Lighting faults
- Won't respond: check power type/circuit (LED on a dimmed circuit?), then address vs patch, then the data run, then the fixture.
- Whole branch dead: suspect the data distribution (node/splitter/cable/termination) before the fixtures.
- Erratic/flickering: usually data integrity or power; substitute the data path.
- Wrong colours/positions: almost always a patch/mode mismatch — verify personality and address.
- Networked control drops: check switch, IP addressing, universe config; isolate lighting traffic.

8.5 AV faults: HDMI and SDI
Start every AV fault the same way: is the source outputting, is the correct input selected, does the format agree end-to-end?
HDMI (the fragile one):
- EDID/handshake failures: no picture after a switch, or only in a certain power order. Use EDID management and re-seat to force a fresh handshake.
- HDCP failures: pink/green tint, sparkles or a hard block usually means a non-compliant device — keep the chain compliant end-to-end.
- Length/quality: HDMI is unreliable past ~5m of passive copper — use active/optical, or convert to SDI/HDBaseT; suspect cheap adapters.
- Format mismatch: force a safe format (e.g. 1080p60); check overscan and aspect ratio.
SDI (the robust one):
- Sparkles/hits: a marginal link — cable too long/poor for the bit-rate; higher rates need better cable/shorter runs.
- No signal: suspect a damaged cable/connector, wrong impedance, or a converter not passing the format. SDI is point-to-point — no termination to set.
- Format mismatch: confirm both ends agree on standard and frame rate; check embedded audio.
Converting between them:
- HDMI↔SDI converters are common single points of failure — test each in isolation.
- A converter won't legitimately strip HDCP.
- Keep a holding slide and a tested fallback ready.

8.6 Knowing when to stop and escalate
- Time-box troubleshooting during a live show; switch to the fallback and keep the show running.
- Escalate rather than dig a deeper hole.
- Never trade safety for a fix.


9 — WHEN THINGS GO WRONG
Things break in front of audiences. How you recover is what matters.

9.1 Mindset and priorities (fixed order)
- Safety — is anyone at risk? Deal with that first, always.
- Get something working — reach for the fallback so the audience has something clean.
- Diagnose properly — only once the show is covered (section 8).
- Fix and restore — bring the proper solution back cleanly.
- Your calm is the most useful tool in the room. Slow is smooth, smooth is fast.

9.2 Build fallbacks before you need them
- Audio: spare handheld/pack, a DI/line backup path, a known-good spare cable, a plan for a dead channel.
- Lighting: an instantly reachable safe state and worklight look.
- AV: a holding slide, safe/black output, and a pre-tested second source.
- Comms/power: a fallback comms method agreed in advance; know which circuit feeds what.
- Ask before doors: "if the one console/source/radio channel this show depends on dies now, what do I do?"

9.3 Buying time gracefully
- A confident holding state buys all the time you need.
- A composed "bear with us for a moment" beats a frozen operator and dead air.
- Don't let visible panic become part of the show.

9.4 Communication under pressure
- Tell the people who need to know (DSM, duty manager, artist liaison) what's happening and your honest estimate.
- Keep it brief and factual on the ring.
- If you need a decision above your authority, ask for it clearly.

9.5 Show-stop and safety
- Know the threshold for stopping a show and who holds that authority.
- Raise a genuine safety risk immediately — better a false alarm than a missed one.
- Follow the venue's emergency and evacuation procedures; know your role before you need it.
PLACEHOLDER: insert the RM show-stop procedure, evacuation plan, and named roles/authorities per room.

9.6 Afterwards
- Log what happened and what fixed it.
- Restock and repair before the next show.
- Feed it back to the department.
- Go easy on yourself and your crew.


10 — APPENDICES AND TEMPLATES

10.1 Generic pre-show checklist
- Advance read: rider, spec, running order reviewed; gaps flagged.
- Room safe: access/exits clear, rig checked, safeties on, exclusion zones for height work.
- Power distributed and within rating; gear PAT-current and visually inspected.
- Audio: patch built and labelled, full line-check done, monitors checked, show file saved.
- Lighting: rig matches plot, patch verified, show saved, blackout/worklight reachable.
- AV: sources tested on real content, formats agreed end-to-end, fallback/holding slide ready.
- RF: frequencies coordinated, fresh batteries, spares to hand, pressure-tested near doors.
- Comms plan agreed and tested; everyone knows who calls the show.
- Capture/stream (if any) armed, routed and verified.
- Fallbacks in place: single points of failure identified, each with a plan.

10.2 Generic handover / end-of-session notes
- What ran tonight and how it went.
- Changes to the standing rig/patch/config, and whether they were reset.
- Faults found: what, where, tagged out, logged where.
- Consumables low or used (lamps, fluid, batteries, tape).
- Outstanding actions for the next session or the Technical Manager.

10.3 Suggested sections still to write
- Room-by-room technical packs (spec, rig, patch, quirks) for each space.
- Emergency procedures: show-stop, evacuation, and the technician's role.
- Freelancer/visiting-crew induction.
- Competency-framework cross-reference to the self-assessment and training syllabus.
- Accessibility and inclusive-practice considerations.

End of draft — mark it up, cut what doesn't fit Rich Mix, and grow the sections that do.
$body$, 'book'),
  ('studio-startup', 'Opening & Closing', 'Studio — access & start-up', $body$ACCESS — GETTING TO THE STUDIO VIA PROJECTION BOOTH 3

Preferred route
1. Go to Level 1 and enter the Cinema Bar.
2. Walk towards the Cinema entrance, through the fire door, into the Screen 1 lobby (where the lifts and stairs are).
3. Take the lift or the staircase to Level 4.
4. Locate Projection Booth 3, beside Screen 3. Enter the access code 375XZ to enter the booth.
5. Collect the Studio key set. The two EVVA master keys open the Studio Main Door and the Technical Balcony Door.
6. Leaving the booth: if Screen 3 is empty, exit via the emergency exit in the cinema, then follow the Studio signs to the Studio entrance.

Alternative audience route (when Screen 3 is occupied)
- Take the lift to Level 1 and exit via the cinema emergency doors.
- Walk through the Cinema Bar, take the Central Lift to Level 4, then follow the Studio signs from the preferred route.


POWERING UP THE STUDIO

The two EVVA master keys open the Studio Main Door and the Technical Balcony Door.
1. Walk up the stairs to the Technical Balcony Door and open the fire door (marked IAM — Caution: High Voltage).
2. Turn on the extension leads.
3. Turn on the main switch at the end.
4. Turn on the breakers from the top — all four of them.
5. Turn on the remaining switches.
6. Turn on the sound desk from the back.
7. The lighting desk switch is at the top of the desk.

IMPORTANT: the Studio consoles are turned on LAST.

Projector: mounted at the top of the space. The remote is on the table in the Tech balcony.
$body$, 'power'),
  ('screen-1-ops', 'AV & Presentation', 'Screen 1 — start-up & operation', $body$START-UP PROCEDURE

1. Enter the booth using passcode C79XZ1.
2. At the back of the booth, find the large rack unit — this is the amp rack.
3. Behind the amp rack, on the wall, is a red power switch. Flick it up into the ON position.
4. Facing the rack, turn on each of the six amplifiers (from the base up). Each has a power switch indented on its right-hand side. You'll hear a click and see the left-hand LEDs flash then fade out.
5. At about chest level is the AP20 digital audio processor — it handles all routing and processing for the Screen 1 7.1 surround system. Its LCD will show a boot sequence (about a minute). Once booted, nothing more is needed.
6. To the right of the projector, just below the window (roughly in line with the lens), is a light switch panel. Turn OFF the lights labelled "Cleaners" (the red light above the booth window turns off with them).
7. On the same panel, press "Lights Up" to raise the dimmable lights inside the screen.
8. Screen 1 is now powered on for operation.


BASIC OPERATIONS

PROJECTOR (MANUAL)
The Christie projector has an LCD touch screen on a moveable arm, with a stylus hanging from it. Tap once to wake it — the home page shows quick controls in a grid.

The two right-hand columns are power and lamp:
- Top pair: projector power on/off. Rarely needed — do not power off without training.
- Second pair: lamp on/off. Always lamp off manually when there is more than 1 hour between screenings, to preserve lamp life. After lamping off, allow 10 minutes to cool — a timer shows on screen.
- Third pair: dowser open/close. The dowser shutters the lamp, blocking the image. Close it to hide an on-screen operation (e.g. a Blu-ray/DVD menu).

The 3x3 grid is video inputs and aspect ratios (only the first two rows are used at Rich Mix):
- 2D Scope / 2D Flat / 2D 178 / 2D 220 — set the aspect ratio for DCP playback and switch the projector to its internal DCP input. These are the common cinema ratios. Distributor DCP naming usually signals the ratio at a glance; non-standard deliverables may not, so check by eye during playback. Ratios can be changed during playback (useful for checks).
- Kramer Scope / Kramer Flat — set the aspect ratio and switch to the HDMI input.

HDMI source: the projector's HDMI comes from a rack-mounted Kramer HDMI switch, fed from the HDMI patchbay (towards the bottom of the AV patchbay). The Kramer switch is patched into the first four HDMI inputs. To use an HDMI device: plug an HDMI cable from the device into any of the first four patchbay inputs, make sure the lamp is on and the dowser open, then select Kramer Flat. If the image looks too small in the frame, try Kramer Scope.

AP20 DIGITAL SOUND PROCESSOR
Linked to the projector: it receives audio and passes it through the amps out into the screen. The front panel has a large LCD and, to its right, the master volume dial. The LCD meters incoming audio across 7.1 (green bars). Input buttons:
- Digital 5.1 — 5.1 DCP playback: L, C, R, LFE, SL, SR.
- Digital 7.1 — 7.1 DCP playback: L, C, R, LFE, SL, SR, SBL, SBR.
- Non-sync — empty/unused (aux audio not synced to picture, e.g. background music).
- NS2 Plogic — empty/unused.
- NS2 Stereo — audio from the Behringer XR12, out via L, R, SL, SR. Ideal for stereo video files from a laptop.
- NS2 Surrounds — audio from the XR12, out via SL, SR only. Ideal for intros and Q&As with mics: surround-only routing avoids the feedback you'd get through the front speakers, and is best for audience listening.
- S/PDIF — digital input carrying multichannel audio from the Kramer HDMI switch. Bypasses the XR12, so level is set on the AP20 dial. Best for DVD/Blu-ray (uses all available channels).

SOUND (BEHRINGER XR12)
The screen's mixing desk, patched 1:1 (channel 1 is always input 1). When the XR12 is in use, the AP20 must be set to NS2 Surrounds or NS2 Stereo for the desk to be heard. The interface runs on an iPad kept on the shelves to the right of the projector, below the window. iPad password: 246810. On the iPad, restart the XR12 app, reopen it, and wait to reconnect; tap the mixer icon labelled "Screen 1" (a blue bar appears) to open the interface.
- Channels 1-4: the four XLR inputs on the patch point at the front of the screen (right-hand side, below the screen). Used for the four wired SM58s kept in the booth by the window.
- Channels 5-6: the two wireless mic receivers on the windowsill. Wireless mics live in the AV rack below the Kramer switch; batteries charge on the shelf below the XR12.
- Channels 7-8 (linked): a 3.5mm TRS jack — good for laptop headphone-out audio.
- Channels 9-10 (linked): from the Kramer HDMI switch, as an alternative to S/PDIF on the AP20.
- The XR12 headphone port feeds a small monitoring speaker.

LIGHTING
The top row of white switches controls the house lights, for manual control from the booth:
- Lights Up — house lights to 100%.
- Lights Inter — house lights to 50%.
- Lights Off — house lights to 0%.
- Door Release — disengages the magnetic hold-open on the screen doors.
- Cleaners — cleaning lights; these override the house lights and cannot be automated. The booth red light shows when they are on.
- Task — a small overhead booth light; enough to work by without spilling into the screen.
- Exits — the fire-exit sign lights. DO NOT TOUCH.

Stage lighting: the DMX controller next to the XR12 runs a pair of washes and a single spot on a bar in the screen. To operate, push the fader labelled "Master" all the way up. This gives even coverage of the small Screen 1 stage — ideal for introductions, talks and Q&As.
$body$, 'screen'),
  ('screen-2-ops', 'AV & Presentation', 'Screen 2 — start-up & operation', $body$START-UP PROCEDURE

1. Enter the booth using passcode C79XZ2.
2. At the back of the booth, find the large rack unit on the right — this is the amp rack.
3. Behind the amp rack, on the wall, is a red power switch. Flick it up into the ON position.
4. Facing the rack, turn on each of the four amplifiers (from the base up). Each has a power switch indented on its right-hand side. You'll hear a click and see the left-hand LEDs flash then fade out.
5. At about eye level is the AP20 digital audio processor — it handles all routing and processing for the Screen 2 5.1 surround system. Its LCD will show a boot sequence (about a minute). Once booted, nothing more is needed.
6. To the right of the projector, just below the window, is a light switch panel. Turn OFF the lights labelled "Cleaners" (the red light above the booth window turns off with them).
7. On the same panel, press "Lights Up" to raise the dimmable lights inside the screen.
8. Screen 2 is now powered on for operation.


BASIC OPERATIONS

PROJECTOR (MANUAL)
The Christie projector has an LCD touch screen on a moveable arm, with a stylus hanging from it. Tap once to wake it — the home page shows quick controls in a grid.

The two right-hand columns are power and lamp:
- Top pair: projector power on/off. Rarely needed — do not power off without training.
- Second pair: lamp on/off. Always lamp off manually when there is more than 1 hour between screenings, to preserve lamp life. After lamping off, allow 10 minutes to cool — a timer shows on screen.
- Third pair: dowser open/close. The dowser shutters the lamp, blocking the image. Close it to hide an on-screen operation (e.g. a Blu-ray/DVD menu).

The 3x3 grid is video inputs and aspect ratios (only the first two rows are used at Rich Mix):
- 2D Scope / 2D Flat / 2D 178 / 2D 220 — set the aspect ratio for DCP playback and switch the projector to its internal DCP input. These are the common cinema ratios. Distributor DCP naming usually signals the ratio at a glance; non-standard deliverables may not, so check by eye during playback. Ratios can be changed during playback (useful for checks).
- Kramer Scope / Kramer Flat — set the aspect ratio and switch to the HDMI input.

HDMI source: the projector's HDMI comes from a rack-mounted Kramer HDMI switch, fed from the HDMI patchbay (towards the bottom of the AV patchbay). The Kramer switch is patched into the first four HDMI inputs. To use an HDMI device: plug an HDMI cable from the device into any of the first four patchbay inputs, make sure the lamp is on and the dowser open, then select Kramer Flat. If the image looks too small in the frame, try Kramer Scope.

AP20 DIGITAL SOUND PROCESSOR
Linked to the projector: it receives audio and passes it through the amps out into the screen. The front panel has a large LCD and, to its right, the master volume dial. The LCD meters incoming audio (green bars). Input buttons:
- Digital 5.1 — 5.1 DCP playback: L, C, R, LFE, SL, SR.
- Digital 7.1 — NOT set up in Screen 2: it is 5.1 only, as it lacks the left and right back-surround speakers.
- Non-sync — empty/unused (aux audio not synced to picture, e.g. background music).
- NS2 Plogic — empty/unused.
- NS2 Stereo — audio from the Behringer XR12, out via L, R, SL, SR. Ideal for stereo video files from a laptop.
- NS2 Surrounds — audio from the XR12, out via SL, SR only. Ideal for intros and Q&As with mics: surround-only routing avoids the feedback you'd get through the front speakers, and is best for audience listening.
- S/PDIF — digital input carrying multichannel audio from the Kramer HDMI switch. Bypasses the XR12, so level is set on the AP20 dial. Best for DVD/Blu-ray (uses all available channels).

SOUND (BEHRINGER XR12)
The screen's mixing desk, patched 1:1 (channel 1 is always input 1). When the XR12 is in use, the AP20 must be set to NS2 Surrounds or NS2 Stereo for the desk to be heard. The interface runs on an iPad kept on the shelves to the right of the projector, below the window. iPad password: 246810. On the iPad, restart the XR12 app, reopen it, and wait to reconnect; tap the mixer icon labelled "Screen 2" (a blue bar appears) to open the interface.
- Channels 1-4: the four XLR inputs on the patch point at the front of the screen (right-hand side, below the screen). Used for the four wired SM58s kept in the booth by the window.
- Channels 5-6: the two wireless mic receivers on the windowsill. Wireless mics live in the AV rack below the Kramer switch; batteries charge on the shelf below the XR12.
- Channels 7-8 (linked): a 3.5mm TRS jack — good for laptop headphone-out audio.
- Channels 9-10 (linked): from the Kramer HDMI switch, as an alternative to S/PDIF on the AP20.
- The XR12 headphone port feeds a small monitoring speaker.

LIGHTING
The top row of white switches controls the house lights, for manual control from the booth:
- Lights Up — house lights to 100%.
- Lights Inter — house lights to 50%.
- Lights Off — house lights to 0%.
- Door Release — disengages the magnetic hold-open on the screen doors.
- Cleaners — cleaning lights; these override the house lights and cannot be automated. The booth red light shows when they are on.
- Task — a small overhead booth light; enough to work by without spilling into the screen.
- Exits — the fire-exit sign lights. DO NOT TOUCH.

Stage lighting: the DMX controller next to the XR12 runs a pair of washes on a bar in the screen. To operate, push the fader labelled "Master" all the way up. This gives even coverage of the small Screen 2 stage — ideal for introductions, talks and Q&As.
$body$, 'screen')
on conflict ("id") do update set "category"=excluded."category", "title"=excluded."title", "body"=excluded."body", "icon"=excluded."icon";
