// =============================================================
// Heena Jewellery Works - Gold Ledger
// Backend: Supabase (Public Access - RLS Disabled)
// Auth: Custom app_users table (username + password)
// =============================================================

// --- Supabase Configuration ---
const SUPABASE_URL = 'https://iojcfzxwafdbnhxfgffe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvamNmenh3YWZkYm5oeGZnZmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzYyOTcsImV4cCI6MjA5NDg1MjI5N30.2Ao6_cxFev400bf8MB8831zUdcihsKIwdhw_ezFPFlE';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let isLoggedIn = false;

// --- State ---
let state = {
    incoming: [],
    conversions: [],
    losses: [],
    boxStarts: [],
    boxRemovals: [],
    distribution: [],
    suggestions: { purposes: [], workers: [], boxes: [], names: [] }
};

let selections = {
    incoming: new Set(),
    outgoing: new Set(),
    loss: new Set(),
    invRem: new Set(),
    distribution: new Set()
};

// --- Cloud Data Loading ---
async function loadStateFromCloud() {
    showLoadingOverlay(true);
    try {
        const [inc, conv, loss, bStarts, bRems, dist] = await Promise.all([
            supabase.from('incoming').select('*').order('date', { ascending: false }),
            supabase.from('conversions').select('*').order('date', { ascending: false }),
            supabase.from('losses').select('*').order('date', { ascending: false }),
            supabase.from('box_starts').select('*').order('date', { ascending: false }),
            supabase.from('box_removals').select('*').order('date', { ascending: false }),
            supabase.from('distributions').select('*').order('date', { ascending: false })
        ]);

        if (inc.error || conv.error || loss.error || bStarts.error || bRems.error || dist.error) {
            showToast('Error loading data from database. Please check your Supabase setup.', 'error');
            console.error(inc.error, conv.error, loss.error, bStarts.error, bRems.error, dist.error);
            return;
        }

        state.incoming = inc.data || [];
        state.conversions = conv.data || [];
        state.losses = loss.data || [];
        state.boxStarts = bStarts.data || [];
        state.boxRemovals = bRems.data || [];
        state.distribution = dist.data || [];

        // Rebuild suggestions from loaded data
        state.suggestions = { purposes: [], workers: [], boxes: [], names: [] };
        state.conversions.forEach(c => addSuggestion('purposes', c.purpose));
        state.losses.forEach(l => addSuggestion('workers', l.worker));
        state.boxStarts.forEach(s => addSuggestion('boxes', s.box));
        state.boxRemovals.forEach(r => addSuggestion('boxes', r.box));
        state.distribution.forEach(d => addSuggestion('names', d.name));
        populateDatalists();

        window.renderIncoming();
        window.renderOutgoing();
        window.renderLoss();
        window.renderInventoryModule();
        window.renderDistribution();
        updateDailySummary();
    } catch (e) {
        showToast('Network error. Please check your internet connection.', 'error');
        console.error("Cloud load error:", e);
    } finally {
        showLoadingOverlay(false);
    }
}

// --- Toast Notification ---
function showToast(message, type = 'success') {
    let toast = document.getElementById('app-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.style.cssText = `
            position: fixed; bottom: 32px; right: 32px; z-index: 9999;
            padding: 14px 22px; border-radius: 10px; font-size: 0.9rem;
            font-weight: 500; max-width: 340px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
            transition: all 0.3s ease; opacity: 0; transform: translateY(20px);
        `;
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    if (type === 'error') {
        toast.style.background = 'rgba(239,68,68,0.15)';
        toast.style.border = '1px solid rgba(239,68,68,0.4)';
        toast.style.color = '#ef4444';
    } else {
        toast.style.background = 'rgba(212,175,55,0.15)';
        toast.style.border = '1px solid rgba(212,175,55,0.4)';
        toast.style.color = '#d4af37';
    }
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
    }, 3500);
}

// --- Loading Overlay ---
function showLoadingOverlay(show) {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.innerHTML = `<div style="text-align:center;"><div class="spinner"></div><p style="color:var(--accent-color);margin-top:16px;font-weight:600;">Loading Data...</p></div>`;
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:8888;display:flex;align-items:center;justify-content:center;
            background:rgba(5,5,5,0.85);backdrop-filter:blur(8px);
        `;
        document.body.appendChild(overlay);
        // Add spinner style
        if (!document.getElementById('spinner-style')) {
            const s = document.createElement('style');
            s.id = 'spinner-style';
            s.textContent = `.spinner{width:44px;height:44px;border:3px solid rgba(212,175,55,0.2);border-top-color:var(--accent-color);border-radius:50%;animation:spin 0.8s linear infinite;}@keyframes spin{to{transform:rotate(360deg);}}`;
            document.head.appendChild(s);
        }
    }
    overlay.style.display = show ? 'flex' : 'none';
}

