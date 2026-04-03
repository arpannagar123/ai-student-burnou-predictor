function readFields() {
    const tag = document.getElementById('fields-json');
    return tag ? JSON.parse(tag.textContent) : [];
}

function formatLabel(str) {
    return str.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function makeMetricCard(fieldName) {
    const card = document.createElement('div');
    card.className = "p-4 rounded-2xl bg-black/5 dark:bg-[#161320] border border-super-border hover:border-super-purple/50 transition-all group flex flex-col gap-3 relative";
    
    card.innerHTML = `
        <label class="text-xs text-super-text/50 pl-1 group-hover:text-super-purple transition-colors">${formatLabel(fieldName)}</label>
        <select data-col="${fieldName}" class="w-full bg-transparent border-none px-1 outline-none text-sm font-medium cursor-pointer text-super-text">
            <option value="" class="bg-white dark:bg-[#161320]">Select Level...</option>
            <option value="1" class="bg-white dark:bg-[#161320]">Level 1 - Minimal</option>
            <option value="2" class="bg-white dark:bg-[#161320]">Level 2 - Slight</option>
            <option value="3" class="bg-white dark:bg-[#161320]">Level 3 - Moderate</option>
            <option value="4" class="bg-white dark:bg-[#161320]">Level 4 - Significant</option>
            <option value="5" class="bg-white dark:bg-[#161320]">Level 5 - Critical</option>
        </select>
    `;
    return card;
}

let FIELDS = [];
let lastPayload = null;
let orbState = {
    scene: null, camera: null, renderer: null, orb: null, light: null, clock: new THREE.Clock()
};
let radarChart = null;

function initOrb() {
    const container = document.getElementById('orbContainer');
    if (!container || orbState.renderer) return;

    orbState.scene = new THREE.Scene();
    orbState.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
    orbState.camera.position.z = 5;

    orbState.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    orbState.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(orbState.renderer.domElement);

    const geo = new THREE.SphereGeometry(2, 64, 64);
    const mat = new THREE.MeshStandardMaterial({
        color: 0x7c3aed,
        wireframe: true,
        transparent: true,
        opacity: 0.2
    });
    orbState.orb = new THREE.Mesh(geo, mat);
    orbState.scene.add(orbState.orb);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    orbState.scene.add(ambient);

    orbState.light = new THREE.PointLight(0x7c3aed, 2, 10);
    orbState.light.position.set(2, 2, 2);
    orbState.scene.add(orbState.light);

    function animate() {
        requestAnimationFrame(animate);
        const time = orbState.clock.getElapsedTime();
        
        if (orbState.orb) {
            orbState.orb.rotation.y += 0.005;
            orbState.orb.rotation.z += 0.002;
            const pulse = 1 + Math.sin(time * 0.5) * 0.05;
            orbState.orb.scale.set(pulse, pulse, pulse);
        }

        if (orbState.light) {
            orbState.light.position.x = Math.sin(time) * 3;
            orbState.light.position.z = Math.cos(time) * 3;
        }

        orbState.renderer.render(orbState.scene, orbState.camera);
    }
    animate();

    window.addEventListener('resize', () => {
        if (orbState.renderer) {
            orbState.camera.aspect = container.clientWidth / container.clientHeight;
            orbState.camera.updateProjectionMatrix();
            orbState.renderer.setSize(container.clientWidth, container.clientHeight);
        }
    });
}

function updateOrbIntensity(prob) {
    if (!orbState.orb) return;
    const intensity = 0.2 + (prob * 0.6);
    orbState.orb.material.opacity = intensity;
    orbState.orb.material.wireframe = prob < 0.6;
    orbState.light.intensity = 2 + (prob * 10);
}

function updateRadar(payload) {
    const ctx = document.getElementById('radarChart');
    if (!ctx) return;

    ctx.classList.remove('hidden');
    const awaiting = document.getElementById('awaitingData');
    if (awaiting) awaiting.classList.add('hidden');

    const labels = FIELDS.map(f => formatLabel(f.name).split(' ').slice(0, 2).join(' '));
    const dataValues = FIELDS.map(f => parseInt(payload[f.name]) || 0);

    if (radarChart) {
        radarChart.destroy();
    }

    const color = '#7c3aed';
    const textColor = 'rgba(255,255,255,0.5)';

    radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Stress Profile',
                data: dataValues,
                backgroundColor: 'rgba(124, 58, 237, 0.2)',
                borderColor: color,
                borderWidth: 2,
                pointBackgroundColor: color,
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: color
            }]
        },
        options: {
            scales: {
                r: {
                    min: 0,
                    max: 5,
                    beginAtZero: true,
                    ticks: { display: false, stepSize: 1 },
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    angleLines: { color: 'rgba(255,255,255,0.1)' },
                    pointLabels: {
                        color: textColor,
                        font: { size: 9, family: 'Inter' }
                    }
                }
            },
            plugins: {
                legend: { display: false }
            },
            responsive: true,
            maintainAspectRatio: true
        }
    });
}

