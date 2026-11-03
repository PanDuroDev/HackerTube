import gzip
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN_VIDEOS = ROOT / "public" / "data" / "videos.json"
HN_DATA = ROOT / "public" / "data" / "hacker-news"
HN_ASSETS = ROOT / "data" / "hacker-news"
PROGRAMMING_AREAS = {
    "software",
    "systems-security",
    "ai-data",
    "math-theory",
    "hardware",
    "computing-history-culture",
    "design-graphics-media",
    "games",
}


def normalized(value):
    text = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(re.findall(r"[^\W_]+", text, flags=re.UNICODE))


def test_title_channel_normalization_ignores_punctuation_and_case():
    assert normalized("Rust: Systems Programming!") == normalized("RUST systems-programming")
    assert normalized("C++ / C#") == normalized("C C")
    assert normalized("Málaga café") == normalized("MÁLAGA CAFÉ")


def test_hacker_news_import_excludes_existing_and_duplicate_videos():
    main = json.loads(MAIN_VIDEOS.read_text(encoding="utf-8"))
    imported = json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    existing = json.loads((HN_DATA / "existing.json").read_text(encoding="utf-8"))
    aliases = json.loads((HN_DATA / "aliases.json").read_text(encoding="utf-8"))
    meta = json.loads((HN_DATA / "meta.json").read_text(encoding="utf-8"))

    main_ids = {video["id"] for video in main}
    imported_ids = {video["vid"] for video in imported}
    main_titles = {
        (normalized(video.get("title")), normalized(video.get("channel")))
        for video in main
    }
    imported_titles = [
        (normalized(video.get("title")), normalized(video.get("channel")))
        for video in imported
    ]

    assert len(imported_ids) == len(imported)
    assert not (main_ids & imported_ids)
    assert set(existing) <= main_ids
    assert not (main_titles & set(imported_titles))
    assert len(imported_titles) == len(set(imported_titles))
    assert set(aliases).isdisjoint(set(aliases.values()))
    assert set(aliases.values()) <= imported_ids | set(existing)
    assert len(imported) == meta["imported_videos"]
    assert len(existing) == meta["excluded_existing_videos"]
    assert len(aliases) == meta["duplicate_title_video_ids"]
    assert meta["source_videos"] == len(imported) + len(existing) + len(aliases)
    assert meta["canonical_source_videos"] == len(imported) + len(existing)


def test_hacker_news_comments_are_complete_and_partitioned():
    imported = json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    existing = json.loads((HN_DATA / "existing.json").read_text(encoding="utf-8"))
    aliases = json.loads((HN_DATA / "aliases.json").read_text(encoding="utf-8"))
    canonical_ids = {video["vid"] for video in imported} | set(existing)
    comment_count = 0
    partition_ids = set()
    comments_by_video = {}
    alias_comments = 0
    partition_paths = sorted((HN_DATA / "mentions").glob("*.json.gz"))
    assert len({path.name.casefold() for path in partition_paths}) == len(partition_paths)
    assert all(path.name == path.name.lower() for path in partition_paths)

    for path in partition_paths:
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            partition = json.load(stream)
        for video_id, comments in partition.items():
            assert video_id[0].lower() == path.name[0]
            assert video_id in canonical_ids
            assert isinstance(comments, list)
            partition_ids.add(video_id)
            comments_by_video.setdefault(video_id, []).extend(comments)
            comment_count += len(comments)
            for comment in comments:
                if "original_vid" in comment:
                    alias_comments += 1
                    assert aliases[comment["original_vid"]] == video_id
                    assert comment["vid"] == video_id

    meta = json.loads((HN_DATA / "meta.json").read_text(encoding="utf-8"))
    assert comment_count == meta["mentions"] == 39_834
    assert alias_comments > 0
    canonical_records = imported + list(existing.values())
    assert {
        video["vid"] if "vid" in video else video["id"]
        for video in canonical_records
    } == canonical_ids
    for video in canonical_records:
        video_id = video.get("vid", video.get("id"))
        assert video.get("hn", {}).get("mentions") == len(comments_by_video.get(video_id, []))
    assert len(partition_paths) == meta["mention_partitions"]
    assert "case-insensitive" in meta["comments_format"]
    assert partition_ids


def test_hacker_news_auxiliary_assets_are_complete():
    imported = json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    existing = json.loads((HN_DATA / "existing.json").read_text(encoding="utf-8"))
    aliases = json.loads((HN_DATA / "aliases.json").read_text(encoding="utf-8"))
    canonical_ids = {video["vid"] for video in imported} | set(existing)
    embedding_ids = json.loads((HN_ASSETS / "embedding_ids.json").read_text(encoding="utf-8"))
    source_ids = {video["vid"] for video in imported} | set(aliases) | (set(existing) & set(embedding_ids))
    embeddings = (HN_ASSETS / "embeddings.npy").read_bytes()
    assert len(embedding_ids) == len(set(embedding_ids)) == 6_454
    assert set(embedding_ids) == source_ids
    assert embeddings.startswith(bytes([0x93]) + b"NUMPY")
    assert len(embeddings) > 4_000_000
    assert (HN_DATA / "DATA.md").is_file()
    assert not (HN_DATA / "embeddings.npy").exists()
    assert not (HN_DATA / "embedding_ids.json").exists()
    assert not (HN_DATA / "taxonomy.json").exists()

    related = json.loads((HN_DATA / "related.json").read_text(encoding="utf-8"))
    assert set(related) <= canonical_ids
    assert all(
        item["vid"] in canonical_ids
        for neighbours in related.values()
        for item in neighbours
    )

    meta = json.loads((HN_DATA / "meta.json").read_text(encoding="utf-8"))
    assert meta["embedding_rows"] == 6_454
    assert meta["embedding_dimensions"] == 384
    taxonomy = json.loads((HN_ASSETS / "taxonomy.json").read_text(encoding="utf-8"))
    taxonomy_areas = taxonomy.get("areas", [])
    taxonomy_categories = sum(len(area.get("categories", [])) for area in taxonomy_areas)
    assert len(taxonomy_areas) == meta["taxonomy_areas"] == 16
    assert taxonomy_categories == meta["taxonomy_categories"] == 150
    assert meta["data_license"] == "ODC-By 1.0"
    published_docs = (HN_DATA / "DATA.md").read_text(encoding="utf-8")
    assert "## Published layout" in published_docs
    assert "`videos.json`" in published_docs
    assert "`mentions/<prefix>.json.gz`" in published_docs


def test_hacker_news_preview_is_programming_only_and_score_sorted():
    imported = json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    preview = json.loads((HN_DATA / "videos-preview.json").read_text(encoding="utf-8"))
    meta = json.loads((HN_DATA / "meta.json").read_text(encoding="utf-8"))
    imported_ids = {video["vid"] for video in imported}

    assert len(preview) == meta["preview_videos"] == 36
    assert all(video["vid"] in imported_ids for video in preview)
    assert all(
        any(category.get("area") in PROGRAMMING_AREAS for category in video.get("categories") or [])
        for video in preview
    )
    scores = [float(video.get("score") or 0) for video in preview]
    assert scores == sorted(scores, reverse=True)
    published_docs = (HN_DATA / "DATA.md").read_text(encoding="utf-8")
    assert "`videos-preview.json`" in published_docs
    assert "data/hacker-news/" in published_docs