// =============================================================
// --- Authentication (Custom app_users table) ---
// =============================================================
async function initAuth() {
    // Check if already logged in via session storage
    if (sessionStorage.getItem('gl_logged_in') === 'true') {
        showApp();
        await loadStateFromCloud();
        return;
    }
    showLoginScreen();

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('login-username').value.trim();
            const password = document.getElementById('login-password').value;
            const errDiv = document.getElementById('login-error');
            const submitBtn = document.getElementById('btn-login-submit');

            errDiv.style.display = 'none';
            submitBtn.textContent = 'Checking...';
            submitBtn.disabled = true;

            try {
                const { data, error } = await supabase
                    .from('app_users')
                    .select('username')
                    .eq('username', username)
                    .eq('password', password)
                    .single();

                if (error || !data) {
                    errDiv.textContent = 'Invalid username or password.';
                    errDiv.style.display = 'block';
                } else {
                    sessionStorage.setItem('gl_logged_in', 'true');
                    sessionStorage.setItem('gl_username', username);
                    showApp();
                    await loadStateFromCloud();
                }
            } catch (err) {
                errDiv.textContent = 'Connection error. Please try again.';
                errDiv.style.display = 'block';
            }

            submitBtn.textContent = 'Log In';
            submitBtn.disabled = false;
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            sessionStorage.removeItem('gl_logged_in');
            sessionStorage.removeItem('gl_username');
            isLoggedIn = false;
            showLoginScreen();
            // Reset state
            state = { incoming: [], conversions: [], losses: [], boxStarts: [], boxRemovals: [], distribution: [], suggestions: { purposes: [], workers: [], boxes: [], names: [] } };
        });
    }
}

function showLoginScreen() {
    isLoggedIn = false;
    document.getElementById('app-sidebar').style.display = 'none';
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.getElementById('module-login').classList.add('active');
}

function showApp() {
    isLoggedIn = true;
    document.getElementById('app-sidebar').style.display = 'flex';
    document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
    document.getElementById('module-login').classList.remove('active');
    document.getElementById('module-outgoing').classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-target="module-outgoing"]')?.classList.add('active');
}

// =============================================================
// --- Utilities ---
// =============================================================
function capitalizeFirstLetter(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function getTodayFormatted() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function setEditMode(formId, btnId, isEdit) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    if (isEdit) {
        btn.textContent = "Save Changes";
        btn.classList.add("edit-mode");
    } else {
        const defaultText = formId === 'inv-start-form' ? "Set Starting Weight" :
                            formId === 'inv-rem-form' ? "Log Removal" :
                            formId === 'incoming-form' ? "Add Entry" :
                            formId === 'outgoing-form' ? "Add Entry" :
                            formId === 'loss-form' ? "Add Loss" :
                            formId === 'dist-form' ? "Add Record" : "Save Entry";
        btn.textContent = defaultText;
        btn.classList.remove("edit-mode");
    }
}

function addSuggestion(type, value) {
    if (!value) return;
    if (!state.suggestions[type].includes(value)) {
        state.suggestions[type].push(value);
    }
}

// --- Datalist Auto-Complete ---
function populateDatalists() {
    const fillList = (listId, array) => {
        const list = document.getElementById(listId);
        if (!list) return;
        list.innerHTML = '';
        array.forEach(val => {
            const option = document.createElement('option');
            option.value = val;
            list.appendChild(option);
        });
    };
    fillList('purposes-list', state.suggestions.purposes);
    fillList('workers-list', state.suggestions.workers);
    fillList('boxes-list', state.suggestions.boxes);
    fillList('names-list', state.suggestions.names);
}

// =============================================================
// --- Navigation ---
// =============================================================
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const modules = document.querySelectorAll('.module');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            modules.forEach(m => m.classList.remove('active'));
            const targetId = btn.getAttribute('data-target');
            btn.classList.add('active');
            document.getElementById(targetId).classList.add('active');
            if (targetId === 'module-daily') updateDailySummary();
            if (targetId === 'module-inventory') renderInventoryModule();
        });
    });
}