function buildForm(fields) {
    const root = document.getElementById('formFields');
    if(!root) return;
    root.innerHTML = '';
    fields.forEach(f => root.appendChild(makeMetricCard(f.name)));
}

function getPayload(allFields) {
    const payload = {
        __profile: {
            studentName: document.getElementById('studentName')?.value || '',
            enrollment: document.getElementById('enrollment')?.value || '',
            college: document.getElementById('college')?.value || '',
            course: document.getElementById('course')?.value || '',
            semester: document.getElementById('semester')?.value || ''
        }
    };
    allFields.forEach(f => {
        const sel = document.querySelector(`select[data-col="${f.name}"]`);
        payload[f.name] = sel?.value || '';
    });
    return payload;
}

function renderResult(data) {
    const r = document.getElementById('result');
    if(!r) return;
    
    const pct = Math.round((data.probability || 0) * 100);
    const topFactors = data.top_factors || [];
    const actions = data.action_plan || ["Initiate Mindfulness Protocol"];

    r.innerHTML = `
        <div class="w-full h-full flex flex-col justify-between animate-in fade-in zoom-in duration-700">
            
            <div class="flex items-center gap-4 p-4 rounded-2xl bg-super-purple/5 border border-super-border mb-8">
                <div class="w-12 h-12 rounded-full bg-super-purple flex items-center justify-center">
                    <svg class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                </div>
                <div>
                    <p class="text-xs text-super-text/50">Current State</p>
                    <p class="text-lg font-medium">${data.risk_level || 'Calculating...'}</p>
                </div>
                <div class="ml-auto text-right">
                    <div class="text-3xl font-medium tracking-tight">${pct}%</div>
                </div>
            </div>

            <div class="space-y-4 mb-8 overflow-y-auto max-h-[300px] pr-2 custom-scrollbar">
                <h4 class="text-sm font-medium text-super-text/70">Subconscious Patterns</h4>
                ${topFactors.length > 0 ? topFactors.map(f => {
                    const isNegative = f.delta >= 0; 
                    const displayDelta = Math.abs(f.delta);
                    return `
                    <div class="space-y-2">
                        <div class="flex justify-between text-xs">
                            <span class="text-super-text/80">${f.feature}</span>
                            <span class="${isNegative ? 'text-super-purple' : 'text-emerald-500'}">${Math.round(displayDelta * 100)}%</span>
                        </div>
                        <div class="h-1.5 w-full bg-black/5 dark:bg-white/5 rounded-full overflow-hidden">
                            <div class="h-full ${isNegative ? 'bg-gradient-to-r from-super-purple to-purple-400' : 'bg-emerald-500'}" style="width: ${Math.min(100, displayDelta * 1000)}%"></div>
                        </div>
                    </div>
                    `;
                }).join('') : '<p class="text-xs text-super-text/30 italic">No significant patterns detected.</p>'}
            </div>

            <div class="mt-auto">
                <div class="p-4 rounded-2xl bg-super-purple/5 border border-super-purple/30 relative overflow-hidden">
                    <div class="absolute inset-0 bg-super-purple/5"></div>
                    <div class="relative z-10 space-y-3">
                        <p class="text-xs text-super-text/50 mb-1 font-medium italic">Protocol Insights</p>
                        ${actions.map(action => `
                            <div class="flex items-center justify-between">
                                <p class="text-sm font-medium text-super-text">${action}</p>
                                <span class="w-2 h-2 rounded-full bg-super-purple animate-pulse"></span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function simulateAnalysis() {
    const overlay = document.getElementById('analysisOverlay');
    const bar = document.getElementById('loaderProgress');
    const status = document.getElementById('loaderStatus');
    
    if(overlay) overlay.classList.remove('hidden');
    
    const steps = [
        'Connecting to Superconscious...',
        'Analyzing Subconscious Patterns...',
        'Synthesizing Reality Data...',
        'Finalizing Insights...'
    ];
    
    for(let i = 0; i < steps.length; i++) {
        if(status) status.innerText = steps[i];
        if(bar) bar.style.width = ((i+1) / steps.length * 100) + '%';
        await new Promise(r => setTimeout(r, 250));
    }
    
    if(overlay) overlay.classList.add('hidden');
}

function initScrollReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
            }
        });
    }, { threshold: 0.15 });

    document.querySelectorAll('.reveal-3d').forEach(el => {
        observer.observe(el);
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    if(!toast || !toastMsg) return;
    
    toastMsg.innerText = msg;
    toast.classList.remove('translate-y-[200%]', 'opacity-0', 'scale-90');
    
    setTimeout(() => {
        toast.classList.add('translate-y-[200%]', 'opacity-0', 'scale-90');
    }, 3000);
}

async function predict() {
    try {
        const payload = getPayload(FIELDS);
        
        // Validation: Check if at least 5 diagnostic vectors and profile info are filled
        const answered = FIELDS.filter(f => payload[f.name] !== '').length;
        const profileOk = payload.__profile.studentName && payload.__profile.enrollment;

        if (!profileOk || answered < 5) {
            showToast(`Incomplete: Please answer at least 5 of the ${FIELDS.length} assessment vectors.`);
            return;
        }

        lastPayload = payload;
        
        await simulateAnalysis();
        
        const res = await fetch('/api/predict', {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Diagnostic computation failed.');
        
        renderResult(data);
        updateOrbIntensity(data.probability || 0);
        updateRadar(payload);
        
        const pdfBtn = document.getElementById('pdfBtn');
        if(pdfBtn) pdfBtn.disabled = false;
        
        if (window.innerWidth < 1024) {
            const resEl = document.getElementById('result');
            if(resEl) resEl.scrollIntoView({ behavior: 'smooth' });
        }
    } catch (e) {
        console.error("Diagnostic Error:", e);
        const overlay = document.getElementById('analysisOverlay');
        if(overlay) overlay.classList.add('hidden');
    }
}

async function downloadPDF() {
    if (!lastPayload) return;
    const btn = document.getElementById('pdfBtn');
    const original = btn.innerText;
    btn.innerText = 'EXPORTING...';
    
    try {
        const res = await fetch('/api/report_pdf', {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify(lastPayload)
        });
        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'BurnoutGuard_Diagnostic_Report.pdf';
            a.click();
            window.URL.revokeObjectURL(url);
        } else {
            console.error('Diagnostic Report Export Failed.');
        }
    } catch(err) {
        console.error('Diagnostic Report Export Failed.', err);
    }
    btn.innerText = original;
}

function init() {
    FIELDS = readFields();
    buildForm(FIELDS);
    
    // Safety Wrap for UI Enhancements
    try { initScrollReveal(); } catch(e) { console.error('ScrollReveal Init Failed:', e); }
    
    // Switch to Workspace
    document.querySelectorAll('.start-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const landing = document.getElementById('landingEcosystem');
            const main = document.getElementById('mainApp');
            if(landing) landing.classList.add('hidden');
            if(main) {
                main.classList.remove('hidden');
                // Initialize Orb only when Workspace is visible to get correct dimensions
                initOrb();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });

    // Return to Home (Logo Click)
    const navLogo = document.getElementById('navLogo');
    if(navLogo) {
        navLogo.addEventListener('click', () => {
            const landing = document.getElementById('landingEcosystem');
            const main = document.getElementById('mainApp');
            if(landing) landing.classList.remove('hidden');
            if(main) main.classList.add('hidden');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // Navbar Links Logic (Ensure landing is visible if clicking About/Works/Whom)
    document.querySelectorAll('nav a[href^="#"]').forEach(link => {
        link.addEventListener('click', (e) => {
            const landing = document.getElementById('landingEcosystem');
            const main = document.getElementById('mainApp');
            if(landing && landing.classList.contains('hidden')) {
                landing.classList.remove('hidden');
                if(main) main.classList.add('hidden');
            }
        });
    });
    
    const predictBtn = document.getElementById('predictBtn');
    if(predictBtn) predictBtn.addEventListener('click', predict);

    const pdfBtn = document.getElementById('pdfBtn');
    if(pdfBtn) pdfBtn.addEventListener('click', downloadPDF);

    // macOS Native Window Controls
    const creditsWindow = document.getElementById('creditsWindow');
    const closeBtn = document.getElementById('closeBtn');
    const minimizeBtn = document.getElementById('minimizeBtn');
    const maximizeBtn = document.getElementById('maximizeBtn');
    const architectsCard = document.getElementById('architectsCard');
    const restoreWindow = document.getElementById('restoreWindow');

    if (closeBtn && creditsWindow && architectsCard) {
        closeBtn.addEventListener('click', () => {
            console.log('macOS Control: Vanishing Window');
            creditsWindow.style.opacity = "0";
            creditsWindow.style.filter = "blur(10px)";
            creditsWindow.style.transform = "scale(0.95)";
            
            setTimeout(() => {
                creditsWindow.style.display = 'none';
                architectsCard.style.display = 'block';
                architectsCard.style.opacity = "1";
                console.log('macOS Control: Card Revealed');
            }, 400);
        });

        restoreWindow.addEventListener('click', () => {
            console.log('macOS Control: Restoring Window');
            architectsCard.style.display = 'none';
            architectsCard.style.opacity = "0";
            
            creditsWindow.style.display = 'block';
            creditsWindow.classList.remove('minimized', 'maximized');
            
            setTimeout(() => {
                creditsWindow.style.opacity = "1";
                creditsWindow.style.filter = "blur(0px)";
                creditsWindow.style.transform = "scale(1)";
                console.log('macOS Control: Window Restored');
            }, 50);
        });
    }

    if (minimizeBtn && creditsWindow) {
        minimizeBtn.addEventListener('click', () => {
            creditsWindow.classList.toggle('minimized');
            creditsWindow.classList.remove('maximized');
        });
    }

    if (maximizeBtn && creditsWindow) {
        maximizeBtn.addEventListener('click', () => {
            creditsWindow.classList.toggle('maximized');
            creditsWindow.classList.remove('minimized');
        });
    }

    // Initializations - removed initOrb from here
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}