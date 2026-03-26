// ═══════════════════════════════════════════
// ReplyPals — Onboarding Logic
// ═══════════════════════════════════════════
(function () {
    'use strict';

    let currentStep = 1;
    const selectedSites = new Set();
    let selectedGoal = null;

    const TONE_DEFAULTS = {
        gmail: 'formal',
        linkedin: 'confident',
        whatsapp: 'casual',
        twitter: 'casual',
        slack: 'friendly',
        other: 'polite'
    };

    // ─── DOM ───
    const dots = document.querySelectorAll('.ob-dot');
    const step1 = document.getElementById('obStep1');
    const step2 = document.getElementById('obStep2');
    const step3 = document.getElementById('obStep3');
    const successEl = document.getElementById('obSuccess');
    const stepsWrapper = document.getElementById('obStepsWrapper');

    const btnStep1 = document.getElementById('obBtnStep1');
    const btnStep2 = document.getElementById('obBtnStep2');
    const btnStep3 = document.getElementById('obBtnStep3');
    const sitesGrid = document.getElementById('obSitesGrid');
    const goalsList = document.getElementById('obGoalsList');

    // ─── Step Navigation ───
    function goToStep(step) {
        currentStep = step;

        // Update dots
        dots.forEach(dot => {
            const s = parseInt(dot.dataset.step);
            dot.classList.remove('active', 'completed');
            if (s === step) dot.classList.add('active');
            else if (s < step) dot.classList.add('completed');
        });

        // Show correct step
        [step1, step2, step3].forEach(el => el.classList.remove('active'));
        if (step === 1) step1.classList.add('active');
        else if (step === 2) step2.classList.add('active');
        else if (step === 3) step3.classList.add('active');
    }

    // ─── Step 1: Welcome ───
    btnStep1.addEventListener('click', () => {
        goToStep(2);
    });

    // ─── Step 2: Site Selection ───
    sitesGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.ob-site-card');
        if (!card) return;
        const site = card.dataset.site;
        if (selectedSites.has(site)) {
            selectedSites.delete(site);
            card.classList.remove('selected');
        } else {
            selectedSites.add(site);
            card.classList.add('selected');
        }
    });

    btnStep2.addEventListener('click', async () => {
        // Save site selections
        const sites = Array.from(selectedSites);
        await chrome.storage.local.set({ replypalSites: sites });

        // Set tone memory defaults based on selected sites
        const toneMemory = {};
        const SITE_HOSTNAMES = {
            gmail: 'mail.google.com',
            linkedin: 'linkedin.com',
            whatsapp: 'web.whatsapp.com',
            twitter: 'x.com',
            slack: 'slack.com'
        };

        sites.forEach(site => {
            const hostname = SITE_HOSTNAMES[site];
            const tone = TONE_DEFAULTS[site];
            if (hostname && tone) {
                toneMemory[hostname] = tone;
            }
        });

        if (Object.keys(toneMemory).length > 0) {
            await chrome.storage.local.set({ toneMemory: toneMemory });
        }

        goToStep(3);
    });

    // ─── Step 3: Goal Selection ───
    goalsList.addEventListener('click', (e) => {
        const option = e.target.closest('.ob-goal-option');
        if (!option) return;

        // Deselect all
        goalsList.querySelectorAll('.ob-goal-option').forEach(o => o.classList.remove('selected'));

        // Select this one
        option.classList.add('selected');
        const radio = option.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
        selectedGoal = option.dataset.goal;
    });

    btnStep3.addEventListener('click', async () => {
        if (!selectedGoal) {
            // Flash the first option as a hint
            goalsList.querySelector('.ob-goal-option').style.borderColor = '#EF4444';
            setTimeout(() => {
                goalsList.querySelector('.ob-goal-option').style.borderColor = '';
            }, 1500);
            return;
        }

        // Save goal
        await chrome.storage.local.set({
            replypalGoal: selectedGoal,
            replypalOnboarded: true,
            replypalCount: 0
        });

        // Show success
        stepsWrapper.style.display = 'none';
        document.querySelector('.ob-progress').style.display = 'none';
        successEl.style.display = 'block';

        // Close tab after 2 seconds
        setTimeout(() => {
            window.close();
        }, 2000);
    });
})();