// =============================================================
// --- Bulk Actions ---
// =============================================================
window.toggleEditMode = function(moduleKey) {
    const tableCard = document.getElementById(`tc-${moduleKey}`);
    if (!tableCard) return;
    if (tableCard.classList.contains('edit-mode-active')) {
        tableCard.classList.remove('edit-mode-active');
        selections[moduleKey] && selections[moduleKey].clear();
        const cbId = moduleKey === 'outgoing' ? 'out-select-all' :
                     moduleKey === 'invRem' ? 'invRem-select-all' :
                     `${moduleKey.substring(0,3)}-select-all`;
        const checkbox = document.getElementById(cbId);
        if (checkbox) checkbox.checked = false;
        if (moduleKey === 'invRem') renderInventoryModule();
        else if (window[`render${capitalizeFirstLetter(moduleKey)}`]) window[`render${capitalizeFirstLetter(moduleKey)}`]();
    } else {
        tableCard.classList.add('edit-mode-active');
    }
};

window.toggleSelectAll = function(moduleKey) {
    const cbId = moduleKey === 'outgoing' ? 'out-select-all' :
                 moduleKey === 'invRem' ? 'invRem-select-all' :
                 `${moduleKey.substring(0,3)}-select-all`;
    const checkbox = document.getElementById(cbId);
    if (!checkbox) return;
    const renderedIndices = window[`${moduleKey}RenderedIndices`] || [];
    if (checkbox.checked) {
        renderedIndices.forEach(idx => selections[moduleKey].add(idx));
    } else {
        renderedIndices.forEach(idx => selections[moduleKey].delete(idx));
    }
    if (moduleKey === 'invRem') renderInventoryModule();
    else if (window[`render${capitalizeFirstLetter(moduleKey)}`]) window[`render${capitalizeFirstLetter(moduleKey)}`]();
};

window.toggleSelect = function(moduleKey, index) {
    if (selections[moduleKey].has(index)) selections[moduleKey].delete(index);
    else selections[moduleKey].add(index);
    const cbId = moduleKey === 'outgoing' ? 'out-select-all' :
                 moduleKey === 'invRem' ? 'invRem-select-all' :
                 `${moduleKey.substring(0,3)}-select-all`;
    const checkbox = document.getElementById(cbId);
    if (!checkbox) return;
    const renderedIndices = window[`${moduleKey}RenderedIndices`] || [];
    checkbox.checked = renderedIndices.length > 0 && renderedIndices.every(idx => selections[moduleKey].has(idx));
};

window.bulkDelete = async function(moduleKey) {
    if (!selections[moduleKey] || selections[moduleKey].size === 0) {
        showToast('No rows selected. Use "Edit in Table" to select rows first.', 'error');
        return;
    }
    if (!confirm(`Delete ${selections[moduleKey].size} selected entries?`)) return;

    const stateKey = moduleKey === 'outgoing' ? 'conversions' :
                     moduleKey === 'invRem' ? 'boxRemovals' :
                     moduleKey === 'loss' ? 'losses' :
                     moduleKey === 'distribution' ? 'distribution' : moduleKey;
    const tableName = moduleKey === 'outgoing' ? 'conversions' :
                      moduleKey === 'invRem' ? 'box_removals' :
                      moduleKey === 'loss' ? 'losses' :
                      moduleKey === 'distribution' ? 'distributions' : moduleKey;

    const indicesToDelete = Array.from(selections[moduleKey]).sort((a, b) => b - a);
    const idsToDelete = indicesToDelete.map(i => state[stateKey][i]?.id).filter(Boolean);

    if (idsToDelete.length === 0) { showToast('No valid items to delete.', 'error'); return; }

    const { error } = await supabase.from(tableName).delete().in('id', idsToDelete);
    if (error) {
        showToast(`Delete failed: ${error.message}`, 'error');
        console.error(error);
        return;
    }

    indicesToDelete.forEach(i => state[stateKey].splice(i, 1));
    selections[moduleKey].clear();

    const cbId = moduleKey === 'outgoing' ? 'out-select-all' :
                 moduleKey === 'invRem' ? 'invRem-select-all' :
                 `${moduleKey.substring(0,3)}-select-all`;
    const cb = document.getElementById(cbId);
    if (cb) cb.checked = false;

    if (moduleKey === 'invRem') renderInventoryModule();
    else if (window[`render${capitalizeFirstLetter(moduleKey)}`]) window[`render${capitalizeFirstLetter(moduleKey)}`]();

    if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
    showToast(`${idsToDelete.length} entries deleted.`);
};

