# Liz's Bookshelf

A personal digital bookshelf with a vintage-library look. Every book is a Markdown file, so the library also works inside Obsidian.

**Shelves**
- **3D books** on wooden shelves, shown face-out with their covers or as spines colored to match their covers. Hover to turn a book and see its pages.
- **Shelf materials**: oak, maple, pine, cherry, mahogany, walnut, ebony, brushed steel or black iron, with realistic grain.
- **Drag and drop** to rearrange; each shelf scrolls sideways when it's full. You can also **group by category**, filled in from Open Library.
- **"What should I read next?"** spins through your To Read shelf and pulls out a book, favoring tags you rate highly.

**Tracking**
- **Currently reading**: page counter, plus your **reading pace** (pages a day over the last two weeks) and an estimated finish date.
- **Reading journal**: each page update is logged, and a calendar heatmap is shaded by pages read each day, with streaks.
- **Book cards**: ratings in half stars, reviews, Markdown notes, tags, categories. Changes save as you go.
- **Rankings**: drag to order everything you've finished.
- **Year in Review**: reading goal, books per month, and how many of the books you own you've read.
- **Card Catalog**: filter and sort the whole library.
- **Search** (⌘K or /): search every title, author, category, tag, review, note and journal entry.
- **Add a book**: look it up on Open Library to fill in the cover, pages, ISBN, year and category.

**The room**
- **Night mode**: on automatically from 7pm to 7am, or set with the header button.
- **A reading lamp**: drag it anywhere on the page. Pull its chain to light the area beneath it, and brush it with the cursor to make it swing.
- **A window onto San Francisco**: the sky follows the city's real time of day, with live weather from Open-Meteo (fog, rain, clouds and more).

## Run it

```bash
cd ~/code/bookshelf
npm start            # → http://localhost:4321
```

You need Node 18 or newer. There are no dependencies to install.

## Your books are Markdown files

Each book is one `.md` file with YAML frontmatter, which Obsidian reads as *Properties*:

```markdown
---
title: Piranesi
author: Susanna Clarke
status: reading          # reading | tbr | wishlist | read | dnf
owned: true
rating: 4.5
rank: 3
pages: 272
progress: 141
started: 2026-10-20
tags:
  - fantasy
---

## Review

…

## Notes

…
```

## Syncing with Obsidian

Point the app at a folder inside your vault:

```bash
LIBRARY_DIR="~/Documents/MyVault/Books" npm start
```

The app and Obsidian then edit the same files:

- If you edit a note in Obsidian, the change shows up in the app when you switch back to its tab.
- Properties you add yourself (`series:`, `[[wikilinks]]`, nested fields) are kept exactly as you wrote them.
- Anything under `## Review` and `## Notes` shows up in the app. Extra headings like `### Chapter 3` stay inside your notes.
- Each book card has an **open in Obsidian** link.
- **Remove** moves the file to a hidden `.trash/` folder. Nothing is permanently deleted.

To move the sample books into your vault, copy them across:
`cp library/*.md ~/Documents/MyVault/Books/`. To start fresh, delete them instead.

### Optional: a Dataview table in Obsidian

````markdown
```dataview
TABLE author, rating, finished
FROM "Books"
WHERE status = "read"
SORT rank ASC
```
````

## Layout

```
server.js               small Node server + JSON API (no dependencies)
lib/frontmatter.js      YAML frontmatter reader/writer that keeps fields it doesn't know
public/                 the site
  index.html, styles.css, app.js
  categories.js         category list + guessing a category from Open Library subjects
  shelf-material.js     the shelf plank drawings (woods and metals)
  window.js             the San Francisco window
library/                your books (default location); .bookshelf.json holds goals and shelf order
```
