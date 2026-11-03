import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAIN_VIDEOS = ROOT / "public" / "data" / "videos.json"
HN_DATA = ROOT / "public" / "data" / "hacker-news"


def test_hacker_news_import_excludes_existing_video_ids():
    main = json.loads(MAIN_VIDEOS.read_text(encoding="utf-8"))
    imported = json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    existing = json.loads((HN_DATA / "existing.json").read_text(encoding="utf-8"))
    meta = json.loads((HN_DATA / "meta.json").read_text(encoding="utf-8"))

    main_ids = {video["id"] for video in main}
    imported_ids = [video["vid"] for video in imported]

    assert len(imported_ids) == len(set(imported_ids))
    assert not (main_ids & set(imported_ids))
    assert set(existing) == (main_ids & {video["vid"] for video in imported + list(existing.values())})
    assert len(imported) == meta["imported_videos"]
    assert len(existing) == meta["excluded_existing_videos"]
    assert meta["source_videos"] == len(imported) + len(existing)


def test_hacker_news_auxiliary_assets_are_complete():
    videos = json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    existing = json.loads((HN_DATA / "existing.json").read_text(encoding="utf-8"))
    source_ids = {video["vid"] for video in videos} | set(existing)

    embedding_ids = json.loads((HN_DATA / "embedding_ids.json").read_text(encoding="utf-8"))
    embeddings = (HN_DATA / "embeddings.npy").read_bytes()
    assert len(embedding_ids) == len(set(embedding_ids)) == len(source_ids)
    assert set(embedding_ids) == source_ids
    assert embeddings.startswith(b"\\x93NUMPY")
    assert len(embeddings) > 4_000_000
    assert (HN_DATA / "DATA.md").is_file()

    related = json.loads((HN_DATA / "related.json").read_text(encoding="utf-8"))
    assert len(related) == 3778
    assert set(related) <= source_ids
    assert all(
        item["vid"] in source_ids
        for neighbours in related.values()
        for item in neighbours
    )


def test_hacker_news_comments_are_complete_and_partitioned():
    source_ids = {
        video["vid"] for video in json.loads((HN_DATA / "videos.json").read_text(encoding="utf-8"))
    }
    existing_ids = set(json.loads((HN_DATA / "existing.json").read_text(encoding="utf-8")))
    comment_count = 0
    partition_ids = set()

    for path in (HN_DATA / "mentions").glob("*.json.gz"):
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            partition = json.load(stream)
        for video_id, comments in partition.items():
            assert video_id[0] == path.stem.removesuffix(".json")
            assert video_id in source_ids | existing_ids
            assert isinstance(comments, list)
            partition_ids.add(video_id)
            comment_count += len(comments)

    meta = json.loads((HN_DATA / "meta.json").read_text(encoding="utf-8"))
    assert comment_count == meta["mentions"]
    assert len(list((HN_DATA / "mentions").glob("*.json.gz"))) == meta["mention_partitions"]
    assert len(partition_ids) > 0
