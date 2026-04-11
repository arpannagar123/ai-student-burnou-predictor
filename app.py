from flask import Flask, render_template, request, jsonify, send_file
import pandas as pd
import json
import io
from joblib import load

from model_utils import coerce_to_numeric

# ReportLab PDF imports
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

MODEL_PATH = "burnout_model.joblib"
META_PATH = "burnout_model_meta.json"

app = Flask(__name__)

model = load(MODEL_PATH)
with open(META_PATH, "r", encoding="utf-8") as f:
    meta = json.load(f)

FEATURES = meta["input_columns"]
UI_FEATURES = meta.get("ui_features", FEATURES) 
NUM_COLS = set(meta.get("numeric_columns", FEATURES))
THRESHOLD = float(meta.get("threshold", 0.5))

@app.get("/")
def home():
    fields = []
    for col in UI_FEATURES:
        fields.append({
            "name": col,
            "type": "number" # All 10 questions are now Likert scale numbers
        })
    ui_counts = meta.get("ui_counts", {"predictive": len(fields), "standard": 0, "total": len(fields)})
    return render_template("index.html", fields=fields, ui_counts=ui_counts)

def compute_result_from_payload(data: dict):
    profile = data.get("__profile", {})

    row = {col: data.get(col, None) for col in FEATURES}
    X = pd.DataFrame([row], columns=FEATURES)

    for col in NUM_COLS:
        X[col] = coerce_to_numeric(X[col])

    prob = float(model.predict_proba(X)[0][1])
    pred = int(prob >= THRESHOLD)

    if prob < 0.35:
        risk = "Low"
    elif prob < 0.70:
        risk = "Moderate"
    else:
        risk = "High"

    score = int(round(prob * 100))
    if score < 35:
        score_band = "Safe"
    elif score < 70:
        score_band = "At Risk"
    else:
        score_band = "Critical"

    answered = sum(1 for f in UI_FEATURES if str(data.get(f, "")).strip() != "")
    missing = len(UI_FEATURES) - answered
    warning = None
    
    # Adjusted warning logic for the precise 10-question format
    if answered < 5:
        warning = "Answer at least 5 questions for a reliable assessment."
    elif missing >= 5:
        warning = "Many fields are empty. Result may be less reliable."

    # Explainability: impact by blanking
    impacts = []
    base = prob
    for f in UI_FEATURES:
        X2 = X.copy()
        if f in X2.columns:
            X2.loc[0, f] = None
        for col in NUM_COLS:
            X2[col] = coerce_to_numeric(X2[col])
        p2 = float(model.predict_proba(X2)[0][1])
        delta = base - p2
        impacts.append({"feature": f, "delta": round(delta, 4)})

    impacts.sort(key=lambda x: abs(x["delta"]), reverse=True)
    top_factors = impacts[:5]

    # Dynamic Suggestion Mapping
    FEATURE_TIPS = {
        "Feeling overwhelmed with academic workload": "Prioritize: Use Pomodoro (50/10) for your next study session.",
        "Frequency of rapid heartbeats or palpitations": "Physiological: Practice Box Breathing (4-4-4) 3x daily.",
        "Level of conflict between academics and extracurriculars": "Boundary: Review and prune weekend commitments this week.",
        "Frequency of severe anxiety or tension": "Mindfulness: 10-min grounding meditation before bed.",
        "Frequency of sleep problems or insomnia": "Hygiene: No blue light/screens 1 hour before sleep.",
        "Frequency of doubting academic subject choice": "Counsel: Schedule a meeting with your academic advisor.",
        "Frequency of feeling persistent sadness or low mood": "Support: Reach out to a friend or the campus wellness group.",
        "Difficulty finding time for relaxation and leisure": "Leisure: Block 1 hour of 'Unscheduled Time' in your digital calendar.",
        "Frequency of personal relationships causing stress": "Social: Express your stress state to those close to you.",
        "Difficulty concentrating on academic tasks": "Environment: Study in a zero-distraction zone (Silent Library)."
    }

    # Build dynamic action plan based on top factors
    dynamic_actions = []
    for f in top_factors:
        if f["feature"] in FEATURE_TIPS and f["delta"] > 0: # Only if it increases risk
            dynamic_actions.append(FEATURE_TIPS[f["feature"]])
    
    # Generic advice as fallback/padding to ensure at least 5 items
    generic_advice = {
        "Low": ["Maintain routine", "Track mood weekly", "Stay hydrated"],
        "Moderate": ["Plan weekly tasks", "Reduce caffeine", "Talk to mentor"],
        "High": ["Immediate rest day", "Seek counselor support", "Reduce workload"]
    }
    
    final_plan = (dynamic_actions + generic_advice[risk])[:5]
    # Ensure at least 5 items if dynamic list is small
    while len(final_plan) < 5:
        final_plan.append("Protocol: Maintain healthy habits and regular check-ins.")

    result = {
        "prediction": pred,
        "probability": round(prob, 4),
        "risk_level": risk,
        "tips": final_plan, # Using the dynamic plan for tips too
        "action_plan": final_plan,
        "top_factors": top_factors,
        "assessment": {
            "score": score,
            "band": score_band,
            "answered": answered,
            "total": len(UI_FEATURES),
            "warning": warning
        },
        "model_info": {
            "best_model": meta.get("best_model"),
            "roc_auc": meta.get("roc_auc"),
            "accuracy": meta.get("accuracy")
        },
        "profile": profile
    }
    return result

