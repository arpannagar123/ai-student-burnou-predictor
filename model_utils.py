import re
import pandas as pd
from typing import List, Optional, Tuple

def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [re.sub(r"\s+", " ", str(c)).strip() for c in df.columns]
    return df

def normalize_text(s: str) -> str:
    s = str(s).strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s

def find_best_column(df: pd.DataFrame, keywords: List[str]) -> Optional[str]:
    cols = list(df.columns)
    norm_cols = [normalize_text(c) for c in cols]

    kw_tokens = []
    for kw in keywords:
        kw_tokens.extend(normalize_text(kw).split())

    best, best_score = None, 0
    for original, norm in zip(cols, norm_cols):
        score = sum(1 for t in kw_tokens if t in norm)
        if score > best_score:
            best_score = score
            best = original

    return best if best_score >= 2 else None

def coerce_to_numeric(series: pd.Series) -> pd.Series:
    s = series.copy()
    if s.dtype == object:
        s = s.astype(str).str.strip()
        mapping = {
            "low": 1, "mild": 2, "medium": 3, "moderate": 3,
            "high": 4, "very high": 5, "severe": 5
        }
        lower = s.str.lower()
        if lower.isin(mapping.keys()).any():
            s = lower.map(mapping).fillna(s)
    return pd.to_numeric(s, errors="coerce")

def build_burnout_label_from_stress(stress: pd.Series, threshold: int = 4) -> pd.Series:
    stress_num = coerce_to_numeric(stress)
    return (stress_num >= threshold).astype("Int64")

def detect_target_column(df: pd.DataFrame) -> Tuple[str, str]:
    candidates = [
        ["academic", "stress", "index"],
        ["stress", "index"],
        ["stress", "level"],
        ["experienced", "stress"],
        ["recently", "stress"],
        ["stress"]
    ]
    for kw in candidates:
        col = find_best_column(df, kw)
        if col is not None:
            return col, f"Matched keywords: {kw}"

    for c in df.columns:
        if "stress" in normalize_text(c):
            temp = coerce_to_numeric(df[c])
            if temp.dropna().between(1, 5).mean() > 0.7:
                return c, "Fallback: numeric stress-like column 1..5"

    raise ValueError("Could not detect a target stress column automatically.")

# --------------------------
# NEW: replace timestamp
# --------------------------
def replace_timestamp(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    # try to find timestamp column
    ts_col = None
    for c in df.columns:
        n = normalize_text(c)
        if "timestamp" in n or n in ("time", "date time", "datetime", "date-time"):
            ts_col = c
            break

    if ts_col is None:
        return df

    dt = pd.to_datetime(df[ts_col], errors="coerce")
    df["ts_hour"] = dt.dt.hour
    df["ts_dayofweek"] = dt.dt.dayofweek
    df["ts_month"] = dt.dt.month
    df = df.drop(columns=[ts_col], errors="ignore")
    return df

# --------------------------
# NEW: replace academic stage
# --------------------------
def replace_academic_stage(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    stage_col = None
    for c in df.columns:
        n = normalize_text(c)
        if "academic stage" in n or "academic level" in n or "year of study" in n or n == "stage":
            stage_col = c
            break

    if stage_col is None:
        return df

    s = df[stage_col].astype(str).str.strip()
    s_low = s.str.lower()

    def map_year(x: str):
        x = x.lower()
        # common patterns
        if "first" in x or "1st" in x:
            return 1
        if "second" in x or "2nd" in x:
            return 2
        if "third" in x or "3rd" in x:
            return 3
        if "fourth" in x or "4th" in x or "final" in x:
            return 4
        # try to extract a digit
        m = re.search(r"(\d+)", x)
        if m:
            val = int(m.group(1))
            if 1 <= val <= 8:
                return val
        return None

    df["year_of_study"] = s.apply(map_year)
    # keep a cleaned category too (optional but useful)
    df["academic_stage_clean"] = s_low.replace({"nan": None, "none": None, "": None})

    df = df.drop(columns=[stage_col], errors="ignore")
    return df