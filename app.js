const SUPABASE_URL = 'https://iojcfzxwafdbnhxfgffe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvamNmenh3YWZkYm5oeGZnZmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzYyOTcsImV4cCI6MjA5NDg1MjI5N30.2Ao6_cxFev400bf8MB8831zUdcihsKIwdhw_ezFPFlE';
window.supabaseClient = window.supabaseClient || 
    window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const supabase = window.supabaseClient;
let currentUser = null; // Stores the logged-in username string

// --- State Management ---
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

async function loadStateFromCloud() {
    if (!currentUser) return;
    try {
        const [inc, conv, loss, bStarts, bRems, dist] = await Promise.all([
            supabase.from('incoming').select('*'),
            supabase.from('conversions').select('*'),
            supabase.from('losses').select('*'),
            supabase.from('box_starts').select('*'),
            supabase.from('box_removals').select('*'),
            supabase.from('distributions').select('*') // Handled table name synchronization
        ]);
        
        state.incoming = inc.data || [];
        state.conversions = conv.data || [];
        state.losses = loss.data || [];
        state.boxStarts = bStarts.data || [];
        state.boxRemovals = bRems.data || [];
        state.distribution = dist.data || [];

        state.suggestions = { purposes: [], workers: [], boxes: [], names: [] };
        state.conversions.forEach(c => addSuggestion('purposes', c.purpose));
        state.losses.forEach(l => addSuggestion('workers', l.worker));
        state.boxStarts.forEach(s => addSuggestion('boxes', s.box));
        state.boxRemovals.forEach(r => addSuggestion('boxes', r.box));
        state.distribution.forEach(d => addSuggestion('names', d.name));
        populateDatalists();
        
        if(window.renderIncoming) window.renderIncoming();
        if(window.renderOutgoing) window.renderOutgoing();
        if(window.renderLoss) window.renderLoss();
        if(window.renderInventoryModule) window.renderInventoryModule();
        if(window.renderDistribution) window.renderDistribution();
        if(document.getElementById('module-daily').classList.contains('active')) updateDailySummary();
    } catch (e) {
        console.error("Error loading state from Supabase", e);
    }
}

// --- Custom Database Authentication ---
// --- Authentication ---
async function initAuth() {
    // Check if user session already exists locally to bypass login screen
    const savedUser = localStorage.getItem('app_user_session');
    if (savedUser) {
        handleAuthChange({ user: { id: 'local-session', email: savedUser } });
    } else {
        handleAuthChange(null);
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Map inputs to match your customized login interface fields
            const usernameInput = document.getElementById('login-username')?.value.trim() || 
                                  document.getElementById('login-email')?.value.trim();
            const passwordInput = document.getElementById('login-password')?.value;
            const errDiv = document.getElementById('login-error');
            const submitBtn = document.getElementById('btn-login-submit');
            
            if (!usernameInput || !passwordInput) {
                errDiv.textContent = "Please enter both username and password.";
                errDiv.style.display = 'block';
                return;
            }

            errDiv.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Verifying...';

            try {
                console.log("Attempting login for:", usernameInput);

                // Fetch raw entries securely to avoid SQL URL space parsing restrictions
                const { data, error } = await supabase
                    .from('app_users')
                    .select('*');

                console.log("Raw Database Rows Found:", data);

                if (error || !data || data.length === 0) {
                    errDiv.textContent = "Database connection error or no users configured.";
                    errDiv.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Login';
                    return;
                }

                // Clean and check every column property to bypass trailing blank space bugs
                const matchedUser = data.find(user => {
                    let dbUsername = "";
                    let dbPassword = "";

                    Object.keys(user).forEach(key => {
                        const cleanKey = key.trim().toLowerCase();
                        if (cleanKey === 'user name' || cleanKey === 'username') {
                            dbUsername = String(user[key]).trim();
                        }
                        if (cleanKey === 'password') {
                            dbPassword = String(user[key]).trim(); // Trim spaces from password too
                        }
                    });

                    return dbUsername === usernameInput && dbPassword === passwordInput;
                });

                if (!matchedUser) {
                    errDiv.textContent = "Invalid username or password.";
                    errDiv.style.display = 'block';
                    submitBtn.textContent = 'Login';
                    submitBtn.disabled = false;
                } else {
                    console.log("Success! Credentials matched perfectly.");
                    
                    let verifiedUsername = usernameInput;
                    Object.keys(matchedUser).forEach(key => {
                        if (key.trim().toLowerCase() === 'user name' || key.trim().toLowerCase() === 'username') {
                            verifiedUsername = String(matchedUser[key]).trim();
                        }
                    });
                    
                    // Save mock session payload to satisfy handleAuthChange() tracking rules
                    localStorage.setItem('app_user_session', verifiedUsername);
                    handleAuthChange({ user: { id: 'local-session', email: verifiedUsername } });
                    
                    loginForm.reset();
                    submitBtn.textContent = 'Login';
                    submitBtn.disabled = false;
                }
            } catch (err) {
                console.error("Critical routing breakdown:", err);
                errDiv.textContent = "Connection error. Please try again.";
                errDiv.style.display = 'block';
                submitBtn.textContent = 'Login';
                submitBtn.disabled = false;
            }
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            localStorage.removeItem('app_user_session');
            handleAuthChange(null);
        });
    }
}

