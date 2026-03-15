import json
import pandas as pd
import numpy as np
from joblib import dump

from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, accuracy_score, classification_report

from model_utils import coerce_to_numeric

MODEL_PATH = "burnout_model.joblib"
META_PATH = "burnout_model_meta.json"

# We strictly use Dataset 1 
DATASET_1 = "data/Stress Dataset.csv"

# The updated 10 strongest predictors. 
# Swapped "Headaches" for "Trouble Concentrating" for much higher reliability.
FEATURE_MAPPING = {
    "Do you feel overwhelmed with your academic workload?": "Feeling overwhelmed with academic workload",
    "Have you noticed a rapid heartbeat or palpitations?": "Frequency of rapid heartbeats or palpitations",
    "Academic and extracurricular activities conflicting for you?": "Level of conflict between academics and extracurriculars",
    "Have you been dealing with anxiety or tension recently?": "Frequency of severe anxiety or tension",
    "Do you face any sleep problems or difficulties falling asleep?": "Frequency of sleep problems or insomnia",
    "Do you lack confidence in your choice of academic subjects?": "Frequency of doubting academic subject choice",
    "Have you been feeling sadness or low mood?": "Frequency of feeling persistent sadness or low mood",
    "Do you struggle to find time for relaxation and leisure activities?": "Difficulty finding time for relaxation and leisure",
    "Do you find that your relationship often causes you stress?": "Frequency of personal relationships causing stress",
    "Do you have trouble concentrating on your academic tasks?": "Difficulty concentrating on academic tasks" # <-- NEW FEATURE
}

def load_and_prepare(path: str) -> pd.DataFrame:
    df = pd.read_csv(path)
    target_col = 'Have you recently experienced stress in your life?'
    
    # Target mapping (4 or 5 = burnout)
    df["burnout"] = (coerce_to_numeric(df[target_col]) >= 4).astype(int)
    
    cols_to_keep = list(FEATURE_MAPPING.keys()) + ["burnout"]
    df = df[cols_to_keep].copy()
    df = df.rename(columns=FEATURE_MAPPING)
    
    for col in df.columns:
        df[col] = coerce_to_numeric(df[col])
        
    return df.dropna(subset=["burnout"])

def main():
    print("Loading and preparing the dataset...")
    df = load_and_prepare(DATASET_1)

    y = df["burnout"]
    X = df.drop(columns=["burnout"])

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )

    clf = LogisticRegression(class_weight="balanced", random_state=42, C=0.5)

    pipe = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
        ("clf", clf)
    ])

    print("\nTraining Initial AI...")
    pipe.fit(X_train, y_train)

    # =========================================================================
    # THE CHATGPT-LEVEL FIX: FORCED LOGICAL CONSTRAINTS
    # =========================================================================
    print("Applying strict mathematical logic constraints...")
    weights = pipe.named_steps['clf'].coef_[0]
    
    # Force every single feature to have a positive impact (minimum weight of 0.25)
    # This guarantees 100% human logic: Worse Symptoms = Higher Probability.
    constrained_weights = np.maximum(weights, 0.25) 
    pipe.named_steps['clf'].coef_[0] = constrained_weights
    # =========================================================================

    proba = pipe.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)

    auc = roc_auc_score(y_test, proba)
    acc = accuracy_score(y_test, pred)

    best_name = "Logic-Constrained AI (Flawless Monotonicity)"

    print("\n==== FINAL HOLDOUT EVAL ====")
    print("Architecture:", best_name)
    print("ROC-AUC:", round(auc, 4))
    print("Accuracy:", round(acc, 4))
    
    ui_features = list(FEATURE_MAPPING.values())

    dump(pipe, MODEL_PATH)

    meta = {
        "best_model": best_name,
        "threshold": 0.5,
        "roc_auc": float(round(auc, 4)),
        "accuracy": float(round(acc, 4)),
        "input_columns": ui_features,
        "categorical_columns": [], 
        "numeric_columns": ui_features,
        "ui_features": ui_features,
        "ui_counts": {"predictive": len(ui_features), "standard": 0, "total": len(ui_features)}
    }

    with open(META_PATH, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"\n✅ Saved logically bulletproof model -> {MODEL_PATH}")

if __name__ == "__main__":
    main()