"""
Explainable Smart Matching Algorithm for Student Lost & Found.

Why this algorithm is interview-ready:
1. Deterministic & Explainable: No opaque black-box AI. Every point scored is justified by transparent rules.
2. Weighted Evaluation (100 Points Total):
   - Category Match       : 30 points (Critical filter: an ID card will never match a water bottle)
   - Item Name Match      : 25 points (Direct lexical or substring comparison)
   - Location Similarity  : 20 points (Exact room/building match or campus zone overlap)
   - Date Proximity       : 15 points (Time delta between lost and found dates)
   - Description Overlap  : 10 points (Keyword overlap like color, brand, or markings)
3. Minimum Threshold: Scores >= 50% are recorded as "Possible Match".
"""

import re
from datetime import datetime
from typing import Tuple, Dict, Any, List

def clean_text(text: str) -> str:
    """Normalize text by converting to lowercase and stripping extra spaces/punctuation."""
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())

def extract_keywords(text: str) -> set:
    """Extract significant words, ignoring common stop words."""
    stop_words = {
        "a", "an", "the", "in", "on", "at", "near", "by", "of", "and", "or", "is",
        "it", "was", "for", "to", "my", "i", "found", "lost", "some", "with", "this"
    }
    words = clean_text(text).split()
    return {w for w in words if len(w) > 2 and w not in stop_words}

def calculate_match_score(lost_item: Any, found_item: Any) -> Tuple[int, Dict[str, Any]]:
    """
    Compare a lost item report against a found item report.
    Returns:
        total_score (int): 0 to 100
        breakdown (dict): Points and human-readable explanation for each factor.
    """
    explanations: List[str] = []

    # 1. CATEGORY MATCH (30 points)
    category_points = 0
    lost_cat = (lost_item.category or "").strip().lower()
    found_cat = (found_item.category or "").strip().lower()

    if lost_cat and found_cat and lost_cat == found_cat:
        category_points = 30
        explanations.append(f"Category matched exactly ({lost_item.category}): +30 pts")
    else:
        explanations.append(f"Categories differ ('{lost_item.category}' vs '{found_item.category}'): 0 pts")

    # 2. ITEM NAME MATCH (25 points)
    name_points = 0
    lost_name = clean_text(lost_item.item_name or "")
    found_name = clean_text(found_item.item_name or "")

    if lost_name == found_name and lost_name:
        name_points = 25
        explanations.append(f"Item name exact match ('{lost_item.item_name}'): +25 pts")
    elif lost_name in found_name or found_name in lost_name:
        name_points = 20
        explanations.append(f"Item name partial/contained match: +20 pts")
    else:
        # Token overlap ratio
        lost_words = extract_keywords(lost_item.item_name or "")
        found_words = extract_keywords(found_item.item_name or "")
        overlap = lost_words.intersection(found_words)
        if overlap:
            overlap_ratio = len(overlap) / max(len(lost_words), len(found_words), 1)
            name_points = min(25, int(round(overlap_ratio * 25)))
            explanations.append(f"Item name shared terms ({', '.join(overlap)}): +{name_points} pts")
        else:
            explanations.append("Item name has no common keywords: 0 pts")

    # 3. LOCATION SIMILARITY (20 points)
    location_points = 0
    lost_loc = clean_text(lost_item.location or "")
    found_loc = clean_text(found_item.location or "")

    if lost_loc == found_loc and lost_loc:
        location_points = 20
        explanations.append(f"Location exact match ('{lost_item.location}'): +20 pts")
    elif lost_loc in found_loc or found_loc in lost_loc:
        location_points = 15
        explanations.append(f"Location proximity/contained match ('{lost_item.location}' & '{found_item.location}'): +15 pts")
    else:
        # Campus zone detection (e.g., Canteen, Library, Auditorium, Lab, Hostel, Ground)
        lost_loc_words = extract_keywords(lost_item.location or "")
        found_loc_words = extract_keywords(found_item.location or "")
        loc_overlap = lost_loc_words.intersection(found_loc_words)
        if loc_overlap:
            location_points = 10
            explanations.append(f"Same campus zone detected ({', '.join(loc_overlap)}): +10 pts")
        else:
            explanations.append("Locations do not align: 0 pts")

    # 4. DATE SIMILARITY (15 points)
    date_points = 0
    try:
        d1 = datetime.strptime(str(lost_item.date).split("T")[0], "%Y-%m-%d")
        d2 = datetime.strptime(str(found_item.date).split("T")[0], "%Y-%m-%d")
        diff_days = abs((d2 - d1).days)

        if diff_days == 0:
            date_points = 15
            explanations.append("Same day occurrence: +15 pts")
        elif diff_days <= 2:
            date_points = 12
            explanations.append(f"Within 2 days ({diff_days} day gap): +12 pts")
        elif diff_days <= 5:
            date_points = 8
            explanations.append(f"Within 5 days ({diff_days} day gap): +8 pts")
        elif diff_days <= 10:
            date_points = 5
            explanations.append(f"Within 10 days ({diff_days} day gap): +5 pts")
        else:
            explanations.append(f"Dates are {diff_days} days apart: 0 pts")
    except Exception:
        date_points = 0
        explanations.append("Date format unparseable: 0 pts")

    # 5. DESCRIPTION MATCH (10 points)
    desc_points = 0
    lost_desc_words = extract_keywords(lost_item.description or "")
    found_desc_words = extract_keywords(found_item.description or "")
    desc_overlap = lost_desc_words.intersection(found_desc_words)

    if len(desc_overlap) >= 3:
        desc_points = 10
        explanations.append(f"High description keyword overlap ({', '.join(list(desc_overlap)[:3])}...): +10 pts")
    elif len(desc_overlap) >= 1:
        desc_points = 5
        explanations.append(f"Moderate description keyword overlap ({', '.join(desc_overlap)}): +5 pts")
    else:
        explanations.append("No matching keywords in description: 0 pts")

    total_score = min(100, category_points + name_points + location_points + date_points + desc_points)

    breakdown = {
        "category_points": category_points,
        "name_points": name_points,
        "location_points": location_points,
        "date_points": date_points,
        "description_points": desc_points,
        "total_score": total_score,
        "explanations": explanations
    }

    return total_score, breakdown