async function handleAuthChange(session) {
    currentUser = session?.user || null;
    const sidebar = document.getElementById('app-sidebar');
    const mainContent = document.getElementById('app-main-content');
    const loginModule = document.getElementById('module-login');
    
    // Safely handles both 'module-outgoing-gold' and 'module-outgoing' names
    const defaultModule = document.getElementById('module-outgoing-gold') || document.getElementById('module-outgoing');
    const allModules = document.querySelectorAll('.module');
    
    if (currentUser) {
        if (sidebar) sidebar.style.display = 'flex';
        if (mainContent) mainContent.style.display = 'block';
        
        allModules.forEach(m => m.classList.remove('active'));
        if (loginModule) loginModule.style.display = 'none';
        if (loginModule) loginModule.classList.remove('active');
        
        // Safety check to prevent the classList crash
        if (defaultModule) {
            defaultModule.classList.add('active');
        } else {
            console.warn("Could not find default module panel element to display.");
        }
        
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        
        const defaultNavBtn = document.querySelector('[data-target="module-outgoing"]') || 
                               document.querySelector('[data-target="module-outgoing-gold"]');
        if (defaultNavBtn) defaultNavBtn.classList.add('active');
        
        await loadStateFromCloud();
    } else {
        if (sidebar) sidebar.style.display = 'none';
        if (mainContent) mainContent.style.display = 'none';
        allModules.forEach(m => m.classList.remove('active'));
        if (loginModule) {
            loginModule.style.display = 'block';
            loginModule.classList.add('active');
        }
        state = { incoming: [], conversions: [], losses: [], boxStarts: [], boxRemovals: [], distribution: [], suggestions: { purposes: [], workers: [], boxes: [], names: [] } };
    }
}

// --- Utilities ---
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
    if (btn) {
        if (isEdit) {
            btn.textContent = "Save Changes";
            btn.classList.add("edit-mode");
        } else {
            const defaultText = formId === 'inv-start-form' ? "Set Starting Weight" :
                                formId === 'inv-rem-form' ? "Log Removal" : "Save Entry";
            btn.textContent = defaultText;
            btn.classList.remove("edit-mode");
        }
    }
}

function addSuggestion(type, value) {
    if(!value) return;
    if(!state.suggestions[type].includes(value)) {
        state.suggestions[type].push(value);
    }
}

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
    }
    fillList('purposes-list', state.suggestions.purposes);
    fillList('workers-list', state.suggestions.workers);
    fillList('boxes-list', state.suggestions.boxes);
    fillList('names-list', state.suggestions.names);
}

// --- Navigation ---
function initNavigation() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const modules = document.querySelectorAll('.module');

    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            navBtns.forEach(b => b.classList.remove('active'));
            modules.forEach(m => m.classList.remove('active'));
            
            const targetId = btn.getAttribute('data-target');
            btn.classList.add('active');
            document.getElementById(targetId).classList.add('active');
            
            if(targetId === 'module-daily') updateDailySummary();
            if(targetId === 'module-inventory') renderInventoryModule();
        });
    });
}

