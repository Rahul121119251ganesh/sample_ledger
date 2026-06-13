const supabase2_URL = 'https://iojcfzxwafdbnhxfgffe.supabase.co';
const supabase2_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlvamNmenh3YWZkYm5oeGZnZmZlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyNzYyOTcsImV4cCI6MjA5NDg1MjI5N30.2Ao6_cxFev400bf8MB8831zUdcihsKIwdhw_ezFPFlE';
const supabase2 = window.supabase.createClient(supabase2_URL, supabase2_ANON_KEY);
let currentUser = null;      // Stores the logged-in Supabase Auth UUID
let currentUserEmail = null; // Stores display email/name

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
            supabase2.from('incoming').select('*'),
            supabase2.from('conversions').select('*'),
            supabase2.from('losses').select('*'),
            supabase2.from('box_starts').select('*'),
            supabase2.from('box_removals').select('*'),
            supabase2.from('distributions').select('*') // Handled table name synchronization
        ]);
        
        const errors = [];
        if (inc.error) errors.push(`Incoming: ${inc.error.message} (Code: ${inc.error.code})`);
        if (conv.error) errors.push(`Conversions: ${conv.error.message} (Code: ${conv.error.code})`);
        if (loss.error) errors.push(`Losses: ${loss.error.message} (Code: ${loss.error.code})`);
        if (bStarts.error) errors.push(`Box Starts: ${bStarts.error.message} (Code: ${bStarts.error.code})`);
        if (bRems.error) errors.push(`Box Removals: ${bRems.error.message} (Code: ${bRems.error.code})`);
        if (dist.error) errors.push(`Distributions: ${dist.error.message} (Code: ${dist.error.code})`);

        if (errors.length > 0) {
            console.error("Supabase load errors:", errors);
            alert("Database Error loading some tables:\n\n" + errors.join("\n\n") + "\n\nPlease check if your Supabase tables match the schema and policies, or contact support.");
        }

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
        console.error("Error loading state from supabase2", e);
        alert("Critical error loading state: " + e.message);
    }
}

// --- Authentication (Supabase Auth) ---
async function initAuth() {
    // Restore session from Supabase on page load
    const { data: { session } } = await supabase2.auth.getSession();
    handleAuthChange(session);

    // Listen for auth state changes (login / logout)
    supabase2.auth.onAuthStateChange((_event, session) => {
        handleAuthChange(session);
    });

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailInput = document.getElementById('login-username')?.value.trim();
            const passwordInput = document.getElementById('login-password')?.value;
            const errDiv = document.getElementById('login-error');
            const submitBtn = document.getElementById('btn-login-submit');

            if (!emailInput || !passwordInput) {
                if (errDiv) {
                    errDiv.textContent = 'Please enter both email and password.';
                    errDiv.style.display = 'block';
                }
                return;
            }

            if (errDiv) errDiv.style.display = 'none';
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Signing in...'; }

            const { data, error } = await supabase2.auth.signInWithPassword({
                email: emailInput,
                password: passwordInput
            });

            if (error || !data?.user) {
                if (errDiv) {
                    errDiv.textContent = error?.message || 'Invalid email or password.';
                    errDiv.style.display = 'block';
                }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Login'; }
            } else {
                if (loginForm) loginForm.reset();
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Login'; }
                // onAuthStateChange will fire and call handleAuthChange automatically
            }
        });
    }

    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            await supabase2.auth.signOut();
            // onAuthStateChange will fire and call handleAuthChange automatically
        });
    }
}

async function handleAuthChange(session) {
    // Store the user's UUID (used for RLS) and email (for display)
    currentUser = session?.user?.id || null;
    currentUserEmail = session?.user?.email || null;

    const sidebar = document.getElementById('app-sidebar');
    const mainContent = document.getElementById('app-main-content');
    const loginModule = document.getElementById('module-login');

    const activeUserEl = document.getElementById('active-username');
    if (activeUserEl) {
        activeUserEl.textContent = currentUserEmail || 'Guest';
    }

    const defaultModule = document.getElementById('module-incoming') || document.querySelector('.module:not(#module-login)');
    const allModules = document.querySelectorAll('.module');

    if (currentUser) {
        if (sidebar) sidebar.style.display = 'flex';
        if (mainContent) mainContent.style.display = 'block';

        allModules.forEach(m => m.classList.remove('active'));
        if (loginModule) {
            loginModule.style.display = 'none';
            loginModule.classList.remove('active');
        }

        if (defaultModule) defaultModule.classList.add('active');

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const defaultNavBtn = document.querySelector('[data-target="module-incoming"]');
        if (defaultNavBtn) defaultNavBtn.classList.add('active');

        await loadStateFromCloud();
    } else {
        if (sidebar) sidebar.style.display = 'none';
        if (mainContent) mainContent.style.display = 'block';

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
            const defaultText = formId === 'inv-start-form' ? "Set Day Starting Weight" :
                                formId === 'inv-rem-form' ? "Log Day Ending Weight" : "Save Entry";
            btn.textContent = defaultText;
            btn.classList.remove("edit-mode");
        }
    }
}

