# Stagline · LS Tune Studio

*Codename: Green Hornet Tuner*

A guardrailed, browser-based tuning studio for GM LS engines (Gen IV E38 trucks first). It's built for small, safe changes: a cam idle with more lope that still starts and drives like stock.

**Live site:** https://datbluepony.github.io/green-hornet-tuner/

## What's in it

| Page | What it does |
|---|---|
| `index.html` | Landing page with a live 3D VE map and the **Lope Lab** (interactive open-header idle sound + RPM trace) |
| `builder.html` | **Tune Studio**: project setup, Bluetooth/USB OBD2 diagnostics, idle & lope, 3D VE and spark editors, drive-cycle simulator, log analysis with assistant, backups, review & write |
| `mail-in.html` | Mail-in ECM service: process, shipping window, removal/packing guide, intake form → packing slip |
| `hardware.html` | Hardware cost estimator (mail-in vs DIY vs logging only) |
| `pricing.html` | Plans: Explorer (free), Street $119, Mail-in $249, Advanced $299 |
| `learn.html` | Guides, glossary, FAQ (with FAQ schema for SEO) |
| `legal.html` | Disclaimer, terms, assumption of risk & release, emissions notice, mail-in terms, privacy, refunds |

### Studio features
- Idle & lope calibration: 6 parameters, presets, recommended band + hard limits per plan, live predicted outcome, synthesized engine sound.
- Interactive 3D fuel (VE) and spark maps (Three.js) linked to a grid editor: drag-select, nudge, set, smooth, reset, value or change-vs-stock coloring.
- Tune simulator: a 48 s drive cycle (crank → idle → Drive + A/C → cruise → WOT → decel) scoring startability, idle quality, stall margin, cruise fueling, WOT AFR and knock margin.
- Bluetooth LE / USB ELM327 connection (Web Bluetooth / Web Serial, Chrome & Edge). **Read-only by design**: only Mode 01/03/09 and AT commands are allowed. Idle and driving tests produce a readiness report: safe to do, needs attention, not recommended, doesn't need.
- Data log upload (HP Tuners / EFILive / Torque CSV), fuel-trim heatmap, rule-based assistant that stages VE / spark / idle corrections.
- Automatic backups (localStorage), undo/redo, project export/import.
- Stock .bin fingerprinting (size, CRC-32, SHA-256, blank scan), tune checksum, manual approval (checklist + type `WRITE`), change-sheet export, simulated write and recovery rehearsal.
- Terms gate on first Studio visit; signed waiver (name + `I AGREE` + ID) for Advanced and mail-in.

## Run locally
Any static server works (ES modules need http, not `file://`):
```
npx serve .
# or
python -m http.server 8000
```

## Going from preview to selling — edit `assets/js/config.js`
1. **Payments:** create three Stripe Payment Links (Street, Mail-in, Advanced) and paste them into `checkout`. The signed waiver ID is passed as `client_reference_id`, so it shows on the Stripe payment.
2. **Order/waitlist form:** set `formEndpoint` (e.g. a Formspree form) to receive early-access emails and mail-in intake forms.
3. **Mail-in address:** set `mailIn.shipTo` to a **PO box or virtual mailbox**, never a home address.
4. **Contact email:** set `contactEmail` to show it in the footer.
5. **Brand:** "Stagline" appears in page text. Find-and-replace it if you rename.

## Before taking money
- Have a licensed attorney review `legal.html` (terms, release, refund policy) for your state. The text is a strong starting point, not legal advice.
- Consider forming an LLC and getting general liability insurance before offering the mail-in service.
- Check trademark availability for the final brand name.
- License enforcement (accounts, per-vehicle keys) needs a small backend (e.g. Supabase + Stripe webhooks). Today the Studio is fully unlocked as a public preview.

## Honest limits (preview)
- The simulator and sound are simplified models that show direction and rough magnitude, not guarantees.
- The Studio does not flash ECMs. Direct J2534 writing is on the roadmap. Today you export a change sheet or use mail-in.
- GM segment checksums are corrected by your flashing tool. Stagline fingerprints files and the change set.

## Structure
```
assets/css/site.css        design system (tokens, components)
assets/css/studio.css      Studio app shell
assets/js/config.js        prices, payment links, mail-in logistics
assets/js/site.js          nav/footer, toasts, modals, terms, waiver, checkout
assets/js/landing.js       hero 3D + Lope Lab
assets/js/studio/          model, audio, 3D surface, OBD, evaluation, charts, store, views/
```

© 2026 Stagline. All rights reserved. See `LICENSE`.
