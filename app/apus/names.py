"""Species names (notebook §4): every name is translated to Perch's, trying in turn the user's synonyms
file, Perch's own name, the built-in table, then an eBird code."""
import re
from functools import lru_cache
from pathlib import Path

import pandas as pd

# eBird/Clements 2021 names (BirdNET's) that Perch 2.0 spells differently, checked against iNaturalist.
# Copied unchanged from the notebook's §4 table; it covers every BirdNET V2.4 bird but 17.
BUILTIN_SYNONYMS_TEXT = (Path(__file__).parent / "builtin_synonyms.txt").read_text(encoding="utf-8")


def norm(name):
    """'Turdus_merula ' -> 'turdus merula'."""
    return re.sub(r"[\s_]+", " ", str(name)).strip().lower()


def label_words(label):
    """The words of a label, without '_' and without trailing numbers such as '1 0 0'."""
    words = str(label).replace("_", " ").split()
    while words and re.fullmatch(r"[-+\d.]+", words[-1]):
        words.pop()
    return words


def read_species_list(path):
    """The first field (',', ';' or tab separated) of every line of a list file."""
    lines = Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    return [re.split(r"[,;\t]", ln)[0].strip() for ln in lines if ln.strip()]


class Names:
    """Perch's classes and the tables that lead to them."""

    def __init__(self, class_names, class_codes, synonyms_file=None, messages=None):
        self.class_names = list(class_names)
        self.by_name = {norm(n): n for n in self.class_names}
        self.by_code = {c.lower(): n for n, c in zip(self.class_names, class_codes) if c and c != "no_ebird_code"}
        self.builtin = {norm(old): self.by_name[norm(new)]
                        for old, new in (ln.split(";") for ln in BUILTIN_SYNONYMS_TEXT.strip().splitlines())
                        if norm(new) in self.by_name}
        self.user = {}
        if synonyms_file is not None:
            table = pd.read_csv(synonyms_file, sep=None, engine="python", dtype=str).dropna()
            for yours, perch in table.iloc[:, :2].itertuples(index=False):
                if norm(perch) in self.by_name:
                    self.user[norm(yours)] = self.by_name[norm(perch)]
                elif messages is not None:
                    messages.append(f"⚠ Synonyms file: '{perch}' is not a Perch class — row ignored")
            if messages is not None:
                messages.append(f"Synonyms file: {len(self.user)} name(s) from {Path(synonyms_file).name}")
        self.to_perch = lru_cache(maxsize=None)(self._to_perch)

    def _to_perch(self, label):
        """Perch's name for any label, or None."""
        words = label_words(label)
        for candidate in (" ".join(words), " ".join(words[:2])):
            key = norm(candidate)
            for table in (self.user, self.by_name, self.builtin, self.by_code):
                if key in table:
                    return table[key]
        return None
