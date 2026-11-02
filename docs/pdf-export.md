# Fillable Character Sheet PDF Export

This system can export any Crawler actor into a fillable PDF character sheet that you supply. The package does not include a sheet. The publisher offers a fillable sheet as a free download on the game's site; the GM sets it once in the system settings.

---

## 📄 Overview & Features

- **Direct Export**: Click the **Save to PDF** button in the character sheet window header or from the Page 1 Core tab.
- **Field Map**: The export fills the form fields of a six-page sheet by field name. The map from sheet fields to crawler data (identity, ability scores, health bars, hotlist, gear, skills and spells, inventory, extras, abilities and sponsors) is in `src/apps/pdf-exporter.mjs`. A sheet whose field names differ will export with blank fields.

---

## 🚀 How to Export

### Set the sheet (GM, once)
Open Configure Settings, System Settings, and set **Character sheet PDF** to your fillable sheet. The setting has Foundry's file picker; upload the PDF to your world's data or Assets Library first. The setting is per world and GM only. A module can instead register a sheet with `registerCharacterSheetPdf`; the setting wins over a registered sheet. With neither, **Save to PDF** shows a message asking the GM to set one, and nothing else is affected.

### In Foundry VTT
1. Open any Crawler character sheet.
2. Click **Save to PDF** in the top window title bar or the stylized **Save to PDF** button in the Page 1 header box.
3. Foundry VTT will generate the filled PDF and trigger an immediate download (`<Crawler_Name>_CharacterSheet.pdf`).

### Programmatic API
Developers and macros can also export character sheets directly:
```javascript
const { exportCrawlerToPdf, saveCrawlerPdf } = await import('/systems/sprinter-rpg/src/apps/pdf-exporter.mjs');

// Get PDF bytes as Uint8Array
const pdfBytes = await exportCrawlerToPdf(actor);

// Or trigger direct browser download
await saveCrawlerPdf(actor);
```

---

## 🛠️ Architecture

- **Zero External Dependencies**: Built with a bundled `pdf-lib.min.js` in `lib/` and registered in `system.json`.
- **Cross-Platform Compatibility**: Executes natively in both browser/Foundry VTT clients and headless Node.js environments.
- **Non-Destructive**: Leaves the supplied template PDF intact and writes a new PDF document upon each export.