@app.post("/api/predict")
def predict():
    data = request.get_json(silent=True) or {}
    return jsonify(compute_result_from_payload(data))

@app.post("/api/report_pdf")
def report_pdf():
    data = request.get_json(silent=True) or {}
    result = compute_result_from_payload(data)

    buf = io.BytesIO()
    
    doc = SimpleDocTemplate(buf, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=40, bottomMargin=40)
    styles = getSampleStyleSheet()
    
    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=20, spaceAfter=10, textColor=colors.HexColor("#2563eb"))
    h2_style = ParagraphStyle('H2Style', parent=styles['Heading2'], fontSize=14, spaceBefore=18, spaceAfter=8, textColor=colors.HexColor("#0f172a"))
    normal_style = ParagraphStyle('NormalStyle', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor("#334155"), leading=14)
    
    story = []

    story.append(Paragraph("<b>BurnoutGuard</b> - Insights Report", title_style))
    story.append(Paragraph("<font size=10 color='#64748b'>Personalized burnout screening and action plan for student wellness.</font>", normal_style))
    story.append(Spacer(1, 10))
    story.append(Table([['']], colWidths=[470], style=[('LINEBELOW', (0,0), (-1,-1), 2, colors.HexColor('#c7d2fe'))]))
    story.append(Spacer(1, 18))

    prof = result.get("profile", {}) or {}
    story.append(Paragraph("Student Profile", h2_style))
    prof_data = [
        ["Name:", prof.get('studentName','-'), "College:", prof.get('college','-')],
        ["Course:", prof.get('course','-'), "Enrollment:", prof.get('enrollment','-')]
    ]
    ptable = Table(prof_data, colWidths=[60, 180, 60, 150], hAlign='LEFT')
    ptable.setStyle(TableStyle([
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica'),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTNAME', (2,0), (2,-1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor("#334155")),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f8fafc')),
        ('BACKGROUND', (0,1), (-1,1), colors.whitesmoke),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
    ]))
    story.append(ptable)
    story.append(Spacer(1, 16))

    story.append(Paragraph("Assessment Summary", h2_style))
    
    risk = result['risk_level']
    if risk == "Low":
        risk_color = "#16a34a"
    elif risk == "Moderate":
        risk_color = "#d97706"
    else:
        risk_color = "#dc2626"
    
    summary_data = [
        ["Risk Level:", Paragraph(f"<font color='{risk_color}'><b>{risk}</b></font>", normal_style)],
        ["Burnout Probability:", f"{int(round(result['probability']*100))}%"],
        ["Assessment Score:", f"{result['assessment']['score']}/100 ({result['assessment']['band']})"]
    ]
    stable = Table(summary_data, colWidths=[130, 320], hAlign='LEFT')
    stable.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#eef2ff')),
        ('BOX', (0,0), (-1,-1), 0.75, colors.HexColor('#c7d2fe')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0,0), (-1,-1), colors.HexColor("#334155")),
        ('BOTTOMPADDING', (0,0), (-1,-1), 10),
        ('TOPPADDING', (0,0), (-1,-1), 10),
    ]))
    story.append(stable)
    
    warn = result["assessment"].get("warning")
    if warn:
        story.append(Spacer(1, 5))
        story.append(Paragraph(f"<font color='#92400e'><b>Reliability Note:</b> {warn}</font>", normal_style))
        
    story.append(Spacer(1, 10))

    story.append(Paragraph("Top Contributing Factors (Approx.)", h2_style))
    for f in result.get("top_factors", []):
        sign = "increases risk" if f["delta"] >= 0 else "lowers risk"
        story.append(Paragraph(f"• <b>{f['feature']}</b> <i>({sign})</i>", normal_style))
        story.append(Spacer(1, 4))
    
    story.append(Spacer(1, 10))

    story.append(Paragraph("Personalized Action Plan", h2_style))
    for t in result.get("action_plan", []):
        story.append(Paragraph(f"• {t}", normal_style))
        story.append(Spacer(1, 4))
        
    story.append(Spacer(1, 15))

    story.append(Paragraph("Answers Provided", h2_style))
    
    likert_map = {
        "1": "1 - Not at all",
        "2": "2 - Slight",
        "3": "3 - Moderate",
        "4": "4 - High",
        "5": "5 - Very High"
    }
    
    answers_data = []
    for q in UI_FEATURES:
        val = data.get(q, "")
        val_str = str(val).strip()
        
        if val_str in likert_map:
            val_str = likert_map[val_str]
            
        val_str = "-" if val_str == "" else val_str
        answers_data.append([Paragraph(q, normal_style), Paragraph(val_str, normal_style)])
        
    atable = Table(answers_data, colWidths=[330, 120], hAlign='LEFT')
    atable.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LINEBELOW', (0,0), (-1,-1), 0.5, colors.HexColor("#e2e8f0")),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('ROWBACKGROUNDS', (0,0), (-1,-1), [colors.whitesmoke, colors.white]),
    ]))
    story.append(atable)
    
    story.append(Spacer(1, 30))
    disclaimer = Paragraph("<font size=8><i>Disclaimer: This is an educational AI screening report, not a medical diagnosis. If you are experiencing distress, please consult a healthcare or counseling professional.</i></font>", normal_style)
    story.append(disclaimer)

    doc.build(story)
    
    buf.seek(0)
    filename = "BurnoutGuard_Report.pdf"
    return send_file(buf, mimetype="application/pdf", as_attachment=True, download_name=filename)

if __name__ == "__main__":
    app.run(debug=True)