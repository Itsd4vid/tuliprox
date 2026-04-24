"""
Tuliprox Mapper - FastAPI backend
Helps users visually create mapping files for tuliprox.
"""

import io
import re
import uuid
import zipfile
from typing import Any

import requests
import yaml
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Tuliprox Mapper", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session storage: session_id -> {"files": {filename: content}}
sessions: dict[str, dict[str, Any]] = {}

VOD_KEYWORDS = [
    "VOD", "Movies", "Series", "FILMS", "Filmes",
    "Séries", "Siries", "Adults", "XXX",
]

M3U_USER_AGENT = "VLC/3.0.21 LibVLC/3.0.21"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_vod_group(group_title: str, extra_keywords: list[str] | None = None) -> bool:
    keywords = VOD_KEYWORDS + (extra_keywords or [])
    lower = group_title.lower()
    return any(k.lower() in lower for k in keywords)


def _parse_m3u_content(content: str, vod_keywords: list[str] | None = None) -> dict:
    groups: dict[str, dict] = {}
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("#EXTINF"):
            # Extract attributes
            tvg_id = ""
            tvg_logo = ""
            group_title = ""
            channel_name = ""

            id_match = re.search(r'tvg-id="([^"]*)"', line)
            if id_match:
                tvg_id = id_match.group(1)

            logo_match = re.search(r'tvg-logo="([^"]*)"', line)
            if logo_match:
                tvg_logo = logo_match.group(1)

            group_match = re.search(r'group-title="([^"]*)"', line)
            if group_match:
                group_title = group_match.group(1)

            name_match = re.search(r",(.+)$", line)
            if name_match:
                channel_name = name_match.group(1).strip()

            # Next line should be the URL
            url = ""
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line and not next_line.startswith("#"):
                    url = next_line
                    i += 1

            if not channel_name or not url:
                i += 1
                continue

            if _is_vod_group(group_title, vod_keywords):
                i += 1
                continue

            if group_title not in groups:
                groups[group_title] = {
                    "id": f"g{uuid.uuid4().hex[:8]}",
                    "name": group_title,
                    "channels": [],
                }

            groups[group_title]["channels"].append({
                "id": f"c{uuid.uuid4().hex[:8]}",
                "name": channel_name,
                "url": url,
                "logo": tvg_logo,
                "tvg_id": tvg_id,
            })

        i += 1

    return {"groups": list(groups.values())}


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------

def _sanitize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9_]", "_", name.lower()).strip("_")


def _generate_mapping_yml(mapping_id: str, groups: list[dict]) -> str:
    entries = []
    for group in groups:
        for ch in group.get("channels", []):
            entries.append({
                "filter": f'Name ~ "{ch["name"]}"',
                "script": f'@Group = "{group["name"]}"\n',
            })

    mapping_doc = {
        "mappings": {
            "mapping": [
                {
                    "id": mapping_id,
                    "mapper": entries,
                }
            ]
        }
    }
    return yaml.dump(mapping_doc, allow_unicode=True, sort_keys=False, default_flow_style=False)


def _generate_template_yml(groups: list[dict]) -> str:
    templates = []
    for group in groups:
        channels = group.get("channels", [])
        if not channels:
            continue
        template_name = _sanitize_name(group["name"]) + "_channels"
        parts = [f'Name ~ "{ch["name"]}"' for ch in channels]
        value = "(" + " OR ".join(parts) + ")"
        templates.append({"name": template_name, "value": value})

    template_doc = {"mappings": {"templates": templates}}
    return yaml.dump(template_doc, allow_unicode=True, sort_keys=False, default_flow_style=False)


def _generate_filter_snippet(groups: list[dict]) -> str:
    all_channels = []
    for group in groups:
        all_channels.extend(ch["name"] for ch in group.get("channels", []))

    parts = [f'(Name ~ "{name}")' for name in all_channels]
    filter_expr = " OR ".join(parts)

    lines = [
        "# Add this filter to your target in source.yml:",
        f"filter: '{filter_expr}'",
    ]
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def root():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.post("/api/parse")
async def parse_playlist(
    url: str | None = Form(default=None),
    vod_keywords: str | None = Form(default=None),
    file: UploadFile | None = File(default=None),
):
    extra_kw = [k.strip() for k in vod_keywords.split(",")] if vod_keywords else []

    content = ""
    if file is not None:
        raw = await file.read()
        content = raw.decode("utf-8", errors="replace")
    elif url:
        try:
            resp = requests.get(
                url,
                headers={"User-Agent": M3U_USER_AGENT},
                timeout=30,
            )
            resp.raise_for_status()
            content = resp.text
        except requests.RequestException as exc:
            raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {exc}") from exc
    else:
        raise HTTPException(status_code=400, detail="Provide either a URL or a file.")

    parsed = _parse_m3u_content(content, extra_kw)

    session_id = str(uuid.uuid4())
    sessions[session_id] = {"files": {}}

    return JSONResponse({"session_id": session_id, **parsed})


@app.post("/api/generate")
async def generate_files(
    payload: dict,
    x_session_id: str | None = Header(default=None),
):
    if not x_session_id or x_session_id not in sessions:
        x_session_id = str(uuid.uuid4())
        sessions[x_session_id] = {"files": {}}

    mapping_id = payload.get("mapping_id", "my_mapping")
    groups = payload.get("groups", [])

    mapping_yml = _generate_mapping_yml(mapping_id, groups)
    template_yml = _generate_template_yml(groups)
    filter_snippet = _generate_filter_snippet(groups)

    sessions[x_session_id]["files"] = {
        "mapping.yml": mapping_yml,
        "template.yml": template_yml,
        "filter_snippet.txt": filter_snippet,
    }

    return JSONResponse({
        "session_id": x_session_id,
        "files": {
            "mapping.yml": mapping_yml,
            "template.yml": template_yml,
            "filter_snippet.txt": filter_snippet,
        },
    })


@app.get("/api/download/{filename}")
async def download_file(
    filename: str,
    x_session_id: str | None = Header(default=None),
):
    if not x_session_id or x_session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")

    files = sessions[x_session_id].get("files", {})
    if filename not in files:
        raise HTTPException(status_code=404, detail="File not found.")

    content = files[filename]
    media_type = "text/yaml" if filename.endswith(".yml") else "text/plain"
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/download/zip/all")
async def download_zip(
    x_session_id: str | None = Header(default=None),
):
    if not x_session_id or x_session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found.")

    files = sessions[x_session_id].get("files", {})
    if not files:
        raise HTTPException(status_code=404, detail="No files generated yet.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="tuliprox_mapping.zip"'},
    )


app.mount("/static", StaticFiles(directory="static"), name="static")