// =============================================================
// --- Module 0: Incoming Gold ---
// =============================================================
window.renderIncoming = function() {
    const tbody = document.getElementById('incoming-tbody');
    if (!tbody) return;
    const filterWeight = document.getElementById('filter-inc-weight')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-inc-date')?.value || '';
    tbody.innerHTML = '';
    window.incomingRenderedIndices = [];

    state.incoming.forEach((entry, index) => {
        const wStr = parseFloat(entry.weight24).toFixed(4);
        const dStr = entry.date;
        if (wStr.includes(filterWeight) && dStr.includes(filterDate)) {
            window.incomingRenderedIndices.push(index);
            const isChecked = selections.incoming.has(index) ? 'checked' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('incoming', ${index})" ${isChecked}></td>
                <td>${index + 1}</td>
                <td>${wStr}</td>
                <td>${dStr}</td>
                <td><div class="action-buttons">
                    <button class="btn-icon btn-edit" onclick="editIncoming(${index})"><i class="ph ph-pencil-simple"></i></button>
                </div></td>
            `;
            tbody.appendChild(tr);
        }
    });
};

function initIncoming() {
    const form = document.getElementById('incoming-form');
    const dateInput = document.getElementById('inc-date');
    const filterDate = document.getElementById('filter-inc-date');
    const editIdInput = document.getElementById('inc-edit-id');
    if (!dateInput.value) dateInput.value = getTodayFormatted();
    if (filterDate && !filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const weight24 = parseFloat(document.getElementById('inc-weight').value);
        const date = dateInput.value;
        const editId = parseInt(editIdInput.value);

        if (editId > -1) {
            const dbId = state.incoming[editId].id;
            const { data, error } = await supabase.from('incoming').update({ weight24, date }).eq('id', dbId).select();
            if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
            if (data) state.incoming[editId] = data[0];
            editIdInput.value = '-1';
            setEditMode('incoming-form', 'inc-submit-btn', false);
        } else {
            const { data, error } = await supabase.from('incoming').insert({ weight24, date }).select();
            if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
            if (data) state.incoming.unshift(data[0]);
        }

        renderIncoming();
        form.reset();
        dateInput.value = getTodayFormatted();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Incoming entry saved.');
    });

    window.editIncoming = (index) => {
        const entry = state.incoming[index];
        document.getElementById('inc-weight').value = entry.weight24;
        document.getElementById('inc-date').value = entry.date;
        editIdInput.value = index;
        setEditMode('incoming-form', 'inc-submit-btn', true);
        document.getElementById('module-incoming').scrollIntoView({ behavior: 'smooth' });
    };

    renderIncoming();
}

// =============================================================
// --- Module 1: Gold Used ---
// =============================================================
window.renderOutgoing = function() {
    const tbody = document.getElementById('outgoing-tbody');
    if (!tbody) return;
    const filterPurpose = document.getElementById('filter-out-purpose')?.value.toLowerCase() || '';
    const filter24ct = document.getElementById('filter-out-24ct')?.value.toLowerCase() || '';
    const filter22ct = document.getElementById('filter-out-22ct')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-out-date')?.value || '';
    tbody.innerHTML = '';
    window.outgoingRenderedIndices = [];

    state.conversions.forEach((entry, index) => {
        const pStr = (entry.purpose || '').toLowerCase();
        const w24Str = parseFloat(entry.weight24).toFixed(4);
        const w22Str = parseFloat(entry.weight22) > 0 ? parseFloat(entry.weight22).toFixed(4) : '-';
        const dStr = entry.date;
        if (pStr.includes(filterPurpose) && w24Str.includes(filter24ct) && w22Str.includes(filter22ct) && dStr.includes(filterDate)) {
            window.outgoingRenderedIndices.push(index);
            const isChecked = selections.outgoing.has(index) ? 'checked' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('outgoing', ${index})" ${isChecked}></td>
                <td>${entry.purpose}</td>
                <td>${w24Str}</td>
                <td>${w22Str}</td>
                <td>${dStr}</td>
                <td><div class="action-buttons">
                    <button class="btn-icon btn-edit" onclick="editOutgoing(${index})"><i class="ph ph-pencil-simple"></i></button>
                </div></td>
            `;
            tbody.appendChild(tr);
        }
    });
};

