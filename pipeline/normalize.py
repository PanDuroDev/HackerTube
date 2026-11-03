"""تطبيع النص العربي: البحث ومطابقة الكلمات المفتاحية.

نفس القواعد مطبّقة داخل app.js على نص البحث، فاختبر الاثنين معًا عند التعديل.
"""

import re

_TASHKEEL = re.compile(r"[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]")
_KEEP = re.compile(r"[^\w\u0600-\u06FF+#.]+")


def normalize_ar(text: str) -> str:
    """توحيد الهمزات والتاء المربوطة والألف المقصورة وحذف التشكيل والتطويل."""
    s = (text or "").lower()
    s = _TASHKEEL.sub("", s)
    s = s.replace("\u0640", "")  # ـ التطويل
    s = re.sub("[إأآٱ]", "ا", s)
    s = s.replace("ى", "ي").replace("ة", "ه")
    s = s.replace("ؤ", "و").replace("ئ", "ي")
    s = _KEEP.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()


def has_keyword(text_norm: str, keyword: str) -> bool:
    """مطابقة كلمة كاملة داخل نص مطبّع.

    العربية تلتصق بها حروف الجر والواو (بلارافيل، وهياكل)، فنسمح بها قبل الكلمة
    بدل مطابقة حدود صارمة تُفوّت المحتوى.
    """
    k = normalize_ar(keyword)
    if not k:
        return False
    if re.search(r"[\u0600-\u06FF]", k):
        pattern = rf"(?:^|\s)(?:[وبلكف]?ال|[وبلكف])?{re.escape(k)}(?=$|\s)"
    else:
        pattern = rf"(?<![\w\u0600-\u06FF]){re.escape(k)}(?![\w\u0600-\u06FF])"
    return re.search(pattern, text_norm) is not None
