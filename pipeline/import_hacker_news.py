"""Import the Hacker News export without duplicating videos already in the site index.

Run from the repository root:
    python -m pipeline.import_hacker_news
"""

from __future__ import annotations

import gzip
import json
import re
import shutil
import unicodedata
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

PUBLISHED_LAYOUT_NOTE = b"""

## Published layout

This directory contains the generated site-ready files, not the source JSONL files:

- `videos.json`: an array of video records, keyed by `vid`.
- `existing.json`: source video records already represented in the main catalog, keyed by canonical YouTube ID.
- `aliases.json`: duplicate source IDs mapped to their canonical video ID.
- `related.json`: related-video records. Join `vid` and `related[].vid` to `videos.json` or `existing.json`.
- `mentions/<prefix>.json.gz`: gzip-compressed JSON objects grouped by canonical video ID. Each comment's `vid` joins to `videos.json` or `existing.json`.
- `taxonomy.json`: the topic tree. Join `videos.categories[].id` to category `id`.
- `embeddings.npy` and `embedding_ids.json`: row `i` maps to `embedding_ids.json[i]`, then to the source video's `vid`.
"""


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


def normalize_identity(value: str) -> str:
    """Normalize punctuation, casing, and Unicode for title/channel comparisons."""
    text = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(re.findall(r"[^\W_]+", text, flags=re.UNICODE))


