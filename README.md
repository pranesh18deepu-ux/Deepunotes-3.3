# DeepuNotes V3.2.1 — iPad Pencil/PDF stability update

This build fixes the three problems reported during V3 testing.

### Changes
- **Apple Pencil:** input is handled on the entire writing surface, not only the ink canvas, and no pointer capture is used. Pencil draws while finger input scrolls.
- **Focus mode:** remains light/white instead of switching the editor to a dark/black surface. Side panels are hidden without making the writing canvas disappear.
- **PDFs:** importing a PDF creates **one DeepuNotes page for the whole PDF**, not one notebook page per PDF page. Use the PDF page ◀/▶ controls to move through the PDF while keeping annotations separately for each PDF page.
- **PDF export:** exports all PDF pages plus their annotations, along with normal DeepuNotes pages in the current section.
- Existing notebook/page deletion, reorder, backgrounds, text, images, backup/restore and local IndexedDB storage remain.

### Install
Upload all files to a new GitHub Pages repository (recommended: `deepunotes-v3-1`) and add the deployed URL to the iPad Home Screen.

### Important
The PDF engine uses PDF.js and jsPDF from CDN. The app needs internet access at least when those libraries are not cached. Notes themselves remain local in IndexedDB.

Use **Backup** regularly because clearing Safari website data can remove local notes.