function initOutgoing() {
    const form = document.getElementById('outgoing-form');
    const dateInput = document.getElementById('conv-date');
    const filterDate = document.getElementById('filter-out-date');
    const editIdInput = document.getElementById('conv-edit-id');
    if (!dateInput.value) dateInput.value = getTodayFormatted();
    if (filterDate && !filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const purpose = capitalizeFirstLetter(document.getElementById('conv-purpose').value);
        const weight24 = parseFloat(document.getElementById('conv-24ct').value);
        const date = dateInput.value;
        const editId = parseInt(editIdInput.value);
        addSuggestion('purposes', purpose);
        const weight22 = purpose.toLowerCase() === 'melt' ? weight24 * (100 / 92) : 0;

        if (editId > -1) {
            const dbId = state.conversions[editId].id;
            const { data, error } = await supabase.from('conversions').update({ purpose, weight24, weight22, date }).eq('id', dbId).select();
            if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
            if (data) state.conversions[editId] = data[0];
            editIdInput.value = '-1';
            setEditMode('outgoing-form', 'conv-submit-btn', false);
        } else {
            const { data, error } = await supabase.from('conversions').insert({ purpose, weight24, weight22, date }).select();
            if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
            if (data) state.conversions.unshift(data[0]);
        }

        populateDatalists();
        renderOutgoing();
        form.reset();
        dateInput.value = getTodayFormatted();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Gold Used entry saved.');
    });

    window.editOutgoing = (index) => {
        const entry = state.conversions[index];
        document.getElementById('conv-purpose').value = entry.purpose;
        document.getElementById('conv-24ct').value = entry.weight24;
        document.getElementById('conv-date').value = entry.date;
        editIdInput.value = index;
        setEditMode('outgoing-form', 'conv-submit-btn', true);
        document.getElementById('module-outgoing').scrollIntoView({ behavior: 'smooth' });
    };

    renderOutgoing();
}