function addSuggestion(type, value) {
    if(!value) return;
    if(!state.suggestions[type].includes(value)) {
        state.suggestions[type].push(value);
        populateDatalists();
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
function getSelectAllCheckboxId(moduleKey) {
    if (moduleKey === 'outgoing') return 'out-select-all';
    if (moduleKey === 'invRem') return 'invRem-select-all';
    if (moduleKey === 'loss') return 'loss-select-all';
    if (moduleKey === 'distribution') return 'dist-select-all';
    if (moduleKey === 'incoming') return 'inc-select-all';
    return `${moduleKey}-select-all`;
}

window.toggleEditMode = function(moduleKey) {
    const tableCardId = moduleKey === 'invRem' ? 'tc-inv-rem' : `tc-${moduleKey}`;
    const tableCard = document.getElementById(tableCardId);
    if(!tableCard) return;
    if (tableCard.classList.contains('edit-mode-active')) {
        tableCard.classList.remove('edit-mode-active');
        selections[moduleKey].clear();
        const checkbox = document.getElementById(getSelectAllCheckboxId(moduleKey));
        if(checkbox) checkbox.checked = false;
        
        if (moduleKey === 'invRem') renderInventoryModule();
        else window[`render${capitalizeFirstLetter(moduleKey)}`]();
    } else {
        tableCard.classList.add('edit-mode-active');
    }
}

window.toggleSelectAll = function(moduleKey) {
    const checkbox = document.getElementById(getSelectAllCheckboxId(moduleKey));
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
    
    const checkbox = document.getElementById(getSelectAllCheckboxId(moduleKey));
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
        moduleKey === 'loss' ? 'losses' : 
        moduleKey;
        
    const tableName = 
        moduleKey === 'outgoing' ? 'conversions' : 
        moduleKey === 'invRem' ? 'box_removals' : 
        moduleKey === 'loss' ? 'losses' : 
        moduleKey === 'distribution' ? 'distributions' :
        moduleKey;

    const idsToDelete = indicesToDelete.map(index => state[stateArrayName][index].id);

    try {
        const { error } = await supabase2.from(tableName).delete().in('id', idsToDelete);
        if (error) throw error;
        
        indicesToDelete.forEach(index => {
            state[stateArrayName].splice(index, 1);
        });

        selections[moduleKey].clear();
        
        const selectAllCb = document.getElementById(getSelectAllCheckboxId(moduleKey));
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
            const { data, error } = await supabase2.from('incoming').update({ weight24, date }).eq('id', dbId).select();
            if (error) {
                console.error("Error updating incoming entry:", error);
                alert("Error updating entry: " + error.message);
            } else if (data && data.length > 0) {
                state.incoming[editId] = data[0];
                editIdInput.value = "-1";
                setEditMode('incoming-form', 'inc-submit-btn', false);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Update failed: No data was returned. Make sure the record still exists and you have permissions.");
            }
        } else {
            const { data, error } = await supabase2.from('incoming').insert({ weight24, date, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
            if (error) {
                console.error("Error inserting incoming entry:", error);
                alert("Error adding entry: " + error.message);
            } else if (data && data.length > 0) {
                state.incoming.push(data[0]);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Add failed: No data was returned.");
            }
        }

        renderIncoming();
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
            const { data, error } = await supabase2.from('conversions').update({ purpose, weight24, weight22, date }).eq('id', dbId).select();
            if (error) {
                console.error("Error updating outgoing entry:", error);
                alert("Error updating entry: " + error.message);
            } else if (data && data.length > 0) {
                state.conversions[editId] = data[0];
                editIdInput.value = "-1";
                setEditMode('outgoing-form', 'conv-submit-btn', false);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Update failed: No data was returned.");
            }
        } else {
            const { data, error } = await supabase2.from('conversions').insert({ purpose, weight24, weight22, date, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
            if (error) {
                console.error("Error inserting outgoing entry:", error);
                alert("Error adding entry: " + error.message);
            } else if (data && data.length > 0) {
                state.conversions.push(data[0]);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Add failed: No data was returned.");
            }
        }

        renderOutgoing();
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
            const { data, error } = await supabase2.from('losses').update({ worker, amount, date }).eq('id', dbId).select();
            if (error) {
                console.error("Error updating loss entry:", error);
                alert("Error updating entry: " + error.message);
            } else if (data && data.length > 0) {
                state.losses[editId] = data[0];
                editIdInput.value = "-1";
                setEditMode('loss-form', 'loss-submit-btn', false);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Update failed: No data was returned.");
            }
        } else {
            const { data, error } = await supabase2.from('losses').insert({ worker, amount, date, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
            if (error) {
                console.error("Error inserting loss entry:", error);
                alert("Error adding entry: " + error.message);
            } else if (data && data.length > 0) {
                state.losses.push(data[0]);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Add failed: No data was returned.");
            }
        }

        renderLoss();
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
    
    // Find all starts on this exact date
    state.boxStarts.forEach(s => {
        if (s.date === targetDate) {
            result[s.box] = { weight: s.weight, isOverride: true };
        }
    });
    
    // Also include any suggested/removals boxes that don't have starting weights yet
    const boxes = getAllBoxes();
    boxes.forEach(box => {
        if (!result[box]) {
            result[box] = { weight: 0, isOverride: false };
        }
    });
    
    return result;
}

window.deleteStartOverride = async function(box, date) {
    if (!confirm(`Are you sure you want to delete the manual starting weight override for ${box} on ${date}?`)) return;
    
    const index = state.boxStarts.findIndex(s => s.box === box && s.date === date);
    if (index > -1) {
        const dbId = state.boxStarts[index].id;
        await supabase2.from('box_starts').delete().eq('id', dbId);
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

window.forwardDataToNextDay = async function() {
    const masterDateInput = document.getElementById('master-inv-date');
    if (!masterDateInput) return;
    const currentDate = masterDateInput.value;
    if (!currentDate) {
        alert("Please select a valid date first.");
        return;
    }

    const rems = state.boxRemovals.filter(r => r.date === currentDate);
    if (rems.length === 0) {
        alert(`No Day Ending weights recorded for ${currentDate}. Nothing to forward.`);
        return;
    }

    if (!confirm(`Are you sure you want to forward ${rems.length} Day Ending weights from ${currentDate} to the next day as Day Starting weights?`)) {
        return;
    }

    const parts = currentDate.split('-');
    const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
    dateObj.setDate(dateObj.getDate() + 1);
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const nextDate = `${yyyy}-${mm}-${dd}`;

    try {
        const promises = rems.map(async (rem) => {
            const box = rem.box;
            const weight = rem.weight;
            const existingIndex = state.boxStarts.findIndex(s => s.box === box && s.date === nextDate);
            
            if (existingIndex > -1) {
                const dbId = state.boxStarts[existingIndex].id;
                const { data, error } = await supabase2.from('box_starts').update({ weight }).eq('id', dbId).select();
                if (error) throw error;
                if (data && data[0]) {
                    state.boxStarts[existingIndex] = data[0];
                }
            } else {
                const { data, error } = await supabase2.from('box_starts').insert({ box, weight, date: nextDate, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
                if (error) throw error;
                if (data && data[0]) {
                    state.boxStarts.push(data[0]);
                }
            }
        });

        await Promise.all(promises);
        alert(`Successfully forwarded ending weights to starting weights for ${nextDate}!`);
        
        // Refresh UI
        renderInventoryModule();
        updateDailySummary();
    } catch (e) {
        console.error("Error forwarding data to next day:", e);
        alert("Failed to forward data. Check console for details.");
    }
};

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
                    <span class="badge" style="background: rgba(212, 175, 55, 0.15); color: var(--accent-color); border: 1px solid rgba(212, 175, 55, 0.4);">Set</span>
                    <button class="btn-icon btn-delete" onclick="deleteStartOverride('${box}', '${masterDate}')" title="Delete Weight">
                        <i class="ph ph-trash"></i>
                    </button>
                ` : `<span class="badge" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); border: 1px solid rgba(255, 255, 255, 0.1);">Not Set</span>`;
                
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

    // RENDER DIFFERENCE TABLE
    const diffTbody = document.getElementById('inv-diff-tbody');
    const totalDiffEl = document.getElementById('total-inv-diff');
    if (diffTbody) {
        diffTbody.innerHTML = '';
        let totalDiff = 0;
        
        const startWeights = getCalculatedStartWeights(masterDate);
        Object.entries(startWeights).forEach(([box, data]) => {
            const endingRecord = state.boxRemovals.find(r => r.box === box && r.date === masterDate);
            if (endingRecord) {
                const starting = data.weight;
                const ending = endingRecord.weight;
                const diff = Math.max(0, starting - ending);
                totalDiff += diff;
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${box}</td>
                    <td>${starting.toFixed(2)}</td>
                    <td>${ending.toFixed(2)}</td>
                    <td style="font-weight: 600; color: var(--accent-color);">${diff.toFixed(2)}</td>
                `;
                diffTbody.appendChild(tr);
            }
        });
        if (totalDiffEl) totalDiffEl.textContent = totalDiff.toFixed(2);
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
                const { data, error } = await supabase2.from('box_starts').update({ box, weight, date }).eq('id', dbId).select();
                if (error) {
                    console.error("Error updating box start entry:", error);
                    alert("Error updating entry: " + error.message);
                } else if (data && data.length > 0) {
                    state.boxStarts[editId] = data[0];
                    document.getElementById('inv-start-edit-id').value = "-1";
                    setEditMode('inv-start-form', 'inv-start-submit-btn', false);
                    startForm.reset();
                } else {
                    alert("Update failed: No data was returned.");
                }
            } else {
                const existingIndex = state.boxStarts.findIndex(s => s.box === box && s.date === date);
                if (existingIndex > -1) {
                    const newWeight = state.boxStarts[existingIndex].weight + weight;
                    const dbId = state.boxStarts[existingIndex].id;
                    const { data, error } = await supabase2.from('box_starts').update({ weight: newWeight }).eq('id', dbId).select();
                    if (error) {
                        console.error("Error updating existing box start entry:", error);
                        alert("Error updating entry: " + error.message);
                    } else if (data && data.length > 0) {
                        state.boxStarts[existingIndex] = data[0];
                        startForm.reset();
                    } else {
                        alert("Update failed: No data was returned.");
                    }
                } else {
                    const { data, error } = await supabase2.from('box_starts').insert({ box, weight, date, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
                    if (error) {
                        console.error("Error inserting box start entry:", error);
                        alert("Error adding entry: " + error.message);
                    } else if (data && data.length > 0) {
                        state.boxStarts.push(data[0]);
                        startForm.reset();
                    } else {
                        alert("Add failed: No data was returned.");
                    }
                }
            }
            renderInventoryModule();
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
                const { data, error } = await supabase2.from('box_removals').update({ box, weight, date }).eq('id', dbId).select();
                if (error) {
                    console.error("Error updating box removal entry:", error);
                    alert("Error updating entry: " + error.message);
                } else if (data && data.length > 0) {
                    state.boxRemovals[editId] = data[0];
                    document.getElementById('inv-rem-edit-id').value = "-1";
                    setEditMode('inv-rem-form', 'inv-rem-submit-btn', false);
                    remForm.reset();
                } else {
                    alert("Update failed: No data was returned.");
                }
            } else {
                const { data, error } = await supabase2.from('box_removals').insert({ box, weight, date, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
                if (error) {
                    console.error("Error inserting box removal entry:", error);
                    alert("Error adding entry: " + error.message);
                } else if (data && data.length > 0) {
                    state.boxRemovals.push(data[0]);
                    remForm.reset();
                } else {
                    alert("Add failed: No data was returned.");
                }
            }
            renderInventoryModule();
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
            const { data, error } = await supabase2.from('distributions').update({ name, weight, date }).eq('id', dbId).select();
            if (error) {
                console.error("Error updating distribution entry:", error);
                alert("Error updating entry: " + error.message);
            } else if (data && data.length > 0) {
                state.distribution[editId] = data[0];
                editIdInput.value = "-1";
                setEditMode('dist-form', 'dist-submit-btn', false);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Update failed: No data was returned.");
            }
        } else {
            const { data, error } = await supabase2.from('distributions').insert({ name, weight, date, user_id: currentUser, username: currentUserEmail || currentUser || 'user' }).select();
            if (error) {
                console.error("Error inserting distribution entry:", error);
                alert("Error adding entry: " + error.message);
            } else if (data && data.length > 0) {
                state.distribution.push(data[0]);
                form.reset();
                dateInput.value = getTodayFormatted();
            } else {
                alert("Add failed: No data was returned.");
            }
        }

        renderDistribution();
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

    // Day Ending weights sum
    const sumBoxRemoved = state.boxRemovals
        .filter(r => r.date === selectedDate)
        .reduce((sum, r) => sum + r.weight, 0);

    // Calculate Day Starting weights sum
    const startWeights = getCalculatedStartWeights(selectedDate);
    const sumBoxStarting = Object.values(startWeights).reduce((sum, d) => sum + d.weight, 0);

    if(document.getElementById('sum-22ct')) document.getElementById('sum-22ct').textContent = sum22ct.toFixed(4);
    if(document.getElementById('sum-loss')) document.getElementById('sum-loss').textContent = "- " + sumLoss.toFixed(4);
    if(document.getElementById('sum-box')) document.getElementById('sum-box').textContent = "+ " + sumBoxStarting.toFixed(4);
    if(document.getElementById('sum-dist')) document.getElementById('sum-dist').textContent = "- " + sumDist.toFixed(4);

    const finalTotal22 = sum22ct - sumLoss + sumBoxStarting - sumDist;
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