def load_existing_records() -> list[dict]:
    if not SITE_INDEX.exists():
        raise SystemExit(f"Missing site index: {SITE_INDEX}")
    try:
        records = json.loads(SITE_INDEX.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid site index JSON: {exc}") from exc
    if not isinstance(records, list) or not all(isinstance(record, dict) for record in records):
        raise SystemExit("The site index must be a JSON array of objects.")
    if any(not isinstance(record.get("id"), str) for record in records):
        raise SystemExit("Every site index record must contain a string video id.")
    return records


def import_archive() -> dict[str, int]:
    if not ARCHIVE.is_file():
        raise SystemExit(f"Missing source archive: {ARCHIVE}")

    existing_records = load_existing_records()
    existing_by_id = {record["id"]: record for record in existing_records}
    existing_ids = set(existing_by_id)
    existing_by_title: dict[tuple[str, str], list[str]] = defaultdict(list)
    for record in existing_records:
        key = (
            normalize_identity(record.get("title", "")),
            normalize_identity(record.get("channel", "")),
        )
        if all(key):
            existing_by_title[key].append(record["id"])

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

        # The export is score-sorted. Prefer an exact site match, then an
        # existing title+channel match, otherwise the highest-ranked source row.
        groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
        for record in source_videos:
            key = (
                normalize_identity(record["title"]),
                normalize_identity(record.get("channel", "")),
            )
            groups[key].append(record)

        aliases: dict[str, str] = {}
        canonical_records: dict[str, dict] = {}
        for key, grouped_records in groups.items():
            exact_existing = next(
                (item for item in grouped_records if item["vid"] in existing_ids), None
            )
            title_existing_ids = existing_by_title.get(key, [])
            canonical_id = (
                exact_existing["vid"] if exact_existing
                else title_existing_ids[0] if title_existing_ids
                else grouped_records[0]["vid"]
            )
            canonical_record = next(
                (item for item in grouped_records if item["vid"] == canonical_id),
                grouped_records[0],
            )
            canonical_records[canonical_id] = canonical_record
            for item in grouped_records:
                if item["vid"] != canonical_id:
                    aliases[item["vid"]] = canonical_id

        overlaps = {
            video_id: canonical_records[video_id]
            for video_id in canonical_records if video_id in existing_ids
        }
        new_videos = [
            record for video_id, record in canonical_records.items()
            if video_id not in existing_ids
        ]

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
            source_id = mention.get("vid")
            if source_id not in by_id:
                raise ValueError(f"Mention refers to an unknown video id: {source_id!r}")
            canonical_id = aliases.get(source_id, source_id)
            normalized_mention = dict(mention)
            if canonical_id != source_id:
                normalized_mention["original_vid"] = source_id
                normalized_mention["vid"] = canonical_id
            mentions_by_prefix[canonical_id[0]][canonical_id].append(normalized_mention)
            mention_count += 1
            if canonical_id in overlaps:
                mentions_for_existing += 1

        # Keep canonical counters aligned with the comments published after alias remapping.
        for video_id, video in canonical_records.items():
            comments = mentions_by_prefix[video_id[0]].get(video_id, [])
            hn = dict(video.get("hn") or {})
            stance_counts: dict[str, int] = defaultdict(int)
            for comment in comments:
                stance = comment.get("stance")
                if isinstance(stance, str) and stance:
                    stance_counts[stance] += 1
            recommended = [
                comment for comment in comments
                if comment.get("stance") in {"rec", "strong_rec"}
            ]
            hn["mentions"] = len(comments)
            hn["stances"] = dict(sorted(stance_counts.items()))
            hn["recommenders"] = len({
                comment["author"] for comment in recommended
                if isinstance(comment.get("author"), str) and comment["author"]
            })
            hn["rec_months"] = len({
                comment["month"] for comment in recommended
                if isinstance(comment.get("month"), str) and comment["month"]
            })
            hn["strong_recs"] = sum(
                comment.get("stance") == "strong_rec" for comment in comments
            )
            video["hn"] = hn

        related_build: dict[str, dict[str, dict]] = defaultdict(dict)
        for record in read_jsonl(archive, SOURCE_ROOT + "related.jsonl"):
            source_id = record.get("vid")
            if source_id not in by_id:
                continue
            video_id = aliases.get(source_id, source_id)
            for item in record.get("related") or []:
                source_related_id = item.get("vid")
                if source_related_id not in by_id:
                    continue
                related_id = aliases.get(source_related_id, source_related_id)
                if related_id == video_id:
                    continue
                entry = dict(item)
                entry["vid"] = related_id
                current = related_build[video_id].get(related_id)
                if current:
                    entry["shared_recommenders"] = max(
                        int(current.get("shared_recommenders") or 0),
                        int(entry.get("shared_recommenders") or 0),
                    )
                related_build[video_id][related_id] = entry
        related = {
            video_id: sorted(
                items.values(),
                key=lambda item: (-int(item.get("shared_recommenders") or 0), item["vid"]),
            )
            for video_id, items in related_build.items()
        }

        taxonomy = json.loads(archive.read(SOURCE_ROOT + "taxonomy.json").decode("utf-8"))

    if len(new_videos) + len(overlaps) + len(aliases) != len(source_videos):
        raise AssertionError("Imported, pre-existing, and duplicate source counts do not match.")

    # Remove stale partitions before writing a reproducible snapshot.
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "mentions").mkdir(parents=True)

    write_json(OUT / "videos.json", new_videos)
    write_json(OUT / "existing.json", overlaps)
    write_json(OUT / "aliases.json", aliases)
    write_json(OUT / "related.json", related)
    write_json(OUT / "taxonomy.json", taxonomy, compact=False)
    write_json(OUT / "embedding_ids.json", embedding_ids)
    (OUT / "embeddings.npy").write_bytes(embeddings)
    (OUT / "DATA.md").write_bytes(data_documentation + PUBLISHED_LAYOUT_NOTE)
    for prefix, grouped in sorted(mentions_by_prefix.items()):
        write_gzip_json(OUT / "mentions" / f"{prefix}.json.gz", grouped)

    stats = {
        "source_videos": len(source_videos),
        "canonical_source_videos": len(canonical_records),
        "imported_videos": len(new_videos),
        "excluded_existing_videos": len(overlaps),
        "duplicate_title_video_ids": len(aliases),
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
        "attribution": "Credit HackerTube and open-index/hacker-news; video titles and channel names belong to their creators; comments remain their authors' work.",
        **stats,
        "deduplication": "Exact YouTube video ID, then normalized title+channel against the main catalog and within this source archive.",
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