// --- Bulk Action Logic ---
window.toggleEditMode = function(moduleKey) {
    const tableCard = document.getElementById(`tc-${moduleKey}`);
    if(!tableCard) return;
    if (tableCard.classList.contains('edit-mode-active')) {
        tableCard.classList.remove('edit-mode-active');
        selections[moduleKey].clear();
        const checkbox = document.getElementById(
            moduleKey === 'outgoing' ? 'out-select-all' : 
            moduleKey === 'invRem' ? 'invRem-select-all' : 
            `${moduleKey.substring(0,3)}-select-all`
        );
        if(checkbox) checkbox.checked = false;
        
        if (moduleKey === 'invRem') renderInventoryModule();
        else window[`render${capitalizeFirstLetter(moduleKey)}`]();
    } else {
        tableCard.classList.add('edit-mode-active');
    }
}

window.toggleSelectAll = function(moduleKey) {
    const checkbox = document.getElementById(
        moduleKey === 'outgoing' ? 'out-select-all' : 
        moduleKey === 'invRem' ? 'invRem-select-all' : 
        `${moduleKey.substring(0,3)}-select-all`
    );
    const isChecked = checkbox ? checkbox.checked : false;
    const renderedIndices = window[`${moduleKey}RenderedIndices`] || [];
    
    if (isChecked) {
        renderedIndices.forEach(idx => selections[moduleKey].add(idx));
    } else {
        renderedIndices.forEach(idx => selections[moduleKey].delete(idx));
    }
    
    if (moduleKey === 'invRem') renderInventoryModule();
    else window[`render${capitalizeFirstLetter(moduleKey)}`]();
}

window.toggleSelect = function(moduleKey, index) {
    if (selections[moduleKey].has(index)) {
        selections[moduleKey].delete(index);
    } else {
        selections[moduleKey].add(index);
    }
    
    const checkbox = document.getElementById(
        moduleKey === 'outgoing' ? 'out-select-all' : 
        moduleKey === 'invRem' ? 'invRem-select-all' : 
        `${moduleKey.substring(0,3)}-select-all`
    );
    const renderedIndices = window[`${moduleKey}RenderedIndices`] || [];
    
    if (checkbox && renderedIndices.length > 0 && renderedIndices.every(idx => selections[moduleKey].has(idx))) {
        checkbox.checked = true;
    } else if (checkbox) {
        checkbox.checked = false;
    }
}

