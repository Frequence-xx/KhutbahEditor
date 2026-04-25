import re
import unicodedata

# Unicode ranges for Arabic diacritics (tashkeel)
DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭ]")
# Alef variants: آ أ إ ٱ → ا. Includes alef wasla (ٱ U+0671) used in Quranic script.
ALEF_VARIANTS = re.compile(r"[آأإٱ]")
WHITESPACE = re.compile(r"\s+")
TATWEEL = "ـ"   # ـ — used to elongate text


def normalize_arabic(text: str) -> str:
    s = unicodedata.normalize("NFC", text)
    s = DIACRITICS.sub("", s)
    s = ALEF_VARIANTS.sub("ا", s)
    s = s.replace(TATWEEL, "")
    s = s.replace("ة", "ه")  # ة → ه (taa marbuta to haa)
    s = s.replace("ى", "ي")  # ى → ي (alef maqsura to yaa)
    s = s.lower()
    s = WHITESPACE.sub(" ", s).strip()
    return s
