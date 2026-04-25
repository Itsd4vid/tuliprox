# Tuliprox Mapper

A standalone visual tool for creating **mapping files** for the [tuliprox](https://github.com/euzu/tuliprox) IPTV proxy server. Instead of hand-writing YAML, use this browser-based wizard to import an M3U playlist, select the channels you want, organize them into new groups, and export ready-to-use config files.

## Features

- **Import** an M3U playlist from a URL or local file upload
- **Auto-filters** VOD/Movies/Series groups — only live channels are shown
- **3-step wizard UI** with a polished dark theme
- **Drag-and-drop** channel organizer (powered by SortableJS)
- **Generates** three files: `mapping.yml`, `template.yml`, `filter_snippet.txt`
- Copy to clipboard or download individually / as a ZIP

## Requirements

- Python 3.10 or newer
- `pip`

## Installation & Running

### Linux / macOS

```bash
cd tools/mapper
chmod +x run.sh
./run.sh
```

### Windows

```bat
cd tools\mapper
run.bat
```

Then open **http://localhost:8765** in your browser.

## Usage

### Step 1 — Import & Filter Groups

1. Paste your M3U URL into the input field and click **Load Playlist**, or drag-and-drop / click to upload a local `.m3u` file.
2. The tool fetches the playlist and automatically filters out VOD, Movies, Series, and adult content groups.
3. A list of live groups is shown with channel counts and logo previews.
4. **Uncheck** any groups you want to exclude from the mapping, then click **Next →**.

### Step 2 — Select Channels

1. Each selected group is shown as an expandable accordion.
2. Click individual channel cards to toggle selection, or use the **All** / **None** buttons per group.
3. A global progress bar shows how many channels are selected.
4. Click **Next →** when done.

### Step 3 — Organize & Generate

1. The **left panel** shows all your selected channels, grouped by their original source group.
2. The **right panel** is your final playlist layout:
   - Click **＋ Add Group** to create a new target group.
   - **Drag** channels from the left panel into any right-panel group.
   - Channels can be **reordered** within a group by dragging.
   - Click ✕ on a channel in the right panel to send it back to the source.
   - Double-click a group name in the right panel to rename it.
3. Set your **Mapping ID** (used as the `id` field in `mapping.yml`).
4. Click **⚡ Generate Files**.

### Step 4 — Export

- **Preview** each generated file by clicking its card.
- **Copy** a file to your clipboard with the 📋 button.
- **Download** a single file with the ⬇️ button on the card.
- **Download All (ZIP)** downloads all three files in a single archive.

## Applying the Generated Files to Tuliprox

### `mapping.yml`

Contains the mapper rules that assign each channel to a group. Copy or merge this into your tuliprox `config/` directory. Then reference the mapping ID in your `source.yml`:

```yaml
targets:
  - name: my_target
    mapping: my_mapping   # <-- your mapping ID
```

### `template.yml`

Contains named filter templates — one per output group — that you can reuse in `source.yml` filters:

```yaml
filter: '!portugal_channels!'
```

### `filter_snippet.txt`

A ready-made `filter` expression covering every selected channel. Paste it directly into the `filter` field of a target in `source.yml`.

## Project Structure

```
tools/mapper/
├── main.py             # FastAPI backend
├── requirements.txt    # Python dependencies
├── run.sh              # Linux/macOS launcher
├── run.bat             # Windows launcher
├── README.md           # This file
└── static/
    ├── index.html      # Single-page app shell
    ├── app.js          # All frontend logic
    └── style.css       # Dark-theme stylesheet
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the SPA |
| `POST` | `/api/parse` | Parses an M3U URL or uploaded file |
| `POST` | `/api/generate` | Generates the three output files |
| `GET` | `/api/download/{filename}` | Downloads a single generated file |
| `GET` | `/api/download/zip/all` | Downloads all files as a ZIP archive |