window.bulkDelete = async function(moduleKey) {
    if (selections[moduleKey].size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selections[moduleKey].size} selected entries?`)) return;

    const indicesToDelete = Array.from(selections[moduleKey]).sort((a, b) => b - a);
    const stateArrayName = 
        moduleKey === 'outgoing' ? 'conversions' : 
        moduleKey === 'invRem' ? 'boxRemovals' : 
        moduleKey;
        
    const tableName = 
        moduleKey === 'outgoing' ? 'conversions' : 
        moduleKey === 'invRem' ? 'box_removals' : 
        moduleKey === 'loss' ? 'losses' : 
        moduleKey === 'distribution' ? 'distributions' :
        moduleKey;

    const idsToDelete = indicesToDelete.map(index => state[stateArrayName][index].id);

    try {
        const { error } = await supabase.from(tableName).delete().in('id', idsToDelete);
        if (error) throw error;
        
        indicesToDelete.forEach(index => {
            state[stateArrayName].splice(index, 1);
        });

        selections[moduleKey].clear();
        
        const selectAllCb = document.getElementById(
            moduleKey === 'outgoing' ? 'out-select-all' : 
            moduleKey === 'invRem' ? 'invRem-select-all' : 
            `${moduleKey.substring(0,3)}-select-all`
        );
        if(selectAllCb) selectAllCb.checked = false;

        if (moduleKey === 'invRem') renderInventoryModule();
        else window[`render${capitalizeFirstLetter(moduleKey)}` ]();
        
        updateDailySummary();
    } catch(e) {
        console.error("Bulk delete execution error:", e);
    }
}

// --- Module 0: Incoming Gold ---
window.renderIncoming = function() {
    const tbody = document.getElementById('incoming-tbody');
    if(!tbody) return;
    const filterWeight = document.getElementById('filter-inc-weight')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-inc-date')?.value || '';
    
    tbody.innerHTML = '';
    window.incomingRenderedIndices = [];

    state.incoming.forEach((entry, index) => {
        const wStr = entry.weight24.toFixed(4);
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
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-edit" onclick="editIncoming(${index})"><i class="ph ph-pencil-simple"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });
}

function initIncoming() {
    const form = document.getElementById('incoming-form');
    if(!form) return;
    const dateInput = document.getElementById('inc-date');
    const filterDate = document.getElementById('filter-inc-date');
    const editIdInput = document.getElementById('inc-edit-id');
    
    if(!dateInput.value) dateInput.value = getTodayFormatted();
    if(!filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const weight24 = parseFloat(document.getElementById('inc-weight').value);
        const date = document.getElementById('inc-date').value;
        const editId = parseInt(editIdInput.value);

        if (editId > -1) {
            const dbId = state.incoming[editId].id;
            const { data } = await supabase.from('incoming').update({ weight24, date }).eq('id', dbId).select();
            if(data) state.incoming[editId] = data;
            editIdInput.value = "-1";
            setEditMode('incoming-form', 'inc-submit-btn', false);
        } else {
            const { data } = await supabase.from('incoming').insert({ weight24, date, username: currentUser }).select();
            if(data) state.incoming.push(data);
        }

        renderIncoming();
        form.reset();
        dateInput.value = getTodayFormatted();
        updateDailySummary();
    });

    window.editIncoming = (index) => {
        const entry = state.incoming[index];
        document.getElementById('inc-weight').value = entry.weight24;
        document.getElementById('inc-date').value = entry.date;
        document.getElementById('inc-edit-id').value = index;
        setEditMode('incoming-form', 'inc-submit-btn', true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    renderIncoming();
}

// --- Module 1: Gold Used ---
window.renderOutgoing = function() {
    const tbody = document.getElementById('outgoing-tbody');
    if(!tbody) return;
    const filterPurpose = document.getElementById('filter-out-purpose')?.value.toLowerCase() || '';
    const filter24ct = document.getElementById('filter-out-24ct')?.value.toLowerCase() || '';
    const filter22ct = document.getElementById('filter-out-22ct')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-out-date')?.value || '';
    
    tbody.innerHTML = '';
    window.outgoingRenderedIndices = [];

    state.conversions.forEach((entry, index) => {
        const pStr = entry.purpose.toLowerCase();
        const w24Str = entry.weight24.toFixed(4);
        const w22Str = entry.weight22 > 0 ? entry.weight22.toFixed(4) : '-';
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
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-edit" onclick="editOutgoing(${index})"><i class="ph ph-pencil-simple"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });
}

function initOutgoing() {
    const form = document.getElementById('outgoing-form');
    if(!form) return;
    const dateInput = document.getElementById('conv-date');
    const filterDate = document.getElementById('filter-out-date');
    const editIdInput = document.getElementById('conv-edit-id');
    
    if(!dateInput.value) dateInput.value = getTodayFormatted();
    if(!filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const purpose = capitalizeFirstLetter(document.getElementById('conv-purpose').value);
        const weight24 = parseFloat(document.getElementById('conv-24ct').value);
        const date = document.getElementById('conv-date').value;
        const editId = parseInt(editIdInput.value);

        addSuggestion('purposes', purpose);

        let weight22 = 0;
        if (purpose.toLowerCase() === 'melt') {
            weight22 = weight24 * (100 / 92);
        }

        if (editId > -1) {
            const dbId = state.conversions[editId].id;
            const { data } = await supabase.from('conversions').update({ purpose, weight24, weight22, date }).eq('id', dbId).select();
            if(data) state.conversions[editId] = data;
            editIdInput.value = "-1";
            setEditMode('outgoing-form', 'conv-submit-btn', false);
        } else {
            const { data } = await supabase.from('conversions').insert({ purpose, weight24, weight22, date, username: currentUser }).select();
            if(data) state.conversions.push(data);
        }

        renderOutgoing();
        form.reset();
        dateInput.value = getTodayFormatted();
        updateDailySummary();
    });

    window.editOutgoing = (index) => {
        const entry = state.conversions[index];
        document.getElementById('conv-purpose').value = entry.purpose;
        document.getElementById('conv-24ct').value = entry.weight24;
        document.getElementById('conv-date').value = entry.date;
        document.getElementById('conv-edit-id').value = index;
        setEditMode('outgoing-form', 'conv-submit-btn', true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    renderOutgoing();
}

// --- Module 2: Worker Loss ---
window.renderLoss = function() {
    const tbody = document.getElementById('loss-tbody');
    if(!tbody) return;
    const filterWorker = document.getElementById('filter-loss-worker')?.value.toLowerCase() || '';
    const filterAmount = document.getElementById('filter-loss-amount')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-loss-date')?.value || '';
    const totalEl = document.getElementById('total-loss');
    
    tbody.innerHTML = '';
    window.lossRenderedIndices = [];
    let total = 0;

    state.losses.forEach((entry, index) => {
        const wStr = entry.worker.toLowerCase();
        const aStr = entry.amount.toFixed(2);
        const dStr = entry.date;

        if (wStr.includes(filterWorker) && aStr.includes(filterAmount) && dStr.includes(filterDate)) {
            window.lossRenderedIndices.push(index);
            total += entry.amount;
            const isChecked = selections.loss.has(index) ? 'checked' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('loss', ${index})" ${isChecked}></td>
                <td>${entry.worker}</td>
                <td>${aStr}</td>
                <td>${dStr}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-edit" onclick="editLoss(${index})"><i class="ph ph-pencil-simple"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });
    if(totalEl) totalEl.textContent = total.toFixed(2);
}

function initLoss() {
    const form = document.getElementById('loss-form');
    if(!form) return;
    const dateInput = document.getElementById('loss-date');
    const filterDate = document.getElementById('filter-loss-date');
    const editIdInput = document.getElementById('loss-edit-id');
    
    if(!dateInput.value) dateInput.value = getTodayFormatted();
    if(!filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const worker = capitalizeFirstLetter(document.getElementById('loss-worker').value);
        const amount = parseFloat(document.getElementById('loss-amount').value);
        const date = document.getElementById('loss-date').value;
        const editId = parseInt(editIdInput.value);

        addSuggestion('workers', worker);

        if (editId > -1) {
            const dbId = state.losses[editId].id;
            const { data } = await supabase.from('losses').update({ worker, amount, date }).eq('id', dbId).select();
            if(data) state.losses[editId] = data;
            editIdInput.value = "-1";
            setEditMode('loss-form', 'loss-submit-btn', false);
        } else {
            const { data } = await supabase.from('losses').insert({ worker, amount, date, username: currentUser }).select();
            if(data) state.losses.push(data);
        }

        renderLoss();
        form.reset();
        dateInput.value = getTodayFormatted();
        updateDailySummary();
    });

    window.editLoss = (index) => {
        const entry = state.losses[index];
        document.getElementById('loss-worker').value = entry.worker;
        document.getElementById('loss-amount').value = entry.amount;
        document.getElementById('loss-date').value = entry.date;
        document.getElementById('loss-edit-id').value = index;
        setEditMode('loss-form', 'loss-submit-btn', true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    renderLoss();
}

// --- Module 3: Box Inventory ---
function getAllBoxes() {
    const boxes = new Set();
    state.boxStarts.forEach(s => boxes.add(s.box));
    state.boxRemovals.forEach(r => boxes.add(r.box));
    state.suggestions.boxes.forEach(b => boxes.add(b));
    return Array.from(boxes).sort();
}

function getCalculatedStartWeights(targetDate) {
    const result = {};
    const boxes = getAllBoxes();
    
    boxes.forEach(box => {
        const starts = state.boxStarts.filter(s => s.box === box && s.date <= targetDate);
        if (starts.length === 0) {
            result[box] = { weight: 0, isOverride: false };
            return;
        }
        
        starts.sort((a, b) => b.date.localeCompare(a.date));
        const latestStart = starts;
        
        const startDate = latestStart.date;
        const startWeight = latestStart.weight;
        
        const removals = state.boxRemovals
            .filter(r => r.box === box && r.date >= startDate && r.date < targetDate)
            .reduce((sum, r) => sum + r.weight, 0);
            
        result[box] = {
            weight: Math.max(0, startWeight - removals),
            isOverride: startDate === targetDate
        };
    });
    
    return result;
}

window.deleteStartOverride = async function(box, date) {
    if (!confirm(`Are you sure you want to delete the manual starting weight override for ${box} on ${date}?`)) return;
    
    const index = state.boxStarts.findIndex(s => s.box === box && s.date === date);
    if (index > -1) {
        const dbId = state.boxStarts[index].id;
        await supabase.from('box_starts').delete().eq('id', dbId);
        state.boxStarts.splice(index, 1);
        renderInventoryModule();
        updateDailySummary();
    }
}

window.editRemoval = function(index) {
    const entry = state.boxRemovals[index];
    document.getElementById('inv-rem-box').value = entry.box;
    document.getElementById('inv-rem-weight').value = entry.weight;
    document.getElementById('inv-rem-edit-id').value = index;
    setEditMode('inv-rem-form', 'inv-rem-submit-btn', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.renderInventoryModule = function() {
    const masterDate = document.getElementById('master-inv-date').value || getTodayFormatted();
    
    // RENDER STARTING WEIGHTS
    const startTbody = document.getElementById('inv-start-tbody');
    if(startTbody) {
        const filterStartBox = document.getElementById('filter-inv-start-box')?.value.toLowerCase() || '';
        startTbody.innerHTML = '';
        const startWeights = getCalculatedStartWeights(masterDate);
        
        Object.entries(startWeights).forEach(([box, data]) => {
            if (box.toLowerCase().includes(filterStartBox)) {
                const tr = document.createElement('tr');
                let statusHtml = data.isOverride ? `
                    <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--accent-color); border: 1px solid rgba(212, 175, 55, 0.4);">Manual</span>
                    <button class="btn-icon btn-delete" onclick="deleteStartOverride('${box}', '${masterDate}')" title="Delete Manual Override">
                        <i class="ph ph-trash"></i>
                    </button>
                ` : `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid rgba(255, 255, 255, 0.1);">Calculated</span>`;
                
                tr.innerHTML = `<td>${box}</td><td>${data.weight.toFixed(2)}</td><td><div style="display: flex; align-items: center; gap: 8px;">${statusHtml}</div></td>`;
                startTbody.appendChild(tr);
            }
        });
    }
    
    // RENDER REMOVED WEIGHTS
    const remTbody = document.getElementById('inv-rem-tbody');
    if(remTbody) {
        const filterRemBox = document.getElementById('filter-inv-rem-box')?.value.toLowerCase() || '';
        const totalRemEl = document.getElementById('total-inv-rem');
        
        remTbody.innerHTML = '';
        window.invRemRenderedIndices = [];
        let totalRem = 0;
        
        state.boxRemovals.forEach((entry, index) => {
            if (entry.date === masterDate) {
                const bStr = entry.box.toLowerCase();
                if (bStr.includes(filterRemBox)) {
                    window.invRemRenderedIndices.push(index);
                    totalRem += entry.weight;
                    const isChecked = selections.invRem.has(index) ? 'checked' : '';
                    
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('invRem', ${index})" ${isChecked}></td>
                        <td>${entry.box}</td>
                        <td>${entry.weight.toFixed(2)}</td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn-icon btn-edit" onclick="editRemoval(${index})"><i class="ph ph-pencil-simple"></i></button>
                            </div>
                        </td>
                    `;
                    remTbody.appendChild(tr);
                }
            }
        });
        if (totalRemEl) totalRemEl.textContent = totalRem.toFixed(2);
    }
}

function initInventory() {
    const masterDateInput = document.getElementById('master-inv-date');
    if (masterDateInput && !masterDateInput.value) masterDateInput.value = getTodayFormatted();
    
    const startForm = document.getElementById('inv-start-form');
    if(startForm) {
        startForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const box = capitalizeFirstLetter(document.getElementById('inv-start-box').value);
            const weight = parseFloat(document.getElementById('inv-start-weight').value);
            const date = masterDateInput.value;
            const editId = parseInt(document.getElementById('inv-start-edit-id').value);

            addSuggestion('boxes', box);

            if (editId > -1) {
                const dbId = state.boxStarts[editId].id;
                const { data } = await supabase.from('box_starts').update({ box, weight, date }).eq('id', dbId).select();
                if(data) state.boxStarts[editId] = data;
                document.getElementById('inv-start-edit-id').value = "-1";
                setEditMode('inv-start-form', 'inv-start-submit-btn', false);
            } else {
                const existingIndex = state.boxStarts.findIndex(s => s.box === box && s.date === date);
                if (existingIndex > -1) {
                    const newWeight = state.boxStarts[existingIndex].weight + weight;
                    const dbId = state.boxStarts[existingIndex].id;
                    const { data } = await supabase.from('box_starts').update({ weight: newWeight }).eq('id', dbId).select();
                    if(data) state.boxStarts[existingIndex] = data;
                } else {
                    const { data } = await supabase.from('box_starts').insert({ box, weight, date, username: currentUser }).select();
                    if(data) state.boxStarts.push(data);
                }
            }
            renderInventoryModule();
            startForm.reset();
            updateDailySummary();
        });
    }

    const remForm = document.getElementById('inv-rem-form');
    if(remForm) {
        remForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const box = capitalizeFirstLetter(document.getElementById('inv-rem-box').value);
            const weight = parseFloat(document.getElementById('inv-rem-weight').value);
            const date = masterDateInput.value;
            const editId = parseInt(document.getElementById('inv-rem-edit-id').value);

            addSuggestion('boxes', box);

            if (editId > -1) {
                const dbId = state.boxRemovals[editId].id;
                const { data } = await supabase.from('box_removals').update({ box, weight, date }).eq('id', dbId).select();
                if(data) state.boxRemovals[editId] = data;
                document.getElementById('inv-rem-edit-id').value = "-1";
                setEditMode('inv-rem-form', 'inv-rem-submit-btn', false);
            } else {
                const { data } = await supabase.from('box_removals').insert({ box, weight, date, username: currentUser }).select();
                if(data) state.boxRemovals.push(data);
            }
            renderInventoryModule();
            remForm.reset();
            updateDailySummary();
        });
    }
    renderInventoryModule();
}

// --- Module 4: Gold Distribution ---
window.renderDistribution = function() {
    const tbody = document.getElementById('dist-tbody');
    if(!tbody) return;
    const filterName = document.getElementById('filter-dist-name')?.value.toLowerCase() || '';
    const filterWeight = document.getElementById('filter-dist-weight')?.value.toLowerCase() || '';
    const filterDate = document.getElementById('filter-dist-date')?.value || '';
    const totalEl = document.getElementById('total-distribution');
    
    tbody.innerHTML = '';
    window.distributionRenderedIndices = [];
    let total = 0;

    state.distribution.forEach((entry, index) => {
        const nStr = entry.name.toLowerCase();
        const wStr = entry.weight.toFixed(2);
        const dStr = entry.date;

        if (nStr.includes(filterName) && wStr.includes(filterWeight) && dStr.includes(filterDate)) {
            window.distributionRenderedIndices.push(index);
            total += entry.weight;
            const isChecked = selections.distribution.has(index) ? 'checked' : '';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="col-checkbox"><input type="checkbox" class="row-checkbox" onclick="toggleSelect('distribution', ${index})" ${isChecked}></td>
                <td>${entry.name}</td>
                <td>${wStr}</td>
                <td>${dStr}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon btn-edit" onclick="editDistribution(${index})"><i class="ph ph-pencil-simple"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });
    if(totalEl) totalEl.textContent = total.toFixed(2);
}

function initDistribution() {
    const form = document.getElementById('dist-form');
    if(!form) return;
    const dateInput = document.getElementById('dist-date');
    const filterDate = document.getElementById('filter-dist-date');
    const editIdInput = document.getElementById('dist-edit-id');

    if(!dateInput.value) dateInput.value = getTodayFormatted();
    if(!filterDate.value) filterDate.value = getTodayFormatted();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = capitalizeFirstLetter(document.getElementById('dist-name').value);
        const weight = parseFloat(document.getElementById('dist-weight').value);
        const date = document.getElementById('dist-date').value;
        const editId = parseInt(editIdInput.value);

        addSuggestion('names', name);

        if (editId > -1) {
            const dbId = state.distribution[editId].id;
            const { data } = await supabase.from('distributions').update({ name, weight, date }).eq('id', dbId).select();
            if(data) state.distribution[editId] = data;
            editIdInput.value = "-1";
            setEditMode('dist-form', 'dist-submit-btn', false);
        } else {
            const { data } = await supabase.from('distributions').insert({ name, weight, date, username: currentUser }).select();
            if(data) state.distribution.push(data);
        }

        renderDistribution();
        form.reset();
        dateInput.value = getTodayFormatted();
        updateDailySummary();
    });

    window.editDistribution = (index) => {
        const entry = state.distribution[index];
        document.getElementById('dist-name').value = entry.name;
        document.getElementById('dist-weight').value = entry.weight;
        document.getElementById('dist-date').value = entry.date;
        document.getElementById('dist-edit-id').value = index;
        setEditMode('dist-form', 'dist-submit-btn', true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    renderDistribution();
}

// --- Module 5: Daily Summary ---
function initDailySummary() {
    const dateInput = document.getElementById('summary-date');
    if(dateInput) {
        if(!dateInput.value) dateInput.value = getTodayFormatted();
        dateInput.addEventListener('change', updateDailySummary);
    }
    updateDailySummary();
}

function updateDailySummary() {
    const dateInput = document.getElementById('summary-date');
    if(!dateInput) return;
    const selectedDate = dateInput.value;
    
    const d22 = document.getElementById('display-summary-date-22');
    const d24 = document.getElementById('display-summary-date-24');
    if(d22) d22.textContent = selectedDate || '...';
    if(d24) d24.textContent = selectedDate || '...';

    if(!selectedDate) return;

    const sum22ct = state.conversions.filter(c => c.date === selectedDate).reduce((sum, c) => sum + c.weight22, 0);
    const sumLoss = state.losses.filter(l => l.date === selectedDate).reduce((sum, l) => sum + l.amount, 0);
    const sumDist = state.distribution.filter(d => d.date === selectedDate).reduce((sum, d) => sum + d.weight, 0);

    let sumBox = 0;
    const startWeights = getCalculatedStartWeights(selectedDate);
    Object.entries(startWeights).forEach(([box, data]) => {
        const removalsOnDate = state.boxRemovals
            .filter(r => r.box === box && r.date === selectedDate)
            .reduce((sum, r) => sum + r.weight, 0);
        sumBox += Math.max(0, data.weight - removalsOnDate);
    });

    if(document.getElementById('sum-22ct')) document.getElementById('sum-22ct').textContent = sum22ct.toFixed(4);
    if(document.getElementById('sum-loss')) document.getElementById('sum-loss').textContent = "- " + sumLoss.toFixed(4);
    if(document.getElementById('sum-box')) document.getElementById('sum-box').textContent = "+ " + sumBox.toFixed(4);
    if(document.getElementById('sum-dist')) document.getElementById('sum-dist').textContent = "- " + sumDist.toFixed(4);

    const finalTotal22 = sum22ct - sumLoss + sumBox - sumDist;
    const finalTotalEl = document.getElementById('final-total');
    if(finalTotalEl) {
        finalTotalEl.innerHTML = `${finalTotal22.toFixed(4)} <span class="unit">grams</span>`;
        finalTotalEl.style.color = finalTotal22 < 0 ? 'var(--danger)' : 'var(--accent-color)';
    }

    const sumIncoming24 = state.incoming.filter(inc => inc.date === selectedDate).reduce((sum, inc) => sum + inc.weight24, 0);
    const sumOutgoing24 = state.conversions.filter(out => out.date === selectedDate).reduce((sum, out) => sum + out.weight24, 0);

    const finalTotal24 = sumIncoming24 - sumOutgoing24;
    const finalTotal24El = document.getElementById('final-total-24');
    if(finalTotal24El) {
        finalTotal24El.innerHTML = `${finalTotal24.toFixed(4)} <span class="unit">grams</span>`;
        finalTotal24El.style.color = finalTotal24 < 0 ? 'var(--danger)' : 'var(--text-primary)';
    }
}

// --- App Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    populateDatalists();
    initNavigation();
    initIncoming();
    initOutgoing();
    initLoss();
    initInventory();
    initDistribution();
    initDailySummary();
});