// =============================================================
// --- Module 2: Worker Loss ---
// =============================================================
window.renderLoss = function() {
    const tbody = document.getElementById('loss-tbody');
    if (!tbody) return;
    const filterWorker = document.getElementById('filter-loss-worker')?.value.toLowerCase() || '';
    const filterAmount = document.getElementById('filter-loss-amount')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-loss-date')?.value || '';
    const totalEl = document.getElementById('total-loss');
    tbody.innerHTML = '';
    window.lossRenderedIndices = [];
    let total = 0;

    state.losses.forEach((entry, index) => {
        const wStr = (entry.worker || '').toLowerCase();
        const aStr = parseFloat(entry.amount).toFixed(2);
        const dStr = entry.date;
        if (wStr.includes(filterWorker) && aStr.includes(filterAmount) && dStr.includes(filterDate)) {
            window.lossRenderedIndices.push(index);
            total += parseFloat(entry.amount);
            const isChecked = selections.loss.has(index) ? 'checked' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('loss', ${index})" ${isChecked}></td>
                <td>${entry.worker}</td>
                <td>${aStr}</td>
                <td>${dStr}</td>
                <td><div class="action-buttons">
                    <button class="btn-icon btn-edit" onclick="editLoss(${index})"><i class="ph ph-pencil-simple"></i></button>
                </div></td>
            `;
            tbody.appendChild(tr);
        }
    });
    if (totalEl) totalEl.textContent = total.toFixed(2);
};

function initLoss() {
    const form = document.getElementById('loss-form');
    const dateInput = document.getElementById('loss-date');
    const filterDate = document.getElementById('filter-loss-date');
    const editIdInput = document.getElementById('loss-edit-id');
    if (!dateInput.value) dateInput.value = getTodayFormatted();
    if (filterDate && !filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const worker = capitalizeFirstLetter(document.getElementById('loss-worker').value);
        const amount = parseFloat(document.getElementById('loss-amount').value);
        const date = dateInput.value;
        const editId = parseInt(editIdInput.value);
        addSuggestion('workers', worker);

        if (editId > -1) {
            const dbId = state.losses[editId].id;
            const { data, error } = await supabase.from('losses').update({ worker, amount, date }).eq('id', dbId).select();
            if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
            if (data) state.losses[editId] = data[0];
            editIdInput.value = '-1';
            setEditMode('loss-form', 'loss-submit-btn', false);
        } else {
            const { data, error } = await supabase.from('losses').insert({ worker, amount, date }).select();
            if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
            if (data) state.losses.unshift(data[0]);
        }

        populateDatalists();
        renderLoss();
        form.reset();
        dateInput.value = getTodayFormatted();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Loss entry saved.');
    });

    window.editLoss = (index) => {
        const entry = state.losses[index];
        document.getElementById('loss-worker').value = entry.worker;
        document.getElementById('loss-amount').value = entry.amount;
        document.getElementById('loss-date').value = entry.date;
        editIdInput.value = index;
        setEditMode('loss-form', 'loss-submit-btn', true);
        document.getElementById('module-loss').scrollIntoView({ behavior: 'smooth' });
    };

    renderLoss();
}

// =============================================================
// --- Module 3: Box Inventory ---
// =============================================================
function getAllBoxes() {
    const boxes = new Set();
    state.boxStarts.forEach(s => boxes.add(s.box));
    state.boxRemovals.forEach(r => boxes.add(r.box));
    state.suggestions.boxes.forEach(b => boxes.add(b));
    return Array.from(boxes).sort();
}

function getCalculatedStartWeights(targetDate) {
    const result = {};
    getAllBoxes().forEach(box => {
        const starts = state.boxStarts.filter(s => s.box === box && s.date <= targetDate);
        if (starts.length === 0) { result[box] = { weight: 0, isOverride: false }; return; }
        starts.sort((a, b) => b.date.localeCompare(a.date));
        const latestStart = starts[0];
        const removals = state.boxRemovals
            .filter(r => r.box === box && r.date >= latestStart.date && r.date < targetDate)
            .reduce((sum, r) => sum + parseFloat(r.weight), 0);
        result[box] = {
            weight: Math.max(0, parseFloat(latestStart.weight) - removals),
            isOverride: latestStart.date === targetDate
        };
    });
    return result;
}

window.deleteStartOverride = async function(box, date) {
    if (!confirm(`Delete the manual starting weight for "${box}" on ${date}?`)) return;
    const index = state.boxStarts.findIndex(s => s.box === box && s.date === date);
    if (index > -1) {
        const dbId = state.boxStarts[index].id;
        const { error } = await supabase.from('box_starts').delete().eq('id', dbId);
        if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
        state.boxStarts.splice(index, 1);
        renderInventoryModule();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Starting weight deleted.');
    }
};

window.editRemoval = function(index) {
    const entry = state.boxRemovals[index];
    document.getElementById('inv-rem-box').value = entry.box;
    document.getElementById('inv-rem-weight').value = entry.weight;
    document.getElementById('inv-rem-edit-id').value = index;
    setEditMode('inv-rem-form', 'inv-rem-submit-btn', true);
    document.getElementById('module-inventory').scrollIntoView({ behavior: 'smooth' });
};

window.renderInventoryModule = function() {
    const masterDate = document.getElementById('master-inv-date')?.value || getTodayFormatted();
    const startTbody = document.getElementById('inv-start-tbody');
    const filterStartBox = document.getElementById('filter-inv-start-box')?.value.toLowerCase() || '';
    if (startTbody) {
        startTbody.innerHTML = '';
        const startWeights = getCalculatedStartWeights(masterDate);
        Object.entries(startWeights).forEach(([box, data]) => {
            if (box.toLowerCase().includes(filterStartBox)) {
                const tr = document.createElement('tr');
                let statusHtml = data.isOverride
                    ? `<span class="badge" style="background:rgba(212,175,55,0.15);color:var(--accent-color);border:1px solid rgba(212,175,55,0.4);">Manual</span>
                       <button class="btn-icon btn-delete" onclick="deleteStartOverride('${box}','${masterDate}')" title="Delete"><i class="ph ph-trash"></i></button>`
                    : `<span class="badge" style="background:rgba(255,255,255,0.05);color:var(--text-muted);border:1px solid rgba(255,255,255,0.1);">Calculated</span>`;
                tr.innerHTML = `<td>${box}</td><td>${data.weight.toFixed(2)}</td><td><div style="display:flex;align-items:center;gap:8px;">${statusHtml}</div></td>`;
                startTbody.appendChild(tr);
            }
        });
    }

    const remTbody = document.getElementById('inv-rem-tbody');
    const filterRemBox = document.getElementById('filter-inv-rem-box')?.value.toLowerCase() || '';
    const totalRemEl = document.getElementById('total-inv-rem');
    if (remTbody) {
        remTbody.innerHTML = '';
        window.invRemRenderedIndices = [];
        let totalRem = 0;
        state.boxRemovals.forEach((entry, index) => {
            if (entry.date === masterDate && entry.box.toLowerCase().includes(filterRemBox)) {
                window.invRemRenderedIndices.push(index);
                totalRem += parseFloat(entry.weight);
                const isChecked = selections.invRem.has(index) ? 'checked' : '';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('invRem', ${index})" ${isChecked}></td>
                    <td>${entry.box}</td>
                    <td>${parseFloat(entry.weight).toFixed(2)}</td>
                    <td><div class="action-buttons">
                        <button class="btn-icon btn-edit" onclick="editRemoval(${index})"><i class="ph ph-pencil-simple"></i></button>
                    </div></td>
                `;
                remTbody.appendChild(tr);
            }
        });
        if (totalRemEl) totalRemEl.textContent = totalRem.toFixed(2);
    }
};

