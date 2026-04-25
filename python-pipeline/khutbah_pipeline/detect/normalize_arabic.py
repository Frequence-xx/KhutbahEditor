import re
import unicodedata

# Unicode ranges for Arabic diacritics (tashkeel)
DIACRITICS = re.compile(r"[ً-ٰٟۖ-ۭ]")
ALEF_VARIANTS = re.compile(r"[آأإ]")  # آ أ إ → ا
WHITESPACE = re.compile(r"\s+")


def normalize_arabic(text: str) -> str:
    s = unicodedata.normalize("NFC", text)
    s = DIACRITICS.sub("", s)
    s = ALEF_VARIANTS.sub("ا", s)  # unify all alef forms to bare alef
    s = s.replace("ة", "ه")  # ة → ه (taa marbuta to haa)
    s = s.replace("ى", "ي")  # ى → ي (alef maqsura to yaa)
    s = s.lower()
    s = WHITESPACE.sub(" ", s).strip()
    return s
