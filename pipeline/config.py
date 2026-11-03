"""قائمة القنوات العربية البرمجية التي نبني عليها الفهرس.

المعرّفات ثابتة (channel_id) حتى لا تتغير بتغيّر الاسم أو الهاندل.
"""

CHANNELS = [
    ("UCSNkfKl4cU-55Nm-ovsvOHQ", "Elzero Web School"),
    ("UCgntwWFdMDPq0eNhaQ0LHIQ", "TheNewBaghdad"),
    ("UCveX_0uBOHVHbpV838OGXVA", "Codezilla"),
    ("UCbQh1yxBPVhyjB-G_blFFEQ", "Abdelrahman Gamal"),
    ("UCa--uYErOqjm8qT576P1hMQ", "Adel Nasim"),
    ("UCuEOSK8blSM6j5jxVp3ttnQ", "Programming Advices"),
    ("UCxxljM6JkSvJVSD_T90ZnMw", "Hesham Asem"),
    ("UCJv37tcBvJlBF2MoVMRMvbQ", "أكاديمية حسوب"),
    ("UCrgG9J-S4NaHfNkvtMthRDA", "Algorithmiat - خوارزميات"),
    ("UCaGo8x7uqxMK5A08AI8s6IQ", "QAcart"),
    ("UC1fxEAVE-_N9mDL7APCkeOQ", "freeCodeCamp Arabic"),
    ("UCWX_0VvMxl0_XosvYOZ7O0g", "Mohamed El Desouki"),
    ("UCFnqbM05-W4VpmzZj36-Kog", "Mohamed Elkashef"),
    ("UCnGblT_CyMwswTIH9QmJ3YQ", "Ghareeb Elshaikh"),
    ("UCGP8LgaWO1lLfFQUQ2BA7rA", "Yehia Tech"),
    ("UC5COvx1Z8fnfvVkafqL_UZg", "اتعلم ببساطة"),
    ("UC4Y8dVfo_-aydzENDmE7wTw", "Ali Shahin"),
    ("UCOApBrMjpXbBAii6d0187ww", "Ziad Emad"),
    ("UCIKDaj_tCR7ntiwM71DfaBg", "CodeRK"),
    ("UCBNZ0VoN2u_4NT8kbmGgUzQ", "Coder Shiyar"),
    ("UC9ocsRoOwj9tkAQNfUt8ZJg", "Python Arabic Community"),
    ("UCFxKAFDw_jaHh0Q4ndE9nmQ", "بايثون بالعربي"),
]

# حد أقصى لكل قناة: أحدث 300 فيديو. رفع الرقم يوسّع التغطية ويبطئ الجلب.
MAX_PER_CHANNEL = 300
MIN_DURATION = 60  # ثانية؛ تحتها shorts غالبًا بلا قيمة تعليمية
