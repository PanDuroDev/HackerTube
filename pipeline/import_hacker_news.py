"""Import the Hacker News export without duplicating videos already in the site index.

Run from the repository root:
    python -m pipeline.import_hacker_news
"""

from __future__ import annotations

import gzip
import json
import re
import shutil
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "hackertube-data.zip"
SITE_INDEX = ROOT / "public" / "data" / "videos.json"
OUT = ROOT / "public" / "data" / "hacker-news"
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
SOURCE_ROOT = "hackertube-data/"


def read_jsonl(archive: zipfile.ZipFile, member: str):
    """Yield JSON objects from one UTF-8 JSONL member."""
    with archive.open(member) as stream:
        for line_number, raw in enumerate(stream, start=1):
            if not raw.strip():
                continue
            try:
                value = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"Invalid JSON in {member}:{line_number}") from exc
            if not isinstance(value, dict):
                raise ValueError(f"Expected an object in {member}:{line_number}")
            yield value


def write_json(path: Path, value: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    indent = None if compact else 2
    separators = (",", ":") if compact else None
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=indent, separators=separators) + "\n",
        encoding="utf-8",
    )


def write_gzip_json(path: Path, value: Any) -> None:
    """Write deterministic gzip JSON to keep the comment payload compact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    with path.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as compressed:
            compressed.write(payload)


def load_existing_ids() -> set[str]:
    if not SITE_INDEX.exists():
        raise SystemExit(f"Missing site index: {SITE_INDEX}")
    try:
        records = json.loads(SITE_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid site index JSON: {exc}") from exc
    if not isinstance(records, list):
        raise SystemExit("The site index must be a JSON array.")
    ids = {record.get("id") for record in records if isinstance(record, dict)}
    return {video_id for video_id in ids if isinstance(video_id, str)}


def import_archive() -> dict[str, int]:
    if not ARCHIVE.is_file():
        raise SystemExit(f"Missing source archive: {ARCHIVE}")

    existing_ids = load_existing_ids()
    with zipfile.ZipFile(ARCHIVE) as archive:
        names = set(archive.namelist())
        required = {
            SOURCE_ROOT + "videos.jsonl",
            SOURCE_ROOT + "mentions.jsonl",
            SOURCE_ROOT + "related.jsonl",
            SOURCE_ROOT + "taxonomy.json",
            SOURCE_ROOT + "embedding_ids.json",
            SOURCE_ROOT + "embeddings.npy",
            SOURCE_ROOT + "DATA.md",
        }
        missing = sorted(required - names)
        if missing:
            raise SystemExit("Archive is missing required files: " + ", ".join(missing))

        source_videos = list(read_jsonl(archive, SOURCE_ROOT + "videos.jsonl"))
        by_id: dict[str, dict] = {}
        for record in source_videos:
            video_id = record.get("vid")
            if not isinstance(video_id, str) or not VIDEO_ID.fullmatch(video_id):
                raise ValueError(f"Invalid YouTube video id: {video_id!r}")
            if video_id in by_id:
                raise ValueError(f"Duplicate video id in source archive: {video_id}")
            if not record.get("title") or not record.get("url"):
                raise ValueError(f"Incomplete video record: {video_id}")
            by_id[video_id] = record

        overlaps = {video_id: by_id[video_id] for video_id in by_id if video_id in existing_ids}
        new_videos = [record for record in source_videos if record["vid"] not in existing_ids]

        embedding_ids = json.loads(archive.read(SOURCE_ROOT + "embedding_ids.json").decode("utf-8"))
        if len(embedding_ids) != len(set(embedding_ids)) or set(embedding_ids) != set(by_id):
            raise ValueError("Embedding IDs must uniquely cover every source video.")
        embeddings = archive.read(SOURCE_ROOT + "embeddings.npy")
        if not embeddings.startswith(bytes([0x93]) + b"NUMPY"):
            raise ValueError("embeddings.npy has an invalid NumPy file signature.")
        data_documentation = archive.read(SOURCE_ROOT + "DATA.md")

        mentions_by_prefix: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
        mention_count = 0
        mentions_for_existing = 0
        for mention in read_jsonl(archive, SOURCE_ROOT + "mentions.jsonl"):
            video_id = mention.get("vid")
            if video_id not in by_id:
                raise ValueError(f"Mention refers to an unknown video id: {video_id!r}")
            mentions_by_prefix[video_id[0]][video_id].append(mention)
            mention_count += 1
            if video_id in overlaps:
                mentions_for_existing += 1

        related: dict[str, list[dict]] = {}
        for record in read_jsonl(archive, SOURCE_ROOT + "related.jsonl"):
            video_id = record.get("vid")
            if video_id in by_id:
                related[video_id] = record.get("related") or []

        taxonomy = json.loads(archive.read(SOURCE_ROOT + "taxonomy.json").decode("utf-8"))

    if len(new_videos) + len(overlaps) != len(source_videos):
        raise AssertionError("Imported and pre-existing video counts do not match source count.")

    # Remove stale partitions before writing a reproducible snapshot.
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "mentions").mkdir(parents=True)

    write_json(OUT / "videos.json", new_videos)
    write_json(OUT / "existing.json", overlaps)
    write_json(OUT / "related.json", related)
    write_json(OUT / "taxonomy.json", taxonomy, compact=False)
    write_json(OUT / "embedding_ids.json", embedding_ids)
    (OUT / "embeddings.npy").write_bytes(embeddings)
    (OUT / "DATA.md").write_bytes(data_documentation)
    for prefix, grouped in sorted(mentions_by_prefix.items()):
        write_gzip_json(OUT / "mentions" / f"{prefix}.json.gz", grouped)

    stats = {
        "source_videos": len(source_videos),
        "imported_videos": len(new_videos),
        "excluded_existing_videos": len(overlaps),
        "mentions": mention_count,
        "mentions_for_existing_videos": mentions_for_existing,
        "related_video_records": len(related),
        "taxonomy_areas": len(taxonomy.get("areas", [])),
        "taxonomy_categories": sum(
            len(area.get("categories", [])) for area in taxonomy.get("areas", [])
        ),
        "mention_partitions": len(mentions_by_prefix),
        "embedding_rows": len(embedding_ids),
        "embedding_dimensions": 384,
        "embedding_dtype": "float16",
        "embedding_model": "BAAI/bge-small-en-v1.5",
    }
    meta = {
        "source": "HackerTube (https://hackertube.org), derived from open-index/hacker-news",
        "source_archive": "hackertube-data.zip",
        "source_export_date": "2026-10-31",
        "data_license": "ODC-By 1.0",
        "attribution": "Credit HackerTube and open-index/hacker-news; original comments remain their authors' work.",
        **stats,
        "deduplication": "Exact YouTube video ID against public/data/videos.json",
        "comments_format": "Gzip-compressed JSON objects partitioned by the first YouTube ID character.",
    }
    write_json(OUT / "meta.json", meta, compact=False)
    return stats


def main() -> None:
    stats = import_archive()
    print("Hacker News data import completed:")
    for name, value in stats.items():
        print(f"- {name}: {value}")


if __name__ == "__main__":
    main()
