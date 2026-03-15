from joblib import load
import json

MODEL_PATH = "burnout_model.joblib"
META_PATH = "burnout_model_meta.json"

def load_model():
    return load(MODEL_PATH)

def load_meta():
    with open(META_PATH, "r", encoding="utf-8") as f:
        return json.load(f)