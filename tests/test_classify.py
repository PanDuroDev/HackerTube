from pipeline.classify import classify


def c(title, duration=900, views=1000, year=2025):
    return classify(title, duration, views, year)


def test_python_course_beginner():
    r = c("كورس لغة بايثون كامل من الصفر")
    assert "python" in r["topics"]
    assert r["level"] == "beginner"
    assert r["kind"] == "course"


def test_javascript_does_not_tag_java():
    r = c("دورة جافاسكربت للمبتدئين")
    assert "javascript" in r["topics"]
    assert "java" not in r["topics"]


def test_php_project():
    r = c("مشروع متجر إلكتروني بلارافيل من الصفر")
    assert "php" in r["topics"]
    assert r["kind"] == "project"


def test_advanced_level():
    r = c("شرح متقدم لهياكل البيانات")
    assert r["level"] == "advanced"
    assert "algorithms" in r["topics"]


def test_short_video_kind():
    r = c("نصيحة سريعة في بايثون", duration=60)
    assert r["kind"] == "short"


def test_no_topic_for_generic_title():
    assert c("فيديو جديد على القناة")["topics"] == []


def test_score_rewards_views():
    low = c("شرح بايثون", views=1_000)["score"]
    high = c("شرح بايثون", views=1_000_000)["score"]
    assert high > low


def test_unknown_level_is_explicit_for_generic_titles():
    r = c("فيديو جديد على القناة")
    assert r["level"] == "unknown"
    assert r["level_confidence"] == 0.0


def test_description_and_tags_contribute_to_classification():
    r = classify(
        "فيديو عملي",
        duration=900,
        views=1000,
        year=2025,
        description="Learn Python from scratch with a beginner friendly project.",
        tags=["python", "basics"],
    )
    assert "python" in r["topics"]
    assert r["level"] == "beginner"
    assert r["level_confidence"] > 0