function initInventory() {
    const masterDateInput = document.getElementById('master-inv-date');
    if (!masterDateInput.value) masterDateInput.value = getTodayFormatted();

    const startForm = document.getElementById('inv-start-form');
    startForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const box = capitalizeFirstLetter(document.getElementById('inv-start-box').value);
        const weight = parseFloat(document.getElementById('inv-start-weight').value);
        const date = masterDateInput.value;
        const editId = parseInt(document.getElementById('inv-start-edit-id').value);
        addSuggestion('boxes', box);

        if (editId > -1) {
            const dbId = state.boxStarts[editId].id;
            const { data, error } = await supabase.from('box_starts').update({ box, weight, date }).eq('id', dbId).select();
            if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
            if (data) state.boxStarts[editId] = data[0];
            document.getElementById('inv-start-edit-id').value = '-1';
            setEditMode('inv-start-form', 'inv-start-submit-btn', false);
        } else {
            const existingIndex = state.boxStarts.findIndex(s => s.box === box && s.date === date);
            if (existingIndex > -1) {
                const newWeight = parseFloat(state.boxStarts[existingIndex].weight) + weight;
                const dbId = state.boxStarts[existingIndex].id;
                const { data, error } = await supabase.from('box_starts').update({ weight: newWeight }).eq('id', dbId).select();
                if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
                if (data) state.boxStarts[existingIndex] = data[0];
            } else {
                const { data, error } = await supabase.from('box_starts').insert({ box, weight, date }).select();
                if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
                if (data) state.boxStarts.push(data[0]);
            }
        }

        populateDatalists();
        renderInventoryModule();
        startForm.reset();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Starting weight saved.');
    });

    const remForm = document.getElementById('inv-rem-form');
    remForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const box = capitalizeFirstLetter(document.getElementById('inv-rem-box').value);
        const weight = parseFloat(document.getElementById('inv-rem-weight').value);
        const date = masterDateInput.value;
        const editId = parseInt(document.getElementById('inv-rem-edit-id').value);
        addSuggestion('boxes', box);

        if (editId > -1) {
            const dbId = state.boxRemovals[editId].id;
            const { data, error } = await supabase.from('box_removals').update({ box, weight, date }).eq('id', dbId).select();
            if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
            if (data) state.boxRemovals[editId] = data[0];
            document.getElementById('inv-rem-edit-id').value = '-1';
            setEditMode('inv-rem-form', 'inv-rem-submit-btn', false);
        } else {
            const { data, error } = await supabase.from('box_removals').insert({ box, weight, date }).select();
            if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
            if (data) state.boxRemovals.push(data[0]);
        }

        populateDatalists();
        renderInventoryModule();
        remForm.reset();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Removal logged.');
    });

    renderInventoryModule();
}

