"""تصنيف فيديوهات القنوات العربية: مواضيع، مستوى، نوع، لغة العنوان، وترتيب.

التصنيف قواعد واضحة على العنوان فقط (لا وصف ولا API مدفوع). هذا حدّ مقصود:
عنوان بلا كلمة مفتاحية لا يُصنّف إلا إذا كان حلقة من سلسلة (انظر build.py).
"""

import math
import re

from .normalize import has_keyword, normalize_ar

# (المعرّف، الاسم العربي، الكلمات المفتاحية)
TOPICS = [
    ("python", "بايثون", ["python", "بايثون", "django", "flask", "pandas", "numpy", "jupyter"]),
    ("javascript", "جافاسكربت", ["javascript", "جافاسكربت", "جافا سكريبت", "typescript", "تايب سكربت", "node", "nodejs", "node.js", "jquery"]),
    ("web", "تطوير الويب", ["html", "css", "react", "angular", "vue", "next.js", "nextjs", "tailwind", "bootstrap", "frontend", "front-end", "web", "ويب", "واجهات", "sass"]),
    ("php", "PHP", ["php", "laravel", "لارافيل", "wordpress", "ووردبريس", "symfony"]),
    ("java", "جافا", ["java", "جافا", "spring", "سبرينج"]),
    ("cpp", "C++", ["c++", "cpp", "سي بلس", "سي++"]),
    ("csharp", "C#", ["c#", "csharp", "سي شارب", "dotnet", ".net", "asp.net"]),
    ("mobile", "تطبيقات الموبايل", ["android", "اندرويد", "أندرويد", "ios", "flutter", "فلاتر", "swift", "kotlin", "كوتلن", "react native"]),
    ("database", "قواعد البيانات", ["sql", "mysql", "postgres", "postgresql", "mongodb", "sqlite", "database", "قواعد بيانات", "قاعدة بيانات", "داتا بيز", "اوراكل", "oracle", "redis"]),
    ("linux", "لينكس", ["linux", "لينكس", "ubuntu", "اوبونتو", "bash", "shell", "terminal", "تيرمنال", "unix", "يونكس"]),
    ("devops", "ديفوبس والسحابة", ["devops", "ديفوبس", "docker", "دوكر", "kubernetes", "k8s", "كوبرنيتيس", "aws", "cloud", "سحابة", "terraform", "ci/cd", "jenkins", "nginx"]),
    ("git", "Git", ["git", "جيت", "github", "جيثب", "gitlab", "version control"]),
    ("security", "الأمن السيبراني", ["security", "امن", "أمن", "اختراق", "هاكر", "هكر", "hacking", "hacker", "pentest", "penetration", "cyber", "سيبراني", "تشفير", "encryption", "malware", "ثغرات"]),
    ("ai", "الذكاء الاصطناعي", ["ai", "ذكاء اصطناعي", "machine learning", "تعلم الالة", "تعلم الآلة", "ml", "deep learning", "neural", "شبكات عصبية", "llm", "chatgpt", "gpt", "gemini", "claude", "نماذج لغوية"]),
    ("data", "تحليل البيانات", ["data science", "data analysis", "تحليل بيانات", "علم البيانات", "excel", "اكسل", "tableau", "power bi", "big data", "بيانات ضخمة"]),
    ("algorithms", "الخوارزميات", ["algorithm", "خوارزميات", "خوارزميه", "data structures", "هياكل البيانات", "هيكلة البيانات", "leetcode", "complexity"]),
    ("cs", "علوم الحاسب", ["computer science", "علوم الحاسب", "علوم الحاسوب", "operating system", "نظم التشغيل", "compiler", "مترجم", "architecture", "معمارية", "discrete math"]),
    ("testing", "الاختبار", ["testing", "اختبار", "pytest", "junit", "selenium", "playwright", "unit test", "qa"]),
    ("networking", "الشبكات", ["networking", "شبكات", "شبكه", "tcp", "dns", "http", "protocol", "بروتوكول", "cisco", "سيسكو"]),
    ("tools", "أدوات المطوّر", ["vscode", "vs code", "visual studio", "editor", "محرر", "ide", "ادوات", "tools"]),
]

TOPIC_LABELS = {tid: label for tid, label, _ in TOPICS}

_BEGINNER = ["مبتدئ", "للمبتدئين", "من الصفر", "اساسيات", "أساسيات", "مقدمه", "مقدمة", "beginner", "basics", "intro", "introduction", "crash course", "101"]
_ADVANCED = ["متقدم", "متقدمه", "advanced", "احتراف", "احترافي", "معمق", "deep dive", "internals", "expert"]

_COURSE = ["دوره", "كورس", "course", "سلسله", "bootcamp", "كامل", "كامله", "شامل", "شامله", "masterclass"]
_TALK = ["مؤتمر", "conference", "محاضره", "talk", "بودكاست", "podcast", "ندوه", "webinar"]
_PROJECT = ["مشروع", "project", "نبني", "بناء", "نصنع", "تطبيق", "clone"]
_EPISODE = re.compile(r"(الحلقه|الدرس|الجزء|المستوي|episode|lesson|\bpart\b|\bep\b|#\s*\d+)")


def _topic_ids(text_norm: str) -> list[str]:
    ids = [tid for tid, _, kws in TOPICS if any(has_keyword(text_norm, kw) for kw in kws)]
    # "جافا" و"java" تظهران داخل عناوين جافاسكربت بالعربية
    if "javascript" in ids and "java" in ids and ("سكريبت" in text_norm or "script" in text_norm):
        ids.remove("java")
    return ids


def _level(text_norm: str) -> str:
    if any(has_keyword(text_norm, kw) for kw in _ADVANCED):
        return "advanced"
    if any(has_keyword(text_norm, kw) for kw in _BEGINNER):
        return "beginner"
    return "any"


def _kind(text_norm: str, duration: int) -> str:
    if duration <= 120:
        return "short"
    if any(has_keyword(text_norm, kw) for kw in _TALK):
        return "talk"
    if any(has_keyword(text_norm, kw) for kw in _COURSE):
        return "course"
    if any(has_keyword(text_norm, kw) for kw in _PROJECT):
        return "project"
    return "tutorial"


def _title_lang(text_norm: str) -> str:
    letters = re.findall(r"[a-z\u0600-\u06FF]", text_norm)
    if not letters:
        return "mixed"
    arabic = sum(1 for ch in letters if "\u0600" <= ch <= "\u06FF")
    ratio = arabic / len(letters)
    if ratio >= 0.3:
        return "ar"
    return "en" if arabic == 0 else "mixed"


def is_episode(title: str) -> bool:
    return _EPISODE.search(normalize_ar(title)) is not None


def classify(title: str, duration: int, views: int, year: int) -> dict:
    """يعيد حقول التصنيف لفيديو واحد. year تقريبي من يوتيوب."""
    text = normalize_ar(title)
    topics = _topic_ids(text)
    kind = _kind(text, duration)
    recency = max(0.0, min(1.5, (year - 2016) / 10))
    kind_bonus = {"course": 0.4, "project": 0.2, "talk": 0.2}.get(kind, 0.0)
    topic_bonus = min(0.3, 0.15 * max(0, len(topics) - 1))
    score = round(math.log10(max(views, 0) + 10) + recency + kind_bonus + topic_bonus, 3)
    return {
        "topics": topics,
        "level": _level(text),
        "kind": kind,
        "lang": _title_lang(text),
        "score": score,
    }
