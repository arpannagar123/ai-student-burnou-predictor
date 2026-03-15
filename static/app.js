function readFieldsFromHTML() {
  const tag = document.getElementById("fields-json");
  const raw = (tag?.textContent || "").trim();
  if (!raw) throw new Error("No fields received from backend.");
  return JSON.parse(raw);
}

function makeLikertSelect() {
  const s = document.createElement("select");
  s.innerHTML = `
    <option value="">Select an option...</option>
    <option value="1">1 – Not at all</option>
    <option value="2">2 – Slight</option>
    <option value="3">3 – Moderate</option>
    <option value="4">4 – High</option>
    <option value="5">5 – Very High</option>
  `;
  return s;
}

let FIELDS = [];
let currentStep = 1; 
let lastPayload = null; 

function splitIntoSteps(fields) {
  // Dynamically splits 10 questions into 3 chunks safely
  const a = fields.slice(0, 4);
  const b = fields.slice(4, 7);
  const c = fields.slice(7, 10);
  return {1: a, 2: b, 3: c};
}

function setStepper(step) {
  [1, 2, 3].forEach(i => {
    const dot = document.getElementById(`stepDot${i}`);
    if(dot) {
        dot.classList.toggle("active", i === step);
        dot.classList.toggle("done", i < step);
    }
  });
  
  const stepLabel = document.getElementById("stepLabel");
  if(stepLabel) stepLabel.textContent = `Step ${step} of 3`;

  document.getElementById("backBtn").disabled = (step === 1);
  
  const nextBtn = document.getElementById("nextBtn");
  const predictBtn = document.getElementById("predictBtn");
  
  if (step === 3) {
    nextBtn.classList.add("hidden");
    predictBtn.classList.remove("hidden");
  } else {
    nextBtn.classList.remove("hidden");
    predictBtn.classList.add("hidden");
  }
}

function buildForm(stepFields) {
  const root = document.getElementById("formFields");
  if(!root) return;
  root.innerHTML = "";

  stepFields.forEach(f => {
    const box = document.createElement("div");
    box.className = "field";

    const label = document.createElement("label");
    label.textContent = f.name;

    const input = makeLikertSelect();
    input.dataset.col = f.name;
    
    const saved = window.__savedAnswers?.[f.name];
    if (saved !== undefined) input.value = saved;

    const saveInput = () => {
      window.__savedAnswers = window.__savedAnswers || {};
      window.__savedAnswers[f.name] = input.value;
    };
    input.addEventListener("change", saveInput);

    box.appendChild(label);
    box.appendChild(input);
    root.appendChild(box);
  });
}

function getPayload(allFields) {
  const payload = {
    __profile: {
      studentName: document.getElementById("studentName")?.value || "",
      college: document.getElementById("college")?.value || "",
      course: document.getElementById("course")?.value || "",
      semester: document.getElementById("semester")?.value || ""
    }
  };
  const saved = window.__savedAnswers || {};
  allFields.forEach(f => {
    payload[f.name] = saved[f.name] ?? "";
  });
  return payload;
}

function riskClass(level){
  if(level === "High") return "high";
  if(level === "Moderate") return "mid";
  return "low";
}

function factorBars(topFactors){
  if (!topFactors || topFactors.length === 0) return "";
  const maxAbs = Math.max(...topFactors.map(x => Math.abs(x.delta)), 0.0001);
  return topFactors.map(f => {
    const w = Math.round((Math.abs(f.delta) / maxAbs) * 100);
    const dir = f.delta >= 0 ? "Increases Risk" : "Lowers Risk";
    return `
      <div class="factor">
        <div class="factorHead">
          <span>${f.feature}</span>
          <b>${dir}</b>
        </div>
        <div class="factorBar"><div style="width:${w}%"></div></div>
      </div>
    `;
  }).join("");
}

function renderResult(data) {
  const r = document.getElementById("result");
  r.classList.remove("empty");

  const pct = Math.round(data.probability * 100);
  const cls = riskClass(data.risk_level);

  const assess = data.assessment || {};
  const warn = assess.warning ? `<div class="warn"><i data-lucide="alert-triangle" style="width:16px;height:16px;"></i> ${assess.warning}</div>` : "";

  r.innerHTML = `
    <div class="reportTop animate-slide-up">
      <div class="pill ${cls}">${data.risk_level} Risk Level</div>
      <div class="score">${pct}%</div>
      <div class="muted" style="color: var(--text-muted); font-weight: 500;">Calculated Burnout Probability</div>
      ${warn}
    </div>

    <div class="assessBox animate-slide-up delay-1">
      <div class="assessLeft">
        <div class="assessTitle">Clinical Score</div>
        <div class="assessScore">${assess.score ?? "—"}/100</div>
        <div class="assessBand">${assess.band ?? ""}</div>
      </div>
      <div class="assessRight">
        <div class="muted" style="color: var(--text-muted); font-size: 13px; margin-bottom: 4px; font-weight: 600;">Answered</div>
        <b style="font-size: 22px; color: var(--text-main);">${assess.answered ?? 0}/${assess.total ?? 10}</b>
      </div>
    </div>

    <div class="split animate-slide-up delay-2">
      <div class="panel">
        <h3>Personalized Protocol</h3>
        <ul>${(data.action_plan || []).map(x => `<li>${x}</li>`).join("")}</ul>
      </div>
      <div class="panel">
        <h3>General Wellness Tips</h3>
        <ul>${(data.tips || []).map(x => `<li>${x}</li>`).join("")}</ul>
      </div>
    </div>

    <div class="panel animate-slide-up delay-2" style="margin-top:20px;">
        <h3>Primary Risk Drivers</h3>
        <p style="color: var(--text-muted); font-size: 14px; margin-top:-8px; margin-bottom: 16px;">Metrics currently elevating your probability score:</p>
        <div class="factors">${factorBars(data.top_factors || [])}</div>
    </div>
  `;
  
  if(window.lucide) window.lucide.createIcons();
}

