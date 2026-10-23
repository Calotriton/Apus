from apus.names import Names, label_words, norm, read_species_list

CLASSES = ["Turdus merula", "Parus major", "Astur gentilis", "Erithacus rubecula"]
CODES = ["eurbla", "gretit1", "no_ebird_code", "eurrob1"]


def test_norm_and_label_words():
    assert norm(" Turdus_merula  ") == "turdus merula"
    assert label_words("Parus_major 1 0 0") == ["Parus", "major"]


def test_to_perch(tmp_path):
    synonyms = tmp_path / "synonyms.csv"
    synonyms.write_text("your_name;perch_name\nBlackbird;Turdus merula\nNot A Species;Nonexistent species\n")
    messages = []
    names = Names(CLASSES, CODES, synonyms, messages)
    assert names.to_perch("turdus_merula") == "Turdus merula"                      # Perch's own name
    assert names.to_perch("Turdus merula_Eurasian Blackbird") == "Turdus merula"   # BirdNET list line
    assert names.to_perch("Blackbird") == "Turdus merula"                          # user's synonyms
    assert names.to_perch("Accipiter gentilis") == "Astur gentilis"                # built-in table
    assert names.to_perch("eurrob1") == "Erithacus rubecula"                       # eBird code
    assert names.to_perch("Parus major 1 0 0") == "Parus major"                    # trailing numbers
    assert names.to_perch("Nonexistent bird") is None
    assert any("not a Perch class" in m for m in messages)


def test_read_species_list(tmp_path):
    path = tmp_path / "list.txt"
    path.write_text("Turdus merula_Eurasian Blackbird\n\nParus major;Great Tit\n")
    assert read_species_list(path) == ["Turdus merula_Eurasian Blackbird", "Parus major"]