// =============================================================
// --- Module 4: Gold Distribution ---
// =============================================================
window.renderDistribution = function() {
    const tbody = document.getElementById('dist-tbody');
    if (!tbody) return;
    const filterName = document.getElementById('filter-dist-name')?.value.toLowerCase() || '';
    const filterWeight = document.getElementById('filter-dist-weight')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-dist-date')?.value || '';
    const totalEl = document.getElementById('total-distribution');
    tbody.innerHTML = '';
    window.distributionRenderedIndices = [];
    let total = 0;

    state.distribution.forEach((entry, index) => {
        const nStr = (entry.name || '').toLowerCase();
        const wStr = parseFloat(entry.weight).toFixed(2);
        const dStr = entry.date;
        if (nStr.includes(filterName) && wStr.includes(filterWeight) && dStr.includes(filterDate)) {
            window.distributionRenderedIndices.push(index);
            total += parseFloat(entry.weight);
            const isChecked = selections.distribution.has(index) ? 'checked' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('distribution', ${index})" ${isChecked}></td>
                <td>${entry.name}</td>
                <td>${wStr}</td>
                <td>${dStr}</td>
                <td><div class="action-buttons">
                    <button class="btn-icon btn-edit" onclick="editDistribution(${index})"><i class="ph ph-pencil-simple"></i></button>
                </div></td>
            `;
            tbody.appendChild(tr);
        }
    });
    if (totalEl) totalEl.textContent = total.toFixed(2);
};

function initDistribution() {
    const form = document.getElementById('dist-form');
    const dateInput = document.getElementById('dist-date');
    const filterDate = document.getElementById('filter-dist-date');
    const editIdInput = document.getElementById('dist-edit-id');
    if (!dateInput.value) dateInput.value = getTodayFormatted();
    if (filterDate && !filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = capitalizeFirstLetter(document.getElementById('dist-name').value);
        const weight = parseFloat(document.getElementById('dist-weight').value);
        const date = dateInput.value;
        const editId = parseInt(editIdInput.value);
        addSuggestion('names', name);

        if (editId > -1) {
            const dbId = state.distribution[editId].id;
            const { data, error } = await supabase.from('distributions').update({ name, weight, date }).eq('id', dbId).select();
            if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
            if (data) state.distribution[editId] = data[0];
            editIdInput.value = '-1';
            setEditMode('dist-form', 'dist-submit-btn', false);
        } else {
            const { data, error } = await supabase.from('distributions').insert({ name, weight, date }).select();
            if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
            if (data) state.distribution.unshift(data[0]);
        }

        populateDatalists();
        renderDistribution();
        form.reset();
        dateInput.value = getTodayFormatted();
        if (document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
        showToast('Distribution entry saved.');
    });

    window.editDistribution = (index) => {
        const entry = state.distribution[index];
        document.getElementById('dist-name').value = entry.name;
        document.getElementById('dist-weight').value = entry.weight;
        document.getElementById('dist-date').value = entry.date;
        editIdInput.value = index;
        setEditMode('dist-form', 'dist-submit-btn', true);
        document.getElementById('module-distribution').scrollIntoView({ behavior: 'smooth' });
    };

    renderDistribution();
}

// =============================================================
// --- Module 5: Daily Summary ---
// =============================================================
function initDailySummary() {
    const dateInput = document.getElementById('summary-date');
    if (!dateInput.value) dateInput.value = getTodayFormatted();
    dateInput.addEventListener('change', updateDailySummary);
    updateDailySummary();
}

function updateDailySummary() {
    const selectedDate = document.getElementById('summary-date').value;
    document.getElementById('display-summary-date-22').textContent = selectedDate || '...';
    document.getElementById('display-summary-date-24').textContent = selectedDate || '...';
    if (!selectedDate) return;

    const sum22ct = state.conversions.filter(c => c.date === selectedDate).reduce((s, c) => s + parseFloat(c.weight22 || 0), 0);
    const sumLoss = state.losses.filter(l => l.date === selectedDate).reduce((s, l) => s + parseFloat(l.amount || 0), 0);
    const sumDist = state.distribution.filter(d => d.date === selectedDate).reduce((s, d) => s + parseFloat(d.weight || 0), 0);

    let sumBox = 0;
    const startWeights = getCalculatedStartWeights(selectedDate);
    Object.entries(startWeights).forEach(([box, data]) => {
        const removalsOnDate = state.boxRemovals
            .filter(r => r.box === box && r.date === selectedDate)
            .reduce((s, r) => s + parseFloat(r.weight), 0);
        sumBox += Math.max(0, data.weight - removalsOnDate);
    });

    document.getElementById('sum-22ct').textContent = sum22ct.toFixed(4);
    document.getElementById('sum-loss').textContent = '- ' + sumLoss.toFixed(4);
    document.getElementById('sum-box').textContent = '+ ' + sumBox.toFixed(4);
    document.getElementById('sum-dist').textContent = '- ' + sumDist.toFixed(4);

    const finalTotal22 = sum22ct - sumLoss + sumBox - sumDist;
    const finalTotalEl = document.getElementById('final-total');
    finalTotalEl.innerHTML = `${finalTotal22.toFixed(4)} <span class="unit">grams</span>`;
    finalTotalEl.style.color = finalTotal22 < 0 ? 'var(--danger)' : 'var(--accent-color)';

    const sumIncoming24 = state.incoming.filter(i => i.date === selectedDate).reduce((s, i) => s + parseFloat(i.weight24 || 0), 0);
    const sumOutgoing24 = state.conversions.filter(c => c.date === selectedDate).reduce((s, c) => s + parseFloat(c.weight24 || 0), 0);
    const finalTotal24 = sumIncoming24 - sumOutgoing24;
    const finalTotal24El = document.getElementById('final-total-24');
    finalTotal24El.innerHTML = `${finalTotal24.toFixed(4)} <span class="unit">grams</span>`;
    finalTotal24El.style.color = finalTotal24 < 0 ? 'var(--danger)' : 'var(--text-primary)';
}

// =============================================================
// --- App Initialization ---
// =============================================================
document.addEventListener('DOMContentLoaded', () => {
    populateDatalists();
    initNavigation();
    initIncoming();
    initOutgoing();
    initLoss();
    initInventory();
    initDistribution();
    initDailySummary();
    initAuth();
});