function renderError(msg) {
  const r = document.getElementById("result");
  r.classList.remove("empty");
  r.innerHTML = `<div class="warn"><i data-lucide="alert-circle" style="width:18px;height:18px;"></i> ${msg}</div>`;
  if(window.lucide) window.lucide.createIcons();
}

async function simulateAnalysis() {
  const overlay = document.getElementById("analysisOverlay");
  const bar = document.getElementById("analysisBar");
  const log = document.getElementById("logStream");
  
  overlay.classList.remove("hidden");
  
  const steps = [
    { p: 20, msg: "> Aggregating clinical metrics..." },
    { p: 50, msg: "> Applying monotonic constraints..." },
    { p: 80, msg: "> Computing probability matrix..." },
    { p: 100, msg: "> Generating secure protocol..." }
  ];

  for (let s of steps) {
    await new Promise(r => setTimeout(r, 600));
    bar.style.width = s.p + "%";
    log.innerHTML += `<br>${s.msg}`;
  }
  
  await new Promise(r => setTimeout(r, 400)); 
  overlay.classList.add("hidden");
  
  setTimeout(() => {
    bar.style.width = "0%";
    log.innerHTML = "> SYSTEM_READY";
  }, 400);
}

async function predict(allFields) {
  try {
    const payload = getPayload(allFields);
    lastPayload = payload;

    await simulateAnalysis();

    const res = await fetch("/api/predict", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) return renderError(data.error || "Prediction failed.");

    renderResult(data);
    document.getElementById("pdfBtn").disabled = false;
    
    if(window.innerWidth < 800) {
      document.getElementById("result").scrollIntoView({behavior: "smooth"});
    }
  } catch (e) {
    document.getElementById("analysisOverlay").classList.add("hidden");
    renderError(e.message || "Unexpected error.");
  }
}

async function downloadPDF() {
  if (!lastPayload) return;
  const btn = document.getElementById("pdfBtn");
  btn.innerHTML = `<i data-lucide="loader-2" class="spin" style="width:14px; height:14px; vertical-align:middle; margin-right:4px;"></i> Generating...`;
  if(window.lucide) window.lucide.createIcons();
  
  const res = await fetch("/api/report_pdf", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(lastPayload)
  });

  if (!res.ok) {
    renderError("Could not generate PDF report.");
    btn.innerHTML = `<i data-lucide="download" style="width:14px; height:14px; vertical-align:middle; margin-right:4px;"></i> Export PDF`;
    if(window.lucide) window.lucide.createIcons();
    return;
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "BurnoutGuard_Clinical_Report.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  btn.innerHTML = `<i data-lucide="download" style="width:14px; height:14px; vertical-align:middle; margin-right:4px;"></i> Export PDF`;
  if(window.lucide) window.lucide.createIcons();
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    // 1. Initialize icons
    if(window.lucide) window.lucide.createIcons();

    // 2. Bind the "Start Assessment" buttons
    const startBtns = document.querySelectorAll(".start-btn");
    startBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        document.getElementById("landingEcosystem").classList.add("hidden");
        document.getElementById("mainApp").classList.remove("hidden");
        window.scrollTo(0, 0);
      });
    });

    // 3. NEW: Bind the Navigation Links (Platform & Clinical Approach)
    const navLinks = document.querySelectorAll(".nav-link");
    navLinks.forEach(link => {
      link.addEventListener("click", () => {
        // If the user clicks a nav link while the assessment is open, switch back to the landing page
        document.getElementById("landingEcosystem").classList.remove("hidden");
        document.getElementById("mainApp").classList.add("hidden");
        
        // The browser will automatically continue to scroll to the #href target!
      });
    });

    // 4. Load ML fields and build form
    FIELDS = readFieldsFromHTML();
    const stepMap = splitIntoSteps(FIELDS);
    window.__savedAnswers = window.__savedAnswers || {};

    function renderStep(step){
      currentStep = step;
      setStepper(step);
      buildForm(stepMap[step]);
    }

    renderStep(1);

    // 5. Bind form controls
    document.getElementById("backBtn").addEventListener("click", () => {
      if (currentStep > 1) renderStep(currentStep - 1);
    });

    document.getElementById("nextBtn").addEventListener("click", () => {
      if (currentStep < 3) renderStep(currentStep + 1);
    });

    document.getElementById("predictBtn").addEventListener("click", () => predict(FIELDS));
    document.getElementById("pdfBtn").addEventListener("click", downloadPDF);
    
  } catch (e) {
    console.error(e);
    renderError("Initialization failed: " + e.message);
  }
});