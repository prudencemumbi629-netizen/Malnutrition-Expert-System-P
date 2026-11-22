def category(key, label, choices, required=False):
    return {
        "key": key, "label": label, "type": "category", "required": required,
        "options": [{"value": value, "label": text} for value, text in choices],
    }


def integer(key, label, minimum, maximum, required=False):
    return {
        "key": key, "label": label, "type": "integer", "required": required,
        "min": minimum, "max": maximum,
    }


COUNTIES = (
    "Mombasa", "Kwale", "Kilifi", "Tana River", "Lamu", "Taita Taveta", "Garissa",
    "Wajir", "Mandera", "Marsabit", "Isiolo", "Meru", "Tharaka-Nithi", "Embu",
    "Kitui", "Machakos", "Makueni", "Nyandarua", "Nyeri", "Kirinyaga", "Murang'a",
    "Kiambu", "Turkana", "West Pokot", "Samburu", "Trans Nzoia", "Uasin Gishu",
    "Elgeyo-Marakwet", "Nandi", "Baringo", "Laikipia", "Nakuru", "Narok", "Kajiado",
    "Kericho", "Bomet", "Kakamega", "Vihiga", "Bungoma", "Busia", "Siaya", "Kisumu",
    "Homa Bay", "Migori", "Kisii", "Nyamira", "Nairobi",
)
WATER = (
    (11, "Piped into dwelling"), (12, "Piped to yard or plot"),
    (13, "Piped to neighbour"), (14, "Public tap or standpipe"),
    (21, "Tube well or borehole"), (31, "Protected well"), (32, "Unprotected well"),
    (41, "Protected spring"), (42, "Unprotected spring"), (43, "Surface water"),
    (51, "Rainwater"), (61, "Tanker truck"), (62, "Cart with small tank"),
    (71, "Bottled water"), (96, "Other"), (97, "Not a usual resident"),
)
SANITATION = (
    (11, "Flush to sewer"), (12, "Flush to septic tank"), (13, "Flush to pit latrine"),
    (14, "Flush to another location"), (15, "Flush destination unknown"),
    (21, "Ventilated improved pit latrine"), (22, "Pit latrine with slab"),
    (23, "Pit latrine without slab"), (31, "No facility"), (41, "Composting toilet"),
    (42, "Bucket toilet"), (43, "Hanging toilet"), (96, "Other"),
    (97, "Not a usual resident"),
)
YES_NO = ((0, "No"), (1, "Yes"))
ILLNESS = (*YES_NO, (8, "Unknown"))
ILLNESS_CODES = {label: value for value, label in ILLNESS}

FEATURES = [
    integer("b19", "Child age in months", 0, 59, required=True),
    category("b4", "Child sex", ((1, "Male"), (2, "Female")), required=True),
    integer("bord", "Birth order", 1, 30),
    category("v404", "Mother currently breastfeeding", YES_NO),
    category("v106", "Mother’s highest education",
             enumerate(("None", "Primary", "Secondary", "Higher"))),
    category("v190", "Household wealth quintile",
             enumerate(("Poorest", "Poorer", "Middle", "Richer", "Richest"), start=1)),
    category("v113", "Drinking water source", WATER),
    category("v116", "Toilet facility", SANITATION),
    category("h11", "Recent diarrhoea", ILLNESS),
    category("h22", "Fever in the past two weeks", ILLNESS),
    category("h31", "Cough in the past two weeks", ILLNESS),
    category("v024", "County", enumerate(COUNTIES, start=1)),
    category("v025", "Residence type", ((1, "Urban"), (2, "Rural"))),
    integer("v137", "Children aged five or younger in household", 0, 30),
]
FEATURE_KEYS = {feature["key"] for feature in FEATURES}
CLASSES = ("Normal", "MAM", "SAM")


def screening_row(values):
    if not isinstance(values, dict) or values.keys() - FEATURE_KEYS:
        raise ValueError("Screening inputs include an unknown field.")
    row = []
    for feature in FEATURES:
        key = feature["key"]
        if key not in values:
            if feature["required"]:
                raise ValueError(f"Provide {feature['label'].lower()}.")
            row.append(float("nan"))
            continue
        value = values[key]
        if type(value) is not int:
            raise ValueError(f"Use a whole number for {feature['label'].lower()}.")
        if feature["type"] == "category":
            valid = any(item["value"] == value for item in feature["options"])
        else:
            valid = feature["min"] <= value <= feature["max"]
        if not valid:
            raise ValueError(f"Select a valid value for {feature['label'].lower()}.")
        row.append(value)
    return row
