(function() {
    "use strict";

    // ============================================================
    // TEST DATA — REPLACE WITH YOUR REAL DATA LATER
    // ============================================================
    const FIXED_CATEGORIES = {
        cloth: ['Regular', 'Office', 'Night', 'While Going Out on Day and Night'],
        inner: ['Inner Wear']
    };

    const DRIVE_FOLDER_LINKS = {
        'Regular': 'https://drive.google.com/drive/folders/1REF_REGULAR_FOLDER_ID_REFERENCE',
        'Office': 'https://drive.google.com/drive/folders/1REF_OFFICE_FOLDER_ID_REFERENCE',
        'Night': 'https://drive.google.com/drive/folders/1REF_NIGHT_FOLDER_ID_REFERENCE',
        'While Going Out on Day and Night': 'https://drive.google.com/drive/folders/1REF_OUTING_FOLDER_ID_REFERENCE',
        'Inner Wear': 'https://drive.google.com/drive/folders/1REF_INNER_FOLDER_ID_REFERENCE'
    };

    const TEST_ITEMS = [
        { name: 'Regular 1',  category: 'Regular', folder: 'cloth', link: 'https://drive.google.com/file/d/1hCgSf99Xoyu0s5M3D96YKFQttQAQzQlx/view?usp=drive_link' },
        { name: 'Office 1',   category: 'Office', folder: 'cloth', link: 'https://drive.google.com/file/d/1Y6Iso7-Noa_h9tFzjS1vUJJhDUhjSg0E/view?usp=drive_link' },
        { name: 'Inner 1',    category: 'Inner Wear', folder: 'inner', link: 'https://drive.google.com/file/d/1X5aKXRcKZZLNVg_A-iEQvHBMhOvSQwDf/view?usp=drive_link' },
        { name: 'Night 1',    category: 'Night', folder: 'cloth', link: 'https://drive.google.com/file/d/1C8Jz4j6SpEL5-GdHBzYGB0MmDLvHItAh/view?usp=drive_link' },
        { name: 'Outing 1',   category: 'While Going Out on Day and Night', folder: 'cloth', link: 'https://drive.google.com/file/d/1-dpTTFoeN9poefeG7d0TL7MTxufPbkz6/view?usp=drive_link' }
    ];

    // ============================================================
    // SUPABASE CONFIG (loaded from js/config.js — edit it there)
    // ============================================================
    // NOTE: read the values LAZINESS at call time (see cloudCfg()) — js/config.js is
    // loaded with "defer", so at this point in the script window.OUTFIT_CONFIG may not
    // exist yet. Reading it once here used to permanently disable cloud sync.
    function cleanUrl(u) {
        if (!u) return '';
        return String(u).trim().replace(/\/+$/, '');
    }
    function cloudCfg() {
        const cfg = window.OUTFIT_CONFIG || {};
        const url = cleanUrl(cfg.SUPABASE_URL);
        const key = (cfg.SUPABASE_ANON_KEY || '').trim();
        const ok = !!url && url.indexOf('YOUR_SUPABASE') === -1 && /^https:\/\/.+\.supabase\.co$/.test(url) && !!key;
        return { url, key, ok };
    }

    const TABLE_ITEMS   = 'outfit_items';
    const TABLE_HISTORY = 'outfit_history';
    const TABLE_PICKED  = 'outfit_picked';

    let supabaseClient = null;
    // The Supabase CDN script now loads with "async" (so it never blocks page render).
    // We create the client as soon as it arrives — the UI is already up by then.
    function tryCreateSupabaseClient() {
        if (supabaseClient) return supabaseClient;
        const c = cloudCfg();
        if (!c.ok) return null;
        if (!window.supabase) return null;
        try {
            supabaseClient = window.supabase.createClient(c.url, c.key);
            console.log('☁️ Supabase client ready for', c.url);
        } catch (e) {
            console.error('Supabase init failed:', e);
        }
        return supabaseClient;
    }
    // config.js + app.js are both deferred and run right before the async CDN script
    // finishes, so we wait for __supabaseReady instead of calling this immediately.
    if (window.__supabaseReady) {
        window.__supabaseReady.then(tryCreateSupabaseClient).catch(() => {});
    } else {
        tryCreateSupabaseClient();
    }

    // Safety net: a hanging cloud call must never freeze the app ("getting stuck").
    const CLOUD_TIMEOUT_MS = 12000;
    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('cloud timeout')), ms))
        ]);
    }

    // Always obtain the client *before* touching the cloud. The Supabase CDN script
    // loads async, so supabaseClient can legitimately be null for the first second or
    // two after page load — previously that made sync silently do nothing.
    async function ensureClient(waitMs) {
        if (supabaseClient) return supabaseClient;
        tryCreateSupabaseClient();
        if (supabaseClient) return supabaseClient;
        if (!window.__supabaseReady) return null;
        try { await withTimeout(window.__supabaseReady, waitMs || 8000); } catch (e) { /* CDN slow/offline */ }
        return tryCreateSupabaseClient();
    }

    const PASSWORD = "Deepnectar@1612@";
    let deleteMode = false;

    let ALL_ITEMS = [];
    let history = [];
    let picked = [];
    let selectedForDelete = new Set();
    let currentFolder = 'cloth';
    let pendingCloth = null;
    let pendingInner = null;
    let currentlyDisplayedEntry = null;

    const LS_SAVED_RECIPIENTS = 'outfitPicker_savedRecipients';
    const LS_LAST_USED_NUMBER = 'outfitPicker_lastUsedNumber';
    let savedRecipients = [];
    let selectedRecipient = null;
    let lastUsedNumber = '';

    // DOM
    const itemGrid = document.getElementById('itemList');
    const popupDisplay = document.getElementById('popupDisplay');
    const refreshBtn = document.getElementById('refreshBtn');
    const resetBtn = document.getElementById('resetBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const emailBtn = document.getElementById('emailBtn');
    const whatsappBtn = document.getElementById('whatsappBtn');
    const deleteModeBtn = document.getElementById('deleteModeBtn');
    const statusBadge = document.getElementById('statusBadge');
    const statusCounter = document.getElementById('statusCounter');
    const syncBadge = document.getElementById('syncBadge');
    const remainingCount = document.getElementById('remainingCount');
    const historyCount = document.getElementById('historyCount');
    const lastSyncInfo = document.getElementById('lastSyncInfo');
    const resetNotice = document.getElementById('resetNotice');
    const newItemInput = document.getElementById('newItemInput');
    const newCategoryInput = document.getElementById('newCategoryInput');
    const newItemLink = document.getElementById('newItemLink');
    const addItemBtn = document.getElementById('addItemBtn');
    const historyList = document.getElementById('historyList');
    const toast = document.getElementById('toast');
    const categorySelect = document.getElementById('categorySelect');
    const categoryCount = document.getElementById('categoryCount');
    const selectAllContainer = document.getElementById('selectAllContainer');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const selectedCount = document.getElementById('selectedCount');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const syncBtn = document.getElementById('syncBtn');
    const deleteIndicator = document.getElementById('deleteIndicator');
    const tabCloth = document.getElementById('tabCloth');
    const tabInner = document.getElementById('tabInner');
    const openDriveFolderBtn = document.getElementById('openDriveFolderBtn');

    const manualAddBtn = document.getElementById('manualAddBtn');
    const manualAddModal = document.getElementById('manualAddModal');
    const manualItemName = document.getElementById('manualItemName');
    const manualCategory = document.getElementById('manualCategory');
    const manualInnerName = document.getElementById('manualInnerName');
    const manualWearer = document.getElementById('manualWearer');
    const manualAddConfirm = document.getElementById('manualAddConfirm');
    const manualAddCancel = document.getElementById('manualAddCancel');
    const manualAddError = document.getElementById('manualAddError');
    const manualDateSelect = document.getElementById('manualDateSelect');
    const manualCustomDateRow = document.getElementById('manualCustomDateRow');
    const manualCustomDateInput = document.getElementById('manualCustomDateInput');
    const manualCustomDatePreview = document.getElementById('manualCustomDatePreview');

    const categoryModal = document.getElementById('categoryModal');
    const categoryModalSelect = document.getElementById('categoryModalSelect');
    const categoryModalCount = document.getElementById('categoryModalCount');
    const categoryModalConfirm = document.getElementById('categoryModalConfirm');
    const categoryModalCancel = document.getElementById('categoryModalCancel');

    const customDateRow = document.getElementById('customDateRow');
    const customDateInput = document.getElementById('customDateInput');
    const customDatePreview = document.getElementById('customDatePreview');

    const photoPopup = document.getElementById('photoPopup');
    const photoPopupTitle = document.getElementById('photoPopupTitle');
    const photoPopupImg = document.getElementById('photoPopupImg');
    const photoPopupCat = document.getElementById('photoPopupCat');
    const photoPopupDate = document.getElementById('photoPopupDate');
    const photoPopupCancel = document.getElementById('photoPopupCancel');
    const photoPopupAgain = document.getElementById('photoPopupAgain');
    const photoPopupNext = document.getElementById('photoPopupNext');

    const innerModal = document.getElementById('innerModal');
    const innerModalSubtitle = document.getElementById('innerModalSubtitle');
    const innerGrid = document.getElementById('innerGrid');
    const innerModalCancel = document.getElementById('innerModalCancel');
    const innerModalConfirm = document.getElementById('innerModalConfirm');

    const finalModal = document.getElementById('finalModal');
    const finalOutfitPreview = document.getElementById('finalOutfitPreview');
    const finalCancel = document.getElementById('finalCancel');
    const finalConfirm = document.getElementById('finalConfirm');

    const historyDeleteModal = document.getElementById('historyDeleteModal');
    const historyDeletePassword = document.getElementById('historyDeletePassword');
    const historyDeleteError = document.getElementById('historyDeleteError');
    const historyDeleteConfirm = document.getElementById('historyDeleteConfirm');
    const historyDeleteCancel = document.getElementById('historyDeleteCancel');

    const modal = document.getElementById('passwordModal');
    const passwordInput = document.getElementById('passwordInput');
    const passwordError = document.getElementById('passwordError');
    const modalConfirm = document.getElementById('modalConfirm');
    const modalCancel = document.getElementById('modalCancel');

    const clearHistoryModal = document.getElementById('clearHistoryModal');
    const clearHistoryConfirm = document.getElementById('clearHistoryConfirm');
    const clearHistoryCancel = document.getElementById('clearHistoryCancel');

    const bulkDeleteModal = document.getElementById('bulkDeleteModal');
    const bulkDeleteConfirm = document.getElementById('bulkDeleteConfirm');
    const bulkDeleteCancel = document.getElementById('bulkDeleteCancel');
    const bulkDeleteCount = document.getElementById('bulkDeleteCount');
    const bulkDeleteList = document.getElementById('bulkDeleteList');

    const emailOptionsModal = document.getElementById('emailOptionsModal');
    const emailOptionsClose = document.getElementById('emailOptionsClose');
    const htmlOptionBtn = document.getElementById('htmlOptionBtn');
    const openOptionBtn = document.getElementById('openOptionBtn');
    const emailSubjectPreview = document.getElementById('emailSubjectPreview');

    const waModal = document.getElementById('waModal');
    const waRecipients = document.getElementById('waRecipients');
    const waAddNewToggle = document.getElementById('waAddNewToggle');
    const waAddForm = document.getElementById('waAddForm');
    const waNewName = document.getElementById('waNewName');
    const waNewNumber = document.getElementById('waNewNumber');
    const waAddSaveBtn = document.getElementById('waAddSaveBtn');
    const waAddCancelBtn = document.getElementById('waAddCancelBtn');
    const waPreview = document.getElementById('waPreview');
    const waCancelBtn = document.getElementById('waCancelBtn');
    const waSendBtn = document.getElementById('waSendBtn');

    const bulkFileInput = document.getElementById('bulkFileInput');
    const exportExcelBtn = document.getElementById('exportExcelBtn');

    let toastTimeout = null;
    let historyEntryToDelete = null;
    let lastSyncTime = null;
    let isSyncing = false;

    // Drive helpers
    function extractDriveId(link) {
        if (!link) return '';
        let m = link.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        m = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        return '';
    }
    function driveThumbUrl(linkOrId, size) {
        const id = linkOrId && linkOrId.startsWith('http') ? extractDriveId(linkOrId) : linkOrId;
        if (!id) return '';
        return `https://drive.google.com/thumbnail?id=${id}&sz=w${size || 400}`;
    }
    function driveViewUrl(link) {
        const id = extractDriveId(link);
        if (!id) return '';
        return `https://drive.google.com/file/d/${id}/view`;
    }

    function showToast(msg, duration) {
        if (!toast) return;
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toast.classList.remove('show'), duration || 2500);
    }
    function setSyncStatus(status, msg) {
        if (!syncBadge) return;
        syncBadge.className = 'sync-badge ' + status;
        syncBadge.textContent = msg;
    }
    function updateLastSyncInfo() {
        if (!lastSyncInfo) return;
        if (!lastSyncTime) { lastSyncInfo.textContent = '🔄 never synced'; return; }
        const s = Math.floor((Date.now() - lastSyncTime) / 1000);
        if (s < 5) lastSyncInfo.textContent = '✅ synced just now';
        else if (s < 60) lastSyncInfo.textContent = `✅ synced ${s}s ago`;
        else lastSyncInfo.textContent = `✅ synced ${Math.floor(s/60)}m ago`;
    }
    setInterval(updateLastSyncInfo, 5000);

    function keyFor(folder, name) { return folder + '::' + name; }
    function isPicked(folder, name) { return picked.includes(keyFor(folder, name)); }
    function getItemsByFolder(folder) { return ALL_ITEMS.filter(it => it.folder === folder); }
    function getAvailableByFolder(folder) { return getItemsByFolder(folder).filter(it => !isPicked(folder, it.name)); }
    function getAvailableByCategory(folder, category) {
        const avail = getAvailableByFolder(folder);
        if (category === '__all__') return avail;
        return avail.filter(it => it.category === category);
    }

    function getDateForOption(opt, custom) {
        const n = new Date();
        if (opt === 'today') return n;
        if (opt === 'tomorrow') { const t = new Date(n); t.setDate(t.getDate()+1); return t; }
        if (opt === 'yesterday') { const y = new Date(n); y.setDate(y.getDate()-1); return y; }
        if (opt === 'custom' && custom) {
            const p = custom.split('-');
            if (p.length === 3) return new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]));
            return new Date(custom);
        }
        return n;
    }
    function getFormattedDate(d) {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    function getFullDateTime(d) {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function getCurrentDateTime() { return getFullDateTime(new Date()); }

    function getSubjectLine() {
        const d = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        return `👕 Honey Outfit Log Selected by Me {Shinu} - ${d}`;
    }

    // ============================================================
    // RECIPIENTS
    // ============================================================
    function loadRecipients() {
        try {
            const raw = localStorage.getItem(LS_SAVED_RECIPIENTS);
            savedRecipients = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(savedRecipients)) savedRecipients = [];
        } catch (e) { savedRecipients = []; }
        try {
            lastUsedNumber = localStorage.getItem(LS_LAST_USED_NUMBER) || '';
        } catch (e) { lastUsedNumber = ''; }
    }
    function saveRecipients() {
        try { localStorage.setItem(LS_SAVED_RECIPIENTS, JSON.stringify(savedRecipients)); } catch (e) {}
    }
    function saveLastUsed(n) {
        try { lastUsedNumber = n; localStorage.setItem(LS_LAST_USED_NUMBER, n); } catch (e) {}
    }
    function addRecipient(name, number) {
        number = (number || '').replace(/\D/g, '');
        name = (name || '').trim();
        if (!name) { showToast('⚠️ Enter a name.', 2000); return false; }
        if (!number || number.length < 8) { showToast('⚠️ Enter a valid number.', 2500); return false; }
        if (savedRecipients.some(r => r.number === number)) {
            showToast('⚠️ This number is already saved.', 2500);
            return false;
        }
        savedRecipients.push({ name, number });
        saveRecipients();
        renderRecipients();
        showToast(`💾 Saved: ${name}`, 2000);
        return true;
    }
    function removeRecipient(number) {
        savedRecipients = savedRecipients.filter(r => r.number !== number);
        saveRecipients();
        if (selectedRecipient && selectedRecipient.number === number) selectedRecipient = null;
        renderRecipients();
        updateSendButtonState();
        showToast('🗑️ Removed', 1500);
    }
    function renderRecipients() {
        if (!waRecipients) return;
        waRecipients.innerHTML = '';
        if (savedRecipients.length === 0 && !lastUsedNumber) {
            const empty = document.createElement('div');
            empty.className = 'wa-empty-recipients';
            empty.textContent = '💭 No saved recipients yet. Tap "➕ Add new" to save one.';
            waRecipients.appendChild(empty);
            return;
        }
        if (lastUsedNumber && !savedRecipients.some(r => r.number === lastUsedNumber)) {
            const lastRow = document.createElement('div');
            lastRow.className = 'wa-recipient';
            lastRow.innerHTML = `
                <div class="wa-avatar">🕐</div>
                <div class="wa-info">
                    <div class="wa-name">Last used</div>
                    <div class="wa-number">+${lastUsedNumber}</div>
                </div>
            `;
            lastRow.addEventListener('click', () => {
                selectedRecipient = { name: 'Last used', number: lastUsedNumber };
                renderRecipients();
                updateSendButtonState();
            });
            if (selectedRecipient && selectedRecipient.number === lastUsedNumber) lastRow.classList.add('selected');
            waRecipients.appendChild(lastRow);
        }
        savedRecipients.forEach(r => {
            const row = document.createElement('div');
            row.className = 'wa-recipient';
            const avatar = document.createElement('div');
            avatar.className = 'wa-avatar';
            avatar.textContent = r.name.charAt(0).toUpperCase() || '?';
            const info = document.createElement('div');
            info.className = 'wa-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'wa-name';
            nameEl.textContent = r.name;
            const numEl = document.createElement('div');
            numEl.className = 'wa-number';
            numEl.textContent = '+' + r.number;
            info.appendChild(nameEl);
            info.appendChild(numEl);
            const removeBtn = document.createElement('button');
            removeBtn.className = 'wa-remove';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Remove "${r.name}" from saved recipients?`)) removeRecipient(r.number);
            });
            row.appendChild(avatar);
            row.appendChild(info);
            row.appendChild(removeBtn);
            row.addEventListener('click', () => {
                selectedRecipient = { name: r.name, number: r.number };
                renderRecipients();
                updateSendButtonState();
            });
            if (selectedRecipient && selectedRecipient.number === r.number) row.classList.add('selected');
            waRecipients.appendChild(row);
        });
    }
    function updateSendButtonState() {
        if (!waSendBtn) return;
        waSendBtn.disabled = !selectedRecipient;
    }

    // ============================================================
    // CLOUD SYNC
    // ============================================================
    async function pushAllToCloud() {
        const client = await ensureClient();
        if (!client) {
            setSyncStatus('offline', '⚠️ no cloud');
            return false;
        }
        if (isSyncing) return false;
        isSyncing = true;
        setSyncStatus('syncing', '🔄 saving...');
        try {
            await withTimeout(doPushAll(client), CLOUD_TIMEOUT_MS);
            lastSyncTime = Date.now();
            setSyncStatus('online', '☁️ synced');
            updateLastSyncInfo();
            isSyncing = false;
            return true;
        } catch (e) {
            console.error('pushAllToCloud failed:', e);
            setSyncStatus('offline', '⚠️ save failed');
            isSyncing = false;
            return false;
        }
    }

    async function doPushAll(client) {
            const sb = client || supabaseClient;
            await sb.from(TABLE_ITEMS).delete().neq('id', 0);
            if (ALL_ITEMS.length > 0) {
                const rows = ALL_ITEMS.map(it => ({
                    name: it.name,
                    category: it.category || '',
                    folder: it.folder,
                    drive_link: it.link || ''
                }));
                const { error } = await sb.from(TABLE_ITEMS).insert(rows);
                if (error) console.warn('items insert warn:', error);
            }
            await sb.from(TABLE_HISTORY).delete().neq('id', 0);
            if (history.length > 0) {
                const rows = history.map(h => ({
                    cloth_name: h.cloth || '',
                    cloth_category: h.clothCategory || '',
                    cloth_link: h.clothLink || '',
                    inner_name: h.inner || '',
                    inner_link: h.innerLink || '',
                    no_inner: !!h.noInner,
                    display_date: h.displayDate || '',
                    date_tag: h.dateTag || '',
                    wearer: h.wearer || ''
                }));
                const { error } = await sb.from(TABLE_HISTORY).insert(rows);
                if (error) console.warn('history insert warn:', error);
            }
            await sb.from(TABLE_PICKED).delete().neq('id', 0);
            if (picked.length > 0) {
                const rows = picked.map(k => {
                    const [folder, name] = k.split('::');
                    return { folder, item_name: name };
                });
                const { error } = await sb.from(TABLE_PICKED).insert(rows);
                if (error) console.warn('picked insert warn:', error);
            }
    }

    async function pullAllFromCloud() {
        const client = await ensureClient();
        if (!client) return null;
        try {
            const [iRes, hRes, pRes] = await withTimeout(Promise.all([
                client.from(TABLE_ITEMS).select('*').order('id', { ascending: true }),
                client.from(TABLE_HISTORY).select('*').order('id', { ascending: true }),
                client.from(TABLE_PICKED).select('*').order('id', { ascending: true })
            ]), CLOUD_TIMEOUT_MS);
            if (iRes.error || hRes.error || pRes.error) {
                console.warn('pull errors:', iRes.error, hRes.error, pRes.error);
                return null;
            }
            const items = (iRes.data || []).map(r => ({
                name: r.name,
                category: r.category || '',
                folder: r.folder || 'cloth',
                link: r.drive_link || ''
            }));
            const hist = (hRes.data || []).map(r => ({
                cloth: r.cloth_name || '',
                clothCategory: r.cloth_category || '',
                clothLink: r.cloth_link || '',
                inner: r.inner_name || '',
                innerLink: r.inner_link || '',
                noInner: !!r.no_inner,
                displayDate: r.display_date || '',
                dateTag: r.date_tag || '',
                wearer: r.wearer || ''
            }));
            const pk = (pRes.data || []).map(r => keyFor(r.folder || 'cloth', r.item_name));
            return { items, history: hist, picked: pk };
        } catch (e) {
            console.error('pullAllFromCloud failed:', e);
            return null;
        }
    }

    async function syncNow(silent) {
        const client = await ensureClient();
        if (!client) {
            if (!silent) showToast('⚠️ Cloud not configured.', 3000);
            setSyncStatus('offline', '⚠️ no cloud');
            return;
        }
        setSyncStatus('syncing', '🔄 syncing...');
        const pulled = await pullAllFromCloud();
        if (!pulled) {
            setSyncStatus('offline', '⚠️ offline');
            if (!silent) showToast('⚠️ Sync failed', 2500);
            return;
        }
        ALL_ITEMS = pulled.items.length > 0 ? pulled.items : TEST_ITEMS.slice();
        history = pulled.history;
        picked = pulled.picked;
        currentlyDisplayedEntry = history.length > 0 ? history[history.length - 1] : null;
        if (currentlyDisplayedEntry) updatePopup(currentlyDisplayedEntry);
        else updatePopup(null);
        lastSyncTime = Date.now();
        setSyncStatus('online', '☁️ synced');
        updateLastSyncInfo();
        updateUI();
        if (!silent) showToast('🔄 Synced from cloud!', 2000);
    }

    let autoSyncInterval = null;
    function startAutoSync() {
        if (autoSyncInterval) clearInterval(autoSyncInterval);
        autoSyncInterval = setInterval(async () => {
            if (isSyncing || document.hidden) return;
            if (!cloudCfg().ok) return;              // keys not filled in yet
            if (!(await ensureClient(3000))) return; // CDN still missing
            const before = JSON.stringify({ h: history, d: ALL_ITEMS, p: picked });
            const pulled = await pullAllFromCloud();
            if (pulled) {
                const after = JSON.stringify({ h: pulled.history, d: pulled.items, p: pulled.picked });
                if (before !== after) {
                    ALL_ITEMS = pulled.items;
                    history = pulled.history;
                    picked = pulled.picked;
                    currentlyDisplayedEntry = history.length > 0 ? history[history.length - 1] : null;
                    if (currentlyDisplayedEntry) updatePopup(currentlyDisplayedEntry);
                    lastSyncTime = Date.now();
                    setSyncStatus('online', '☁️ synced');
                    updateLastSyncInfo();
                    updateUI();
                    showToast('🔄 Updated from other device', 2000);
                }
            }
        }, 10000);
    }

    // ============================================================
    // UI RENDER
    // ============================================================
    function updateDeleteIndicator() {
        if (deleteIndicator) {
            deleteIndicator.className = deleteMode ? 'delete-mode-indicator active' : 'delete-mode-indicator inactive';
            deleteIndicator.textContent = deleteMode ? '🔓 unlocked' : '🔒 locked';
        }
        if (deleteModeBtn) {
            deleteModeBtn.innerHTML = deleteMode ? '<i>🔓</i> delete mode (active)' : '<i>🔒</i> delete mode';
            deleteModeBtn.style.background = deleteMode
                ? 'linear-gradient(135deg, #27ae60, #1a6e3b)'
                : 'linear-gradient(135deg, #c0392b, #e74c3c)';
        }
        if (selectAllContainer) selectAllContainer.style.display = deleteMode ? 'flex' : 'none';
        if (!deleteMode) selectedForDelete.clear();
    }

    function updateUI() {
        renderItemList();
        renderHistory();
        updateCategoryDropdown();
        updateCategoryModalDropdown();
        updateDriveFolderBtn();

        const totalAll = ALL_ITEMS.length;
        const pAll = ALL_ITEMS.filter(it => isPicked(it.folder, it.name)).length;

        // Counter chip lives in the sticky header now. The hidden #statusBadge
        // div is kept only for backward compatibility (it used to hold the
        // sync/delete chips with duplicate IDs, which broke cached references).
        if (statusCounter) statusCounter.textContent = `🔁 ${pAll} / ${totalAll} picked`;

        const folderItems = getItemsByFolder(currentFolder);
        const pCount = folderItems.filter(it => isPicked(currentFolder, it.name)).length;
        const remaining = folderItems.length - pCount;
        remainingCount.textContent = `📋 ${remaining} ${currentFolder} remaining`;
        historyCount.textContent = `📚 ${history.length} outfits picked`;

        if (refreshBtn) refreshBtn.disabled = (getAvailableByFolder('cloth').length === 0);

        if (totalAll === 0) resetNotice.textContent = '📭 Add cloths and inners to get started';
        else if (getAvailableByFolder('cloth').length === 0) resetNotice.textContent = '🎉 All cloths picked! click "reset all"';
        else resetNotice.textContent = `click refresh to pick an outfit (${currentFolder} folder)`;

        if (totalAll === 0) {
            currentlyDisplayedEntry = null;
            updatePopup(null);
        }
        updateDeleteIndicator();
        updateSelectedCount();
    }

    function updateDriveFolderBtn() {
        if (!openDriveFolderBtn) return;
        const cat = categorySelect.value;
        let link = '';
        if (cat !== '__all__') link = DRIVE_FOLDER_LINKS[cat] || '';
        if (link && !link.includes('REFERENCE')) {
            openDriveFolderBtn.style.display = 'inline-flex';
            openDriveFolderBtn.onclick = () => window.open(link, '_blank');
        } else {
            openDriveFolderBtn.style.display = 'none';
        }
    }

    function updateCategoryDropdown() {
        const folderItems = getItemsByFolder(currentFolder);
        const cats = new Set(folderItems.map(it => it.category));
        (FIXED_CATEGORIES[currentFolder] || []).forEach(c => cats.add(c));

        const currentVal = categorySelect.value;
        categorySelect.innerHTML = '';
        const allOpt = document.createElement('option');
        allOpt.value = '__all__';
        allOpt.textContent = '📋 All Categories';
        categorySelect.appendChild(allOpt);
        Array.from(cats).sort().forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = cat;
            categorySelect.appendChild(opt);
        });
        if (currentVal && (currentVal === '__all__' || cats.has(currentVal))) categorySelect.value = currentVal;
        else categorySelect.value = '__all__';
        updateCategoryCount();
    }

    function updateCategoryCount() {
        const sel = categorySelect.value;
        const folderItems = getItemsByFolder(currentFolder);
        const available = getAvailableByCategory(currentFolder, sel);
        if (sel === '__all__') categoryCount.textContent = `${available.length} / ${folderItems.length} available`;
        else {
            const total = folderItems.filter(it => it.category === sel).length;
            categoryCount.textContent = `${available.length} / ${total} in "${sel}"`;
        }
    }

    function updateSelectedCount() {
        const count = selectedForDelete.size;
        if (selectedCount) selectedCount.textContent = `(${count} selected)`;
        if (bulkDeleteBtn) {
            bulkDeleteBtn.classList.toggle('visible', deleteMode && count > 0);
            bulkDeleteBtn.textContent = count > 0 ? `🗑️ Delete Selected (${count})` : '🗑️ Delete Selected';
        }
        if (selectAllCheckbox) {
            const filtered = getFilteredItems();
            const avail = filtered.filter(it => !isPicked(currentFolder, it.name));
            selectAllCheckbox.checked = count > 0 && count === avail.length;
            selectAllCheckbox.indeterminate = count > 0 && count < avail.length;
        }
    }

    function getFilteredItems() {
        const sel = categorySelect.value;
        const folderItems = getItemsByFolder(currentFolder);
        return sel === '__all__' ? folderItems : folderItems.filter(it => it.category === sel);
    }

    function toggleSelectItem(name) {
        if (!deleteMode) return;
        if (isPicked(currentFolder, name)) return;
        if (selectedForDelete.has(name)) selectedForDelete.delete(name);
        else selectedForDelete.add(name);
        updateSelectedCount();
        renderItemList();
    }

    function selectAllItems() {
        if (!deleteMode) return;
        const avail = getFilteredItems().filter(it => !isPicked(currentFolder, it.name));
        if (selectAllCheckbox.checked) avail.forEach(it => selectedForDelete.add(it.name));
        else avail.forEach(it => selectedForDelete.delete(it.name));
        updateSelectedCount();
        renderItemList();
    }

    function renderItemList() {
        if (!itemGrid) return;
        itemGrid.innerHTML = '';
        const folderItems = getItemsByFolder(currentFolder);
        if (folderItems.length === 0) {
            const e = document.createElement('span');
            e.style.cssText = 'color:#90a8c0;font-style:italic;padding:0.5rem;';
            e.textContent = currentFolder === 'cloth' ? 'no cloths yet' : 'no inners yet';
            itemGrid.appendChild(e);
            return;
        }
        const filtered = getFilteredItems();
        if (filtered.length === 0) {
            const e = document.createElement('span');
            e.style.cssText = 'color:#90a8c0;font-style:italic;padding:0.5rem;';
            e.textContent = `no items in "${categorySelect.value}"`;
            itemGrid.appendChild(e);
            return;
        }
        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            const pickedNow = isPicked(currentFolder, item.name);
            if (pickedNow) card.classList.add('consumed');
            if (deleteMode && !pickedNow) card.classList.add('delete-mode-active');

            if (deleteMode && !pickedNow) {
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.className = 'select-checkbox';
                cb.checked = selectedForDelete.has(item.name);
                cb.addEventListener('change', (e) => { e.stopPropagation(); toggleSelectItem(item.name); });
                card.appendChild(cb);
            }

            const img = document.createElement('img');
            img.className = 'item-img';
            img.alt = item.name;
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.src = driveThumbUrl(item.link, 400) || '';
            img.onerror = () => { img.style.background = '#ffe0e0'; img.alt = '⚠️ image unavailable'; };
            card.appendChild(img);

            const nm = document.createElement('div');
            nm.className = 'item-name';
            nm.textContent = item.name;
            card.appendChild(nm);

            if (deleteMode && !pickedNow) {
                const db = document.createElement('button');
                db.className = 'delete-btn';
                db.textContent = '×';
                db.addEventListener('click', (e) => { e.stopPropagation(); deleteItem(item.name); });
                card.appendChild(db);
            }

            if (selectedForDelete.has(item.name) && !pickedNow) card.classList.add('selected-for-delete');

            card.addEventListener('click', (e) => {
                if (deleteMode && !pickedNow && !e.target.closest('.delete-btn') && !e.target.closest('.select-checkbox')) {
                    toggleSelectItem(item.name);
                }
            });

            itemGrid.appendChild(card);
        });
    }

    function renderHistory() {
        if (!historyList) return;
        historyList.innerHTML = '';
        if (history.length === 0) {
            const e = document.createElement('div');
            e.className = 'history-empty';
            e.textContent = 'no outfits picked yet';
            historyList.appendChild(e);
            return;
        }
        const reversed = [...history].reverse();
        reversed.forEach((entry, idx) => {
            const originalIndex = history.length - 1 - idx;
            const row = document.createElement('div');
            row.className = 'history-item';

            if (entry.clothLink) {
                const img = document.createElement('img');
                img.className = 'cloth-photo';
                img.src = driveThumbUrl(entry.clothLink, 200);
                img.alt = entry.cloth;
                img.loading = 'lazy';
                img.referrerPolicy = 'no-referrer';
                img.onerror = () => { img.style.background = '#ffe0e0'; };
                row.appendChild(img);
            }

            const nameWrap = document.createElement('div');
            nameWrap.style.cssText = 'display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'dish-name';
            nameSpan.textContent = entry.cloth;

            const catSpan = document.createElement('span');
            catSpan.className = 'dish-category';
            catSpan.textContent = entry.clothCategory || '—';

            const innerTag = document.createElement('span');
            if (entry.noInner || !entry.inner) {
                innerTag.className = 'inner-tag no-inner';
                innerTag.textContent = '🚫 No Inner';
            } else {
                innerTag.className = 'inner-tag';
                innerTag.textContent = `🩲 ${entry.inner}`;
            }

            nameWrap.appendChild(nameSpan);
            nameWrap.appendChild(catSpan);
            nameWrap.appendChild(innerTag);

            const dateWrap = document.createElement('span');
            dateWrap.style.cssText = 'display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;';
            const dateSpan = document.createElement('span');
            dateSpan.className = 'dish-date';
            dateSpan.textContent = entry.displayDate || getCurrentDateTime();
            dateWrap.appendChild(dateSpan);
            if (entry.dateTag) {
                const dt = document.createElement('span');
                dt.className = 'dish-date-tag';
                dt.textContent = entry.dateTag;
                dateWrap.appendChild(dt);
            }

            const wearTags = document.createElement('div');
            wearTags.className = 'cook-tags';
            const deepTag = document.createElement('span');
            deepTag.className = `cook-tag ${entry.wearer === 'deep' || entry.wearer === 'both' ? 'active-deep' : 'inactive'}`;
            deepTag.textContent = '👤 Deep';
            deepTag.addEventListener('click', () => toggleWearer(originalIndex, 'deep'));
            const honeyTag = document.createElement('span');
            honeyTag.className = `cook-tag ${entry.wearer === 'honey' || entry.wearer === 'both' ? 'active-honey' : 'inactive'}`;
            honeyTag.textContent = '👤 Honey';
            honeyTag.addEventListener('click', () => toggleWearer(originalIndex, 'honey'));
            wearTags.appendChild(deepTag);
            wearTags.appendChild(honeyTag);

            const delBtn = document.createElement('button');
            delBtn.className = 'history-delete-btn';
            delBtn.textContent = '🗑️';
            delBtn.addEventListener('click', (e) => { e.stopPropagation(); openHistoryDeleteModal(originalIndex); });

            row.appendChild(nameWrap);
            row.appendChild(dateWrap);
            row.appendChild(wearTags);
            row.appendChild(delBtn);
            historyList.appendChild(row);
        });
    }

    async function toggleWearer(idx, wearer) {
        if (idx < 0 || idx >= history.length) return;
        const e = history[idx];
        if (e.wearer === wearer) {
            if (e.wearer === 'both') e.wearer = (wearer === 'deep') ? 'honey' : 'deep';
            else e.wearer = '';
        } else if (e.wearer === '') e.wearer = wearer;
        else if (e.wearer === 'deep' && wearer === 'honey') e.wearer = 'both';
        else if (e.wearer === 'honey' && wearer === 'deep') e.wearer = 'both';
        else if (e.wearer === 'both') e.wearer = (wearer === 'deep') ? 'honey' : 'deep';
        if (currentlyDisplayedEntry && currentlyDisplayedEntry === e) {
            updatePopup(currentlyDisplayedEntry);
        }
        renderHistory();
        await pushAllToCloud();
    }

    async function deleteItem(name) {
        if (!deleteMode) { showToast('🔒 Locked.', 2000); return; }
        if (isPicked(currentFolder, name)) { showToast('⚠️ Already picked.', 2000); return; }
        const i = ALL_ITEMS.findIndex(it => it.folder === currentFolder && it.name === name);
        if (i !== -1) {
            ALL_ITEMS.splice(i, 1);
            selectedForDelete.delete(name);
            updateUI();
            showToast(`🗑️ Deleted: ${name}`, 2500);
            await pushAllToCloud();
        }
    }

    // ============================================================
    // PICK FLOW
    // ============================================================
    function pickClothFromCategory(category, dateOption, customDateValue) {
        let available;
        const clothCats = new Set(getItemsByFolder('cloth').map(it => it.category));
        if (category === '__random__') {
            const availCats = Array.from(clothCats).filter(cat => getAvailableByCategory('cloth', cat).length > 0);
            if (availCats.length === 0) return null;
            available = getAvailableByCategory('cloth', availCats[Math.floor(Math.random() * availCats.length)]);
        } else {
            available = getAvailableByCategory('cloth', category);
        }
        if (available.length === 0) return null;
        const cloth = available[Math.floor(Math.random() * available.length)];
        const dateObj = getDateForOption(dateOption, customDateValue);
        let dateTag;
        if (dateOption === 'today') dateTag = '📅 Today';
        else if (dateOption === 'tomorrow') dateTag = '📅 Tomorrow';
        else if (dateOption === 'yesterday') dateTag = '📅 Yesterday';
        else if (dateOption === 'custom') dateTag = '📅 ' + getFormattedDate(dateObj);
        else dateTag = '📅 Today';
        return { cloth, dateTag, dateObj };
    }

    function showPhotoPopup(picked) {
        pendingCloth = picked;
        const thumb = driveThumbUrl(picked.cloth.link, 800);
        photoPopupTitle.textContent = '👔 Cloth Picked';
        photoPopupImg.src = thumb || '';
        photoPopupImg.onerror = () => { photoPopupImg.style.background = '#ffe0e0'; };
        photoPopupCat.textContent = picked.cloth.category;
        photoPopupDate.textContent = picked.dateTag;
        photoPopup.classList.add('active');
    }

    function closePhotoPopup() { photoPopup.classList.remove('active'); }

    function openInnerModal() {
        if (!pendingCloth) return;
        innerModalSubtitle.textContent = `Cloth: ${pendingCloth.cloth.name} — now pick an inner`;
        innerGrid.innerHTML = '';

        const availableInners = getAvailableByFolder('inner');
        availableInners.forEach(inner => {
            const opt = document.createElement('div');
            opt.className = 'inner-option';
            const img = document.createElement('img');
            img.src = driveThumbUrl(inner.link, 300) || '';
            img.alt = inner.name;
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            img.onerror = () => { img.style.background = '#ffe0e0'; };
            opt.appendChild(img);
            const lbl = document.createElement('div');
            lbl.className = 'inner-label';
            lbl.textContent = inner.name;
            opt.appendChild(lbl);
            opt.addEventListener('click', () => {
                innerGrid.querySelectorAll('.inner-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
                pendingInner = { item: inner };
            });
            innerGrid.appendChild(opt);
        });

        const ni = document.createElement('div');
        ni.className = 'inner-option no-inner-option';
        const ph = document.createElement('div');
        ph.className = 'no-inner-ph';
        ph.textContent = '🚫';
        ni.appendChild(ph);
        const niLbl = document.createElement('div');
        niLbl.className = 'inner-label';
        niLbl.textContent = 'No Inner';
        ni.appendChild(niLbl);
        ni.addEventListener('click', () => {
            innerGrid.querySelectorAll('.inner-option').forEach(o => o.classList.remove('selected'));
            ni.classList.add('selected');
            pendingInner = { noInner: true };
        });
        innerGrid.appendChild(ni);
        ni.classList.add('selected');
        pendingInner = { noInner: true };

        innerModal.classList.add('active');
    }

    function closeInnerModal() { innerModal.classList.remove('active'); }

    function showFinalModal() {
        if (!pendingCloth || !pendingInner) return;
        finalOutfitPreview.innerHTML = '';

        const clothBox = document.createElement('div');
        clothBox.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.4rem;';
        const cImg = document.createElement('img');
        cImg.src = driveThumbUrl(pendingCloth.cloth.link, 400);
        cImg.style.cssText = 'width:180px;height:220px;object-fit:cover;border-radius:16px;border:3px solid #a63a63;background:#fff0f5;';
        cImg.onerror = () => { cImg.style.background = '#ffe0e0'; };
        clothBox.appendChild(cImg);
        const cTxt = document.createElement('div');
        cTxt.style.cssText = 'font-weight:600;color:#6f2141;font-size:0.9rem;';
        cTxt.textContent = `👔 ${pendingCloth.cloth.name}`;
        clothBox.appendChild(cTxt);
        finalOutfitPreview.appendChild(clothBox);

        const innerBox = document.createElement('div');
        innerBox.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:0.4rem;';
        if (pendingInner.noInner) {
            const ni = document.createElement('div');
            ni.style.cssText = 'width:180px;height:220px;display:flex;align-items:center;justify-content:center;border-radius:16px;border:3px solid #7f8c8d;background:#ecf0f1;font-size:3rem;';
            ni.textContent = '🚫';
            innerBox.appendChild(ni);
            const nTxt = document.createElement('div');
            nTxt.style.cssText = 'font-weight:600;color:#7f8c8d;font-size:0.9rem;';
            nTxt.textContent = 'No Inner';
            innerBox.appendChild(nTxt);
        } else {
            const iImg = document.createElement('img');
            iImg.src = driveThumbUrl(pendingInner.item.link, 400);
            iImg.style.cssText = 'width:180px;height:220px;object-fit:cover;border-radius:16px;border:3px solid #c2185b;background:#fff0f5;';
            iImg.onerror = () => { iImg.style.background = '#ffe0e0'; };
            innerBox.appendChild(iImg);
            const iTxt = document.createElement('div');
            iTxt.style.cssText = 'font-weight:600;color:#a63a63;font-size:0.9rem;';
            iTxt.textContent = `🩲 ${pendingInner.item.name}`;
            innerBox.appendChild(iTxt);
        }
        finalOutfitPreview.appendChild(innerBox);
        finalModal.classList.add('active');
    }

    function closeFinalModal() { finalModal.classList.remove('active'); }

    async function confirmFinalOutfit() {
        if (!pendingCloth || !pendingInner) return;
        const c = pendingCloth.cloth;
        const d = pendingCloth.dateObj;
        const entry = {
            cloth: c.name,
            clothCategory: c.category,
            clothLink: c.link || '',
            inner: pendingInner.noInner ? '' : pendingInner.item.name,
            innerLink: pendingInner.noInner ? '' : (pendingInner.item.link || ''),
            noInner: !!pendingInner.noInner,
            date: getFullDateTime(d),
            displayDate: getFormattedDate(d),
            dateTag: pendingCloth.dateTag,
            wearer: ''
        };
        history.push(entry);
        picked.push(keyFor('cloth', c.name));
        if (!pendingInner.noInner) picked.push(keyFor('inner', pendingInner.item.name));

        currentlyDisplayedEntry = entry;

        updatePopup(entry);
        updateUI();
        closeFinalModal();
        pendingCloth = null;
        pendingInner = null;
        if (navigator.vibrate) navigator.vibrate(12);
        showToast(`✅ Saved: ${entry.cloth} + ${entry.noInner ? 'No Inner' : entry.inner}`, 2500);
        await pushAllToCloud();
    }

    function updatePopup(entry) {
        if (!popupDisplay) return;
        if (!entry) {
            popupDisplay.innerHTML = `<span class="popup-empty">✨ click refresh to pick an outfit</span>`;
            return;
        }
        popupDisplay.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'outfit-card';

        const cRow = document.createElement('div');
        cRow.className = 'outfit-row';
        if (entry.clothLink) {
            const img = document.createElement('img');
            img.className = 'outfit-photo';
            img.src = driveThumbUrl(entry.clothLink, 400);
            img.onerror = () => { img.style.background = '#ffe0e0'; };
            cRow.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'no-photo';
            ph.textContent = '👔';
            cRow.appendChild(ph);
        }
        const cTxt = document.createElement('span');
        cTxt.className = 'popup-text';
        cTxt.textContent = entry.cloth;
        cRow.appendChild(cTxt);
        const catTag = document.createElement('span');
        catTag.className = 'popup-category';
        catTag.textContent = entry.clothCategory || '—';
        cRow.appendChild(catTag);
        wrap.appendChild(cRow);

        const iRow = document.createElement('div');
        iRow.className = 'outfit-row';
        if (entry.noInner || !entry.inner) {
            const ni = document.createElement('span');
            ni.className = 'no-inner-badge';
            ni.textContent = '🚫 No Inner';
            iRow.appendChild(ni);
        } else {
            if (entry.innerLink) {
                const img = document.createElement('img');
                img.className = 'outfit-photo inner-photo';
                img.src = driveThumbUrl(entry.innerLink, 400);
                img.onerror = () => { img.style.background = '#ffe0e0'; };
                iRow.appendChild(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'no-photo';
                ph.textContent = '🩲';
                iRow.appendChild(ph);
            }
            const iTxt = document.createElement('span');
            iTxt.className = 'popup-text inner-text';
            iTxt.textContent = entry.inner;
            iRow.appendChild(iTxt);
        }
        const dTag = document.createElement('span');
        dTag.className = 'popup-date';
        dTag.textContent = entry.dateTag || '📅 Today';
        iRow.appendChild(dTag);
        const num = document.createElement('span');
        num.className = 'popup-tag';
        num.textContent = `#${history.length}`;
        iRow.appendChild(num);
        wrap.appendChild(iRow);

        popupDisplay.appendChild(wrap);
    }

    // ============================================================
    // CATEGORY MODAL
    // ============================================================
    function openCategoryModal() {
        if (getItemsByFolder('cloth').length === 0) { showToast('📭 No cloths yet.', 2500); return; }
        if (getAvailableByFolder('cloth').length === 0) { showToast('🎉 All cloths picked! Reset first.', 2500); return; }
        const todayRadio = document.querySelector('input[name="outfitDate"][value="today"]');
        if (todayRadio) todayRadio.checked = true;
        document.querySelectorAll('.date-option label').forEach(l => l.classList.remove('selected'));
        const tl = document.getElementById('todayLabel');
        if (tl) tl.classList.add('selected');
        if (customDateRow) customDateRow.classList.remove('visible');
        if (customDateInput) customDateInput.value = '';
        if (customDatePreview) customDatePreview.textContent = '';
        updateCategoryModalDropdown();
        categoryModal.classList.add('active');
    }
    function closeCategoryModal() {
        categoryModal.classList.remove('active');
        if (customDateRow) customDateRow.classList.remove('visible');
    }
    function updateCategoryModalDropdown() {
        const currentVal = categoryModalSelect.value;
        categoryModalSelect.innerHTML = '';
        const allOpt = document.createElement('option');
        allOpt.value = '__all__';
        allOpt.textContent = '📋 All Categories';
        categoryModalSelect.appendChild(allOpt);
        const clothCats = new Set(getItemsByFolder('cloth').map(it => it.category));
        (FIXED_CATEGORIES.cloth || []).forEach(c => clothCats.add(c));
        Array.from(clothCats).sort().forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat;
            opt.textContent = `${cat} (${getAvailableByCategory('cloth', cat).length} available)`;
            categoryModalSelect.appendChild(opt);
        });
        const rndOpt = document.createElement('option');
        rndOpt.value = '__random__';
        rndOpt.textContent = '🎲 Random Category';
        categoryModalSelect.appendChild(rndOpt);
        if (currentVal && (currentVal === '__all__' || currentVal === '__random__' || clothCats.has(currentVal))) categoryModalSelect.value = currentVal;
        else categoryModalSelect.value = '__all__';
        updateCategoryModalCount();
    }
    function updateCategoryModalCount() {
        const sel = categoryModalSelect.value;
        if (sel === '__random__') {
            categoryModalCount.textContent = `🎲 ${getAvailableByFolder('cloth').length} cloths across all categories`;
            return;
        }
        const avail = getAvailableByCategory('cloth', sel);
        if (sel === '__all__') categoryModalCount.textContent = `${avail.length} / ${getItemsByFolder('cloth').length} cloths available`;
        else {
            const total = getItemsByFolder('cloth').filter(it => it.category === sel).length;
            categoryModalCount.textContent = `${avail.length} / ${total} in "${sel}"`;
        }
    }
    function confirmCategoryPick() {
        const sel = categoryModalSelect.value;
        let dateOpt = 'today';
        document.querySelectorAll('input[name="outfitDate"]').forEach(r => { if (r.checked) dateOpt = r.value; });
        if (dateOpt === 'custom' && (!customDateInput || !customDateInput.value)) {
            showToast('⚠️ Please select a custom date.', 2500);
            return;
        }
        const result = pickClothFromCategory(sel, dateOpt, customDateInput ? customDateInput.value : '');
        if (result) {
            closeCategoryModal();
            showPhotoPopup(result);
        } else showToast('No cloths available.', 2000);
    }

    function setupDateOptions() {
        document.querySelectorAll('.date-option label').forEach(label => {
            label.addEventListener('click', function() {
                const radio = this.querySelector('input[type="radio"]');
                if (!radio) return;
                radio.checked = true;
                document.querySelectorAll('.date-option label').forEach(l => l.classList.remove('selected'));
                this.classList.add('selected');
                if (radio.value === 'custom') {
                    if (customDateRow) customDateRow.classList.add('visible');
                    if (customDateInput) {
                        if (!customDateInput.value) {
                            const t = new Date();
                            customDateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
                            updateCustomDatePreview();
                        }
                        setTimeout(() => customDateInput.focus(), 100);
                    }
                } else {
                    if (customDateRow) customDateRow.classList.remove('visible');
                }
            });
        });
        if (customDateInput) {
            customDateInput.addEventListener('change', updateCustomDatePreview);
            customDateInput.addEventListener('input', updateCustomDatePreview);
        }
    }
    function updateCustomDatePreview() {
        if (!customDateInput || !customDatePreview) return;
        if (!customDateInput.value) { customDatePreview.textContent = ''; return; }
        const parts = customDateInput.value.split('-');
        if (parts.length === 3) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
            customDatePreview.textContent = '→ ' + getFormattedDate(d);
        }
    }

    // ============================================================
    // RESET / CLEAR
    // ============================================================
    async function handleReset() {
        if (ALL_ITEMS.length === 0) { showToast('📭 No items to reset.', 2000); return; }
        picked = [];
        selectedForDelete.clear();
        currentlyDisplayedEntry = null;
        updatePopup(null);
        updateUI();
        showToast('🔄 All items available again! (history preserved)', 2000);
        await pushAllToCloud();
    }
    function handleClearHistory() {
        if (history.length === 0) { showToast('📭 No history to clear!', 2000); return; }
        clearHistoryModal.classList.add('active');
    }
    async function confirmClearHistory() {
        history = [];
        picked = [];
        selectedForDelete.clear();
        currentlyDisplayedEntry = null;
        updatePopup(null);
        updateUI();
        clearHistoryModal.classList.remove('active');
        showToast('🗑️ All history cleared! (also from cloud)', 2500);
        await pushAllToCloud();
    }

    // ============================================================
    // ADD ITEM
    // ============================================================
    async function addNewItem() {
        const name = (newItemInput.value || '').trim();
        if (!name) { showToast('⚠️ Enter an item name.', 2000); return; }
        const category = (newCategoryInput.value || '').trim() || (currentFolder === 'inner' ? 'Inner Wear' : 'Regular');
        const link = (newItemLink.value || '').trim();
        if (!link) { showToast('⚠️ Paste a Google Drive link.', 2000); return; }
        const id = extractDriveId(link);
        if (!id) { showToast('⚠️ Invalid Drive link.', 2500); return; }
        if (ALL_ITEMS.some(it => it.folder === currentFolder && it.name.toLowerCase() === name.toLowerCase())) {
            showToast(`⚠️ "${name}" already exists.`, 2500);
            return;
        }
        ALL_ITEMS.push({ name, category, folder: currentFolder, link });
        updateUI();
        newItemInput.value = '';
        newCategoryInput.value = '';
        newItemLink.value = '';
        newItemInput.focus();
        showToast(`✅ Added: ${name}`, 2000);
        await pushAllToCloud();
    }

    async function handleBulkImport(file) {
        const reader = new FileReader();
        reader.onload = async function(e) {
            const content = e.target.result;
            const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
            let added = 0;
            const dups = [];
            lines.forEach((line, idx) => {
                if (idx === 0 && (line.toLowerCase().includes('name') || line.toLowerCase().includes('category') || line.toLowerCase().includes('link'))) return;
                const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
                if (parts.length < 3) return;
                const name = parts[0], category = parts[1], link = parts[2];
                const id = extractDriveId(link);
                if (!name || !id) return;
                if (!ALL_ITEMS.some(it => it.folder === currentFolder && it.name.toLowerCase() === name.toLowerCase())) {
                    ALL_ITEMS.push({ name, category: category || (currentFolder === 'inner' ? 'Inner Wear' : 'Regular'), folder: currentFolder, link });
                    added++;
                } else dups.push(name);
            });
            if (added > 0) {
                updateUI();
                showToast(`✅ Imported ${added} item(s)!`, 2500);
                if (dups.length) showToast(`⚠️ Skipped ${dups.length} duplicates.`, 3000);
                await pushAllToCloud();
            } else showToast('ℹ️ No new items found.', 2500);
            bulkFileInput.value = '';
        };
        reader.onerror = function() { showToast('❌ Error reading file.', 2000); bulkFileInput.value = ''; };
        reader.readAsText(file);
    }

    function handleExportExcel() {
        const folderItems = getItemsByFolder(currentFolder);
        if (folderItems.length === 0) { showToast('📭 No items to export.', 2000); return; }
        let content = 'Item Name,Category,Drive Link\n';
        content += folderItems.map(it => `"${it.name}","${it.category}","${it.link}"`).join('\n');
        const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentFolder}_export_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('📤 Exported!', 2000);
    }

    // ============================================================
    // MANUAL ADD
    // ============================================================
    function openManualAddModal() {
        manualItemName.value = '';
        manualCategory.value = '';
        manualInnerName.value = '';
        manualWearer.value = '';
        manualAddError.classList.remove('show');
        if (manualDateSelect) manualDateSelect.value = 'today';
        if (manualCustomDateRow) manualCustomDateRow.classList.remove('visible');
        if (manualCustomDateInput) manualCustomDateInput.value = '';
        if (manualCustomDatePreview) manualCustomDatePreview.textContent = '';
        manualAddModal.classList.add('active');
        setTimeout(() => manualItemName.focus(), 100);
    }
    function closeManualAddModal() {
        manualAddModal.classList.remove('active');
        manualAddError.classList.remove('show');
        if (manualCustomDateRow) manualCustomDateRow.classList.remove('visible');
    }
    async function confirmManualAdd() {
        const clothName = (manualItemName.value || '').trim();
        if (!clothName) {
            manualAddError.classList.add('show');
            manualItemName.focus();
            setTimeout(() => manualAddError.classList.remove('show'), 3000);
            return;
        }
        const category = (manualCategory.value || '').trim() || 'Regular';
        const innerName = (manualInnerName.value || '').trim();
        const wearer = manualWearer.value;
        const dateOpt = manualDateSelect ? manualDateSelect.value : 'today';

        if (dateOpt === 'custom' && (!manualCustomDateInput || !manualCustomDateInput.value)) {
            showToast('⚠️ Please select a custom date.', 2500);
            return;
        }

        let dateObj, dateTag;
        if (dateOpt === 'none') { dateObj = new Date(); dateTag = ''; }
        else {
            dateObj = getDateForOption(dateOpt, manualCustomDateInput ? manualCustomDateInput.value : '');
            if (dateOpt === 'today') dateTag = '📅 Today';
            else if (dateOpt === 'tomorrow') dateTag = '📅 Tomorrow';
            else if (dateOpt === 'yesterday') dateTag = '📅 Yesterday';
            else if (dateOpt === 'custom') dateTag = '📅 ' + getFormattedDate(dateObj);
            else dateTag = '📅 Today';
        }

        const clothItem = ALL_ITEMS.find(it => it.folder === 'cloth' && it.name.toLowerCase() === clothName.toLowerCase());
        const innerItem = innerName ? ALL_ITEMS.find(it => it.folder === 'inner' && it.name.toLowerCase() === innerName.toLowerCase()) : null;

        const newEntry = {
            cloth: clothName,
            clothCategory: clothItem ? clothItem.category : category,
            clothLink: clothItem ? (clothItem.link || '') : '',
            inner: innerItem ? innerItem.name : (innerName || ''),
            innerLink: innerItem ? (innerItem.link || '') : '',
            noInner: !innerName,
            date: getFullDateTime(dateObj),
            displayDate: getFormattedDate(dateObj),
            dateTag,
            wearer
        };
        history.push(newEntry);
        currentlyDisplayedEntry = newEntry;
        updatePopup(newEntry);
        if (!isPicked('cloth', clothName)) picked.push(keyFor('cloth', clothName));
        if (innerName && !isPicked('inner', innerName)) picked.push(keyFor('inner', innerName));

        updateUI();
        closeManualAddModal();
        showToast('✍️ Added: ' + clothName, 2500);
        await pushAllToCloud();
    }
    function setupManualDateDropdown() {
        if (!manualDateSelect) return;
        manualDateSelect.addEventListener('change', function() {
            if (this.value === 'custom') {
                if (manualCustomDateRow) manualCustomDateRow.classList.add('visible');
                if (manualCustomDateInput) {
                    if (!manualCustomDateInput.value) {
                        const t = new Date();
                        manualCustomDateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
                        updateManualCustomDatePreview();
                    }
                    setTimeout(() => manualCustomDateInput.focus(), 100);
                }
            } else {
                if (manualCustomDateRow) manualCustomDateRow.classList.remove('visible');
            }
        });
        if (manualCustomDateInput) {
            manualCustomDateInput.addEventListener('change', updateManualCustomDatePreview);
            manualCustomDateInput.addEventListener('input', updateManualCustomDatePreview);
        }
    }
    function updateManualCustomDatePreview() {
        if (!manualCustomDateInput || !manualCustomDatePreview) return;
        if (!manualCustomDateInput.value) { manualCustomDatePreview.textContent = ''; return; }
        const parts = manualCustomDateInput.value.split('-');
        if (parts.length === 3) {
            const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
            manualCustomDatePreview.textContent = '→ ' + getFormattedDate(d);
        }
    }

    // ============================================================
    // HISTORY DELETE
    // ============================================================
    function openHistoryDeleteModal(idx) {
        if (idx < 0 || idx >= history.length) return;
        historyEntryToDelete = idx;
        historyDeletePassword.value = '';
        historyDeleteError.classList.remove('show');
        historyDeleteModal.classList.add('active');
        historyDeletePassword.focus();
    }
    function closeHistoryDeleteModal() {
        historyDeleteModal.classList.remove('active');
        historyEntryToDelete = null;
        historyDeletePassword.value = '';
        historyDeleteError.classList.remove('show');
    }
    async function confirmHistoryDelete() {
        if (historyDeletePassword.value === PASSWORD) {
            if (historyEntryToDelete !== null && historyEntryToDelete >= 0 && historyEntryToDelete < history.length) {
                const e = history[historyEntryToDelete];
                history.splice(historyEntryToDelete, 1);
                const ck = keyFor('cloth', e.cloth);
                const ci = picked.indexOf(ck);
                if (ci !== -1) picked.splice(ci, 1);
                if (!e.noInner && e.inner) {
                    const ik = keyFor('inner', e.inner);
                    const ii = picked.indexOf(ik);
                    if (ii !== -1) picked.splice(ii, 1);
                }
                if (currentlyDisplayedEntry === e) {
                    currentlyDisplayedEntry = null;
                    updatePopup(null);
                }
                closeHistoryDeleteModal();
                updateUI();
                showToast(`🗑️ Deleted: ${e.cloth}`, 2500);
                await pushAllToCloud();
            }
        } else {
            historyDeleteError.classList.add('show');
            historyDeletePassword.value = '';
            historyDeletePassword.focus();
            setTimeout(() => historyDeleteError.classList.remove('show'), 3000);
        }
    }

    // ============================================================
    // PASSWORD / BULK DELETE
    // ============================================================
    function openModal() {
        if (deleteMode) {
            deleteMode = false;
            selectedForDelete.clear();
            updateUI();
            showToast('🔒 Locked', 2000);
            return;
        }
        modal.classList.add('active');
        passwordInput.value = '';
        passwordError.classList.remove('show');
        passwordInput.focus();
    }
    function closeModal() { modal.classList.remove('active'); passwordError.classList.remove('show'); }
    function verifyPassword() {
        if (passwordInput.value === PASSWORD) {
            deleteMode = true;
            closeModal();
            showToast('🔓 Delete mode ON', 3000);
            updateUI();
        } else {
            passwordError.classList.add('show');
            passwordInput.value = '';
            passwordInput.focus();
            setTimeout(() => passwordError.classList.remove('show'), 3000);
        }
    }
    function showBulkDeleteModal() {
        if (selectedForDelete.size === 0) { showToast('No items selected.', 2000); return; }
        const names = Array.from(selectedForDelete);
        bulkDeleteCount.textContent = `${names.length} item(s)`;
        bulkDeleteList.textContent = names.slice(0, 10).join(', ') + (names.length > 10 ? ` and ${names.length - 10} more...` : '');
        bulkDeleteModal.classList.add('active');
    }
    async function confirmBulkDelete() {
        const toDel = Array.from(selectedForDelete);
        if (toDel.length === 0) { bulkDeleteModal.classList.remove('active'); return; }
        toDel.forEach(name => {
            const i = ALL_ITEMS.findIndex(it => it.folder === currentFolder && it.name === name);
            if (i !== -1) ALL_ITEMS.splice(i, 1);
            const p = picked.indexOf(keyFor(currentFolder, name));
            if (p !== -1) picked.splice(p, 1);
        });
        selectedForDelete.clear();
        bulkDeleteModal.classList.remove('active');
        updateUI();
        showToast(`🗑️ Deleted ${toDel.length} item(s)!`, 2500);
        await pushAllToCloud();
    }

    // ============================================================
    // EMAIL
    // ============================================================
    function generateFullHTMLEmail() {
        const subjectLine = getSubjectLine();

        let html = `<div style="font-family:'Georgia','Segoe UI',Arial,sans-serif;max-width:900px;margin:0 auto;background:linear-gradient(135deg,#fff0f8 0%,#ffe0ec 50%,#ffd0e0 100%);padding:40px 30px;border-radius:28px;border:3px solid #ffb6c1;box-shadow:0 20px 60px rgba(214,51,132,0.25);position:relative;">

            <div style="text-align:center;font-size:34px;margin-bottom:8px;letter-spacing:6px;">💕 🌸 💖 🌺 💕</div>

            <div style="background:#ffffff;padding:20px 24px;border-radius:16px;margin-bottom:26px;border-left:6px solid #ff1493;box-shadow:0 6px 20px rgba(255,20,147,0.15);">
                <p style="margin:0 0 8px 0;font-size:11px;color:#d63384;text-transform:uppercase;letter-spacing:2px;font-weight:700;">📌 Email Subject (copy this line)</p>
                <p style="margin:0;font-size:19px;font-weight:700;color:#a04a6d;font-family:'Georgia',serif;line-height:1.4;font-style:italic;">${subjectLine}</p>
            </div>

            <h1 style="color:#d63384;border-bottom:3px double #ff69b4;padding-bottom:18px;text-align:center;margin-top:0;font-family:'Georgia',serif;font-style:italic;font-weight:400;font-size:36px;letter-spacing:1px;">💝 My Honey Outfit Log 💝</h1>
            <p style="text-align:center;color:#a04a6d;font-style:italic;font-size:15px;"><strong>📅 Generated:</strong> ${getCurrentDateTime()}</p>
            <div style="font-size:20px;font-weight:bold;color:#d63384;text-align:center;margin:22px 0;font-family:'Georgia',serif;">
                📊 <span style="font-size:34px;color:#ff1493;">${history.length}</span> <span style="font-style:italic;">Total Outfits Worn</span> 💖
            </div>`;

        if (history.length === 0) {
            html += `<p style="text-align:center;color:#d4a0b8;font-style:italic;font-size:16px;">💭 No outfits yet 💭</p>`;
        } else {
            const byCat = {};
            history.forEach(e => {
                const c = e.clothCategory || 'Uncategorized';
                if (!byCat[c]) byCat[c] = [];
                byCat[c].push(e);
            });
            Object.keys(byCat).sort().forEach(cat => {
                html += `<h3 style="color:white;background:linear-gradient(135deg,#d63384,#ff1493);padding:10px 20px;border-radius:30px;display:inline-block;font-family:'Georgia',serif;font-style:italic;font-weight:500;font-size:18px;box-shadow:0 4px 14px rgba(214,51,132,0.35);margin:18px 0 8px;">💐 ${cat} 💐</h3>
                <table style="width:100%;border-collapse:collapse;margin:15px 0;background:rgba(255,255,255,0.85);border-radius:16px;overflow:hidden;box-shadow:0 6px 20px rgba(255,20,147,0.12);">
                    <thead><tr>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:left;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">#</th>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:center;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">👔 Cloth</th>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:left;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">Cloth Name</th>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:center;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">🩲 Inner</th>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:left;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">Inner Name</th>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:left;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">📅 Date</th>
                        <th style="background:linear-gradient(135deg,#d63384,#ff1493);color:white;padding:12px 8px;text-align:left;font-family:'Georgia',serif;font-weight:500;font-style:italic;font-size:13px;">Wearer</th>
                    </tr></thead><tbody>`;
                byCat[cat].forEach((entry, idx) => {
                    let w = '—';
                    if (entry.wearer === 'deep') w = '👤 Deep';
                    else if (entry.wearer === 'honey') w = '👤 Honey';
                    else if (entry.wearer === 'both') w = '👤👤 Both';

                    let clothPhotoCell = '<span style="color:#d4a0b8;">—</span>';
                    if (entry.clothLink) {
                        const cUrl = `https://drive.google.com/thumbnail?id=${extractDriveId(entry.clothLink)}&sz=w200`;
                        clothPhotoCell = `<img src="${cUrl}" alt="cloth" style="width:90px;height:90px;object-fit:cover;border-radius:12px;border:3px solid #ff69b4;background:#fff0f8;display:block;margin:0 auto;box-shadow:0 4px 12px rgba(255,20,147,0.25);">`;
                    }

                    let innerPhotoCell = '<span style="color:#95a5a6;">🚫</span>';
                    let innerNameCell = '🚫 No Inner';
                    if (!entry.noInner && entry.inner) {
                        innerNameCell = entry.inner;
                        if (entry.innerLink) {
                            const iUrl = `https://drive.google.com/thumbnail?id=${extractDriveId(entry.innerLink)}&sz=w200`;
                            innerPhotoCell = `<img src="${iUrl}" alt="inner" style="width:90px;height:90px;object-fit:cover;border-radius:12px;border:3px solid #27ae60;background:#e8f5e9;display:block;margin:0 auto;box-shadow:0 4px 12px rgba(39,174,96,0.25);">`;
                        } else {
                            innerPhotoCell = '<span style="color:#d4a0b8;">—</span>';
                        }
                    }

                    const rowBg = idx % 2 === 0 ? '#fffafd' : '#fff0f8';
                    html += `<tr style="background:${rowBg};border-bottom:1px solid #ffd0e0;">
                        <td style="padding:12px 8px;vertical-align:middle;color:#d63384;font-weight:bold;font-family:'Georgia',serif;">${idx + 1}</td>
                        <td style="padding:12px 8px;vertical-align:middle;text-align:center;">${clothPhotoCell}</td>
                        <td style="padding:12px 8px;vertical-align:middle;font-weight:bold;color:#a04a6d;font-family:'Georgia',serif;font-style:italic;">${entry.cloth}</td>
                        <td style="padding:12px 8px;vertical-align:middle;text-align:center;">${innerPhotoCell}</td>
                        <td style="padding:12px 8px;vertical-align:middle;color:#1a6e3b;font-family:'Georgia',serif;">${innerNameCell}</td>
                        <td style="padding:12px 8px;vertical-align:middle;color:#a04a6d;font-family:'Georgia',serif;font-size:13px;">${entry.displayDate || 'N/A'}${entry.dateTag ? '<br><span style="background:#8e44ad;color:white;padding:2px 10px;border-radius:20px;font-size:11px;display:inline-block;margin-top:4px;">' + entry.dateTag + '</span>' : ''}</td>
                        <td style="padding:12px 8px;vertical-align:middle;color:#a04a6d;font-family:'Georgia',serif;">${w}</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
            });
        }

        html += `<div style="background:linear-gradient(135deg,#ffe0ec,#ffd0e0);padding:20px 24px;border-radius:18px;margin:26px 0;border:2px dashed #ff69b4;">
            <p style="margin:6px 0;color:#a04a6d;font-family:'Georgia',serif;font-style:italic;"><strong>👔 Total cloths:</strong> ${getItemsByFolder('cloth').length} 💕</p>
            <p style="margin:6px 0;color:#a04a6d;font-family:'Georgia',serif;font-style:italic;"><strong>🩲 Total inners:</strong> ${getItemsByFolder('inner').length} 💖</p>
            <p style="margin:6px 0;color:#a04a6d;font-family:'Georgia',serif;font-style:italic;"><strong>📋 Total outfits worn:</strong> ${history.length} 🌸</p>
        </div>
        <div style="text-align:center;font-size:28px;margin:18px 0;letter-spacing:8px;">💕 💖 💗 💝 💕</div>
        <p style="text-align:center;color:#d63384;font-size:12px;font-family:'Georgia',serif;font-style:italic;">✨ Made with love by Honey for Shinu 💕</p></div>`;
        return html;
    }

    function generatePlainTextEmail() {
        let b = '💕 HONEY OUTFIT LOG 💕\n' + '♥'.repeat(50) + '\n\n';
        b += '📌 Subject: ' + getSubjectLine() + '\n';
        b += '📅 Generated: ' + getCurrentDateTime() + '\n' + '─'.repeat(50) + '\n\n';
        b += '📊 TOTAL OUTFITS WORN: ' + history.length + '\n' + '─'.repeat(50) + '\n\n';
        if (history.length === 0) b += '💭 No outfits yet.\n';
        else {
            history.forEach((e, i) => {
                b += `  ${i+1}. 👔 ${e.cloth} + ${e.noInner || !e.inner ? '🚫 No Inner' : '🩲 ' + e.inner}`;
                b += ` — ${e.displayDate || 'N/A'}`;
                if (e.dateTag) b += ` ${e.dateTag}`;
                b += '\n';
            });
        }
        b += '\n' + '♥'.repeat(50) + '\n✨ Made with love for Shinu 💕';
        return b;
    }

    // ⬇️⬇️ EMAIL HANDLERS — WITH AUTO-CLEAR AFTER 3 SECONDS ⬇️⬇️
    async function clearHistoryAfterEmail() {
        if (history.length === 0 && picked.length === 0) return;
        history = [];
        picked = [];
        selectedForDelete.clear();
        currentlyDisplayedEntry = null;
        updatePopup(null);
        updateUI();
        showToast('🗑️ History cleared after email', 2500);
        await pushAllToCloud();
    }

    function scheduleHistoryClear() {
        setTimeout(async () => {
            await clearHistoryAfterEmail();
        }, 3000);
    }

    function optionHTML() {
        if (history.length === 0) { showToast('📭 No history!', 2500); return; }
        const full = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#fff0f8;">${generateFullHTMLEmail()}</body></html>`;
        copyToClipboard(full, '💕 HTML copied! History will clear in 3 seconds...');
        scheduleHistoryClear();
    }

    function optionOpen() {
        if (history.length === 0) { showToast('📭 No history!', 2500); return; }
        const sub = encodeURIComponent(getSubjectLine());
        const body = encodeURIComponent(generatePlainTextEmail());
        window.location.href = `mailto:?subject=${sub}&body=${body}`;
        showToast('📧 Email opening! History will clear in 3 seconds...', 2500);
        closeEmailOptions();
        scheduleHistoryClear();
    }

    function copyToClipboard(text, msg) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToast(msg, 3000);
                closeEmailOptions();
            }).catch(() => fallbackCopy(text, msg));
        } else fallbackCopy(text, msg);
    }
    function fallbackCopy(text, msg) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try {
            document.execCommand('copy');
            showToast(msg, 2000);
            closeEmailOptions();
        } catch (e) { showToast('❌ Copy failed.', 2000); }
        document.body.removeChild(ta);
    }

    function openEmailOptions() {
        if (history.length === 0) { showToast('📭 No history!', 2500); return; }
        if (emailSubjectPreview) emailSubjectPreview.textContent = getSubjectLine();
        emailOptionsModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    function closeEmailOptions() {
        emailOptionsModal.classList.remove('active');
        document.body.style.overflow = '';
    }

    // ============================================================
    // WHATSAPP
    // ============================================================
    function buildWhatsAppMessage() {
        let entry = currentlyDisplayedEntry;
        if (!entry && history.length > 0) entry = history[history.length - 1];

        if (!entry) {
            return `💕 *Honey Outfit Log Selected by Me {Shinu}* 💕\n\n💭 No outfit currently selected.`;
        }

        const todayStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        let msg = `💕 *Honey Outfit Log Selected by Me {Shinu}* 💕\n`;
        msg += `📅 *${todayStr}*\n`;
        msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

        msg += `👔 *CLOTH*\n`;
        msg += `Name: *${entry.cloth}*\n`;
        if (entry.clothCategory) msg += `Category: *${entry.clothCategory}*\n`;
        if (entry.clothLink) {
            const view = driveViewUrl(entry.clothLink);
            if (view) msg += `📸 Photo: ${view}\n`;
        }

        msg += `\n`;

        msg += `🩲 *INNER*\n`;
        if (entry.noInner || !entry.inner) {
            msg += `*🚫 No Inner*\n`;
        } else {
            msg += `Name: *${entry.inner}*\n`;
            if (entry.innerLink) {
                const view = driveViewUrl(entry.innerLink);
                if (view) msg += `📸 Photo: ${view}\n`;
            }
        }

        msg += `\n`;

        if (entry.dateTag) msg += `${entry.dateTag}\n`;
        if (entry.wearer) {
            const w = entry.wearer === 'both' ? '*👤👤 Both*' :
                      entry.wearer === 'deep' ? '*👤 Deep*' :
                      entry.wearer === 'honey' ? '*👤 Honey*' : entry.wearer;
            msg += `Wearer: ${w}\n`;
        }

        msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
        msg += `💕 *Made with love by Honey for Shinu* 💕`;
        return msg;
    }

    function openWhatsAppModal() {
        if (!currentlyDisplayedEntry && history.length === 0) {
            showToast('📭 No outfit picked yet!', 2500);
            return;
        }
        selectedRecipient = null;
        updateSendButtonState();
        waAddForm.classList.remove('visible');
        waNewName.value = '';
        waNewNumber.value = '';
        renderRecipients();
        if (waPreview) waPreview.textContent = buildWhatsAppMessage();
        waModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
    function closeWhatsAppModal() {
        waModal.classList.remove('active');
        document.body.style.overflow = '';
        selectedRecipient = null;
        updateSendButtonState();
        waAddForm.classList.remove('visible');
    }
    function sendWhatsApp() {
        if (!selectedRecipient || !selectedRecipient.number) {
            showToast('⚠️ Please select a recipient first.', 2500);
            return;
        }
        const phone = selectedRecipient.number.replace(/\D/g, '');
        const message = buildWhatsAppMessage();
        const encoded = encodeURIComponent(message);
        const url = `https://wa.me/${phone}?text=${encoded}`;
        const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);
        saveLastUsed(phone);
        if (isMobile) window.location.href = url;
        else window.open(url, '_blank');
        showToast(`💬 WhatsApp opening for ${selectedRecipient.name}! History preserved 💕`, 2800);
        closeWhatsAppModal();
    }
    function toggleAddForm() {
        waAddForm.classList.toggle('visible');
        if (waAddForm.classList.contains('visible')) setTimeout(() => waNewName.focus(), 100);
    }
    function saveNewRecipient() {
        const name = (waNewName.value || '').trim();
        const number = (waNewNumber.value || '').replace(/\D/g, '');
        if (!name) { showToast('⚠️ Enter a name.', 2000); waNewName.focus(); return; }
        if (!number || number.length < 8) { showToast('⚠️ Enter a valid number.', 2500); waNewNumber.focus(); return; }
        if (addRecipient(name, number)) {
            waNewName.value = '';
            waNewNumber.value = '';
            waAddForm.classList.remove('visible');
            selectedRecipient = { name, number };
            renderRecipients();
            updateSendButtonState();
        }
    }

    // ============================================================
    // LOCAL BACKUP
    // ============================================================
    function saveLocalBackup() {
        try {
            localStorage.setItem('outfitPickerData', JSON.stringify({
                history, allItems: ALL_ITEMS, picked, savedAt: Date.now()
            }));
        } catch (e) {}
    }
    function loadLocalBackup() {
        try {
            const saved = localStorage.getItem('outfitPickerData');
            if (!saved) return false;
            const p = JSON.parse(saved);
            if (p.history && Array.isArray(p.history)) history = p.history;
            if (p.allItems && Array.isArray(p.allItems)) {
                ALL_ITEMS = p.allItems.map(it => {
                    if (typeof it === 'string') return { name: it, category: 'Regular', folder: 'cloth', link: '' };
                    return {
                        name: it.name,
                        category: it.category || '',
                        folder: it.folder || 'cloth',
                        link: it.link || ''
                    };
                });
            }
            if (p.picked && Array.isArray(p.picked)) picked = p.picked;
            return true;
        } catch (e) { return false; }
    }

    // ============================================================
    // FOLDER SWITCH
    // ============================================================
    function switchFolder(folder) {
        currentFolder = folder;
        tabCloth.classList.toggle('active', folder === 'cloth');
        tabInner.classList.toggle('active', folder === 'inner');
        newItemInput.placeholder = folder === 'cloth' ? 'e.g. Blue Office Shirt' : 'e.g. White Cotton Inner';
        newCategoryInput.placeholder = folder === 'cloth' ? 'Category (Regular/Office/Night/Outing)' : 'Category (Inner Wear)';
        if (folder === 'inner') newCategoryInput.value = 'Inner Wear';
        else if (newCategoryInput.value === 'Inner Wear') newCategoryInput.value = '';
        selectedForDelete.clear();
        updateUI();
    }

    // ============================================================
    // BACKGROUND CLOUD STARTUP (never blocks the UI)
    // ============================================================
    async function startCloudSync() {
        const c = cloudCfg();
        if (!c.ok) {
            setSyncStatus('offline', '⚠️ add Supabase keys');
            setTimeout(() => showToast('⚠️ Add your Supabase URL & Key to enable cloud sync', 4000), 800);
            return;
        }
        setSyncStatus('syncing', '🔄 connecting...');
        // pullAllFromCloud() waits for the async CDN script itself, so a slow
        // supabase.js load no longer means "cloud disabled".
        const ok = await pullAllFromCloud();
        if (ok) {
            if (ok.items.length > 0) ALL_ITEMS = ok.items;
            history = ok.history;
            picked = ok.picked;
            currentlyDisplayedEntry = history.length > 0 ? history[history.length - 1] : null;
            if (currentlyDisplayedEntry) updatePopup(currentlyDisplayedEntry);
            else updatePopup(null);
            lastSyncTime = Date.now();
            setSyncStatus('online', '☁️ synced');
            updateLastSyncInfo();
            updateUI();
            showToast('💕 Loaded from cloud!', 2000);
        } else {
            setSyncStatus('offline', '⚠️ offline');
            console.warn('☁️ Cloud unreachable at', c.url, '— running on local data.');
        }
        startAutoSync();
    }

    // ============================================================
    // INIT
    // ============================================================
    function hideAppLoader() {
        const loader = document.getElementById('appLoader');
        if (!loader) return;
        loader.classList.add('hide');
        setTimeout(() => loader.remove(), 600);
    }

    async function init() {
        loadLocalBackup();
        loadRecipients();
        if (ALL_ITEMS.length === 0) ALL_ITEMS = TEST_ITEMS.slice();

        updateUI();
        updatePopup(null);
        setupDateOptions();
        setupManualDateDropdown();

        // NOTE: no cloud await here — the UI is interactive immediately.
        // Cloud sync runs in the background so nothing ever "gets stuck".
        startCloudSync();

        if (tabCloth) tabCloth.addEventListener('click', () => switchFolder('cloth'));
        if (tabInner) tabInner.addEventListener('click', () => switchFolder('inner'));

        if (refreshBtn) refreshBtn.addEventListener('click', openCategoryModal);
        if (categoryModalConfirm) categoryModalConfirm.addEventListener('click', confirmCategoryPick);
        if (categoryModalCancel) categoryModalCancel.addEventListener('click', closeCategoryModal);
        if (categoryModal) categoryModal.addEventListener('click', (e) => { if (e.target === categoryModal) closeCategoryModal(); });
        if (categoryModalSelect) categoryModalSelect.addEventListener('change', updateCategoryModalCount);

        if (photoPopupCancel) photoPopupCancel.addEventListener('click', () => { closePhotoPopup(); pendingCloth = null; pendingInner = null; });
        if (photoPopupAgain) photoPopupAgain.addEventListener('click', () => {
            if (!pendingCloth) return;
            const cat = pendingCloth.cloth.category;
            const dateTag = pendingCloth.dateTag;
            const dateObj = pendingCloth.dateObj;
            const avail = getAvailableByCategory('cloth', cat);
            const others = avail.filter(it => it.name !== pendingCloth.cloth.name);
            const pool = others.length > 0 ? others : avail;
            if (pool.length === 0) { showToast('No other options.', 2000); return; }
            const next = pool[Math.floor(Math.random() * pool.length)];
            pendingCloth = { cloth: next, dateTag, dateObj };
            showPhotoPopup(pendingCloth);
        });
        if (photoPopupNext) photoPopupNext.addEventListener('click', () => {
            closePhotoPopup();
            openInnerModal();
        });
        if (photoPopup) photoPopup.addEventListener('click', (e) => { if (e.target === photoPopup) { closePhotoPopup(); pendingCloth = null; } });

        if (innerModalCancel) innerModalCancel.addEventListener('click', () => { closeInnerModal(); pendingCloth = null; pendingInner = null; });
        if (innerModalConfirm) innerModalConfirm.addEventListener('click', () => {
            if (!pendingInner) { showToast('⚠️ Choose an inner or No Inner.', 2000); return; }
            closeInnerModal();
            showFinalModal();
        });
        if (innerModal) innerModal.addEventListener('click', (e) => { if (e.target === innerModal) { closeInnerModal(); pendingCloth = null; pendingInner = null; } });

        if (finalCancel) finalCancel.addEventListener('click', () => { closeFinalModal(); openInnerModal(); });
        if (finalConfirm) finalConfirm.addEventListener('click', confirmFinalOutfit);
        if (finalModal) finalModal.addEventListener('click', (e) => { if (e.target === finalModal) closeFinalModal(); });

        if (historyDeleteConfirm) historyDeleteConfirm.addEventListener('click', confirmHistoryDelete);
        if (historyDeleteCancel) historyDeleteCancel.addEventListener('click', closeHistoryDeleteModal);
        if (historyDeleteModal) historyDeleteModal.addEventListener('click', (e) => { if (e.target === historyDeleteModal) closeHistoryDeleteModal(); });
        if (historyDeletePassword) historyDeletePassword.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmHistoryDelete(); }
            if (e.key === 'Escape') closeHistoryDeleteModal();
        });

        if (resetBtn) resetBtn.addEventListener('click', handleReset);
        if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', handleClearHistory);
        if (emailBtn) emailBtn.addEventListener('click', openEmailOptions);
        if (whatsappBtn) whatsappBtn.addEventListener('click', openWhatsAppModal);
        if (addItemBtn) addItemBtn.addEventListener('click', addNewItem);
        if (deleteModeBtn) deleteModeBtn.addEventListener('click', openModal);
        if (syncBtn) syncBtn.addEventListener('click', () => syncNow(false));

        if (manualAddBtn) manualAddBtn.addEventListener('click', openManualAddModal);
        if (manualAddConfirm) manualAddConfirm.addEventListener('click', confirmManualAdd);
        if (manualAddCancel) manualAddCancel.addEventListener('click', closeManualAddModal);
        if (manualAddModal) manualAddModal.addEventListener('click', (e) => { if (e.target === manualAddModal) closeManualAddModal(); });
        if (manualItemName) manualItemName.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmManualAdd(); }
            if (e.key === 'Escape') closeManualAddModal();
        });

        if (bulkDeleteBtn) bulkDeleteBtn.addEventListener('click', showBulkDeleteModal);
        if (bulkDeleteConfirm) bulkDeleteConfirm.addEventListener('click', confirmBulkDelete);
        if (bulkDeleteCancel) bulkDeleteCancel.addEventListener('click', () => bulkDeleteModal.classList.remove('active'));
        if (bulkDeleteModal) bulkDeleteModal.addEventListener('click', (e) => { if (e.target === bulkDeleteModal) bulkDeleteModal.classList.remove('active'); });

        if (selectAllCheckbox) selectAllCheckbox.addEventListener('change', selectAllItems);
        if (categorySelect) categorySelect.addEventListener('change', () => {
            selectedForDelete.clear();
            updateCategoryCount();
            updateDriveFolderBtn();
            renderItemList();
            updateSelectedCount();
        });

        if (bulkFileInput) bulkFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleBulkImport(e.target.files[0]);
        });
        if (exportExcelBtn) exportExcelBtn.addEventListener('click', handleExportExcel);

        if (clearHistoryConfirm) clearHistoryConfirm.addEventListener('click', confirmClearHistory);
        if (clearHistoryCancel) clearHistoryCancel.addEventListener('click', () => clearHistoryModal.classList.remove('active'));
        if (clearHistoryModal) clearHistoryModal.addEventListener('click', (e) => { if (e.target === clearHistoryModal) clearHistoryModal.classList.remove('active'); });

        if (emailOptionsClose) emailOptionsClose.addEventListener('click', closeEmailOptions);
        if (htmlOptionBtn) htmlOptionBtn.addEventListener('click', optionHTML);
        if (openOptionBtn) openOptionBtn.addEventListener('click', optionOpen);
        if (emailOptionsModal) emailOptionsModal.addEventListener('click', (e) => { if (e.target === emailOptionsModal) closeEmailOptions(); });

        if (waCancelBtn) waCancelBtn.addEventListener('click', closeWhatsAppModal);
        if (waSendBtn) waSendBtn.addEventListener('click', sendWhatsApp);
        if (waModal) waModal.addEventListener('click', (e) => { if (e.target === waModal) closeWhatsAppModal(); });
        if (waAddNewToggle) waAddNewToggle.addEventListener('click', (e) => { e.preventDefault(); toggleAddForm(); });
        if (waAddSaveBtn) waAddSaveBtn.addEventListener('click', saveNewRecipient);
        if (waAddCancelBtn) waAddCancelBtn.addEventListener('click', () => { waAddForm.classList.remove('visible'); waNewName.value = ''; waNewNumber.value = ''; });
        if (waNewName) waNewName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); waNewNumber.focus(); } });
        if (waNewNumber) waNewNumber.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNewRecipient(); } });

        if (newItemInput) newItemInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNewItem(); } });
        if (newCategoryInput) newCategoryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNewItem(); } });
        if (newItemLink) newItemLink.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNewItem(); } });

        if (modalConfirm) modalConfirm.addEventListener('click', verifyPassword);
        if (modalCancel) modalCancel.addEventListener('click', closeModal);
        if (passwordInput) passwordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); verifyPassword(); }
            if (e.key === 'Escape') closeModal();
        });
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
            if ((e.key === 'r' || e.key === 'R') && !refreshBtn?.disabled) { e.preventDefault(); openCategoryModal(); }
            if (e.key === 'Escape') {
                if (categoryModal.classList.contains('active')) closeCategoryModal();
                else if (photoPopup.classList.contains('active')) { closePhotoPopup(); pendingCloth = null; pendingInner = null; }
                else if (innerModal.classList.contains('active')) { closeInnerModal(); pendingCloth = null; pendingInner = null; }
                else if (finalModal.classList.contains('active')) closeFinalModal();
                else if (historyDeleteModal.classList.contains('active')) closeHistoryDeleteModal();
                else if (manualAddModal.classList.contains('active')) closeManualAddModal();
                else if (modal.classList.contains('active')) closeModal();
                else if (emailOptionsModal.classList.contains('active')) closeEmailOptions();
                else if (waModal.classList.contains('active')) closeWhatsAppModal();
                else if (clearHistoryModal.classList.contains('active')) clearHistoryModal.classList.remove('active');
                else if (bulkDeleteModal.classList.contains('active')) bulkDeleteModal.classList.remove('active');
            }
        });

        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) return;
            if (!cloudCfg().ok) return;
            // pullAllFromCloud() waits for the client, so returning to the tab after
            // the CDN script finally loaded still syncs correctly.
            const ok = await pullAllFromCloud();
            if (!ok) return;
            const before = JSON.stringify({ h: history, d: ALL_ITEMS, p: picked });
            const after = JSON.stringify({ h: ok.history, d: ok.items, p: ok.picked });
            if (before === after) return;
            if (ok.items.length > 0) ALL_ITEMS = ok.items;
            history = ok.history;
            picked = ok.picked;
            currentlyDisplayedEntry = history.length > 0 ? history[history.length - 1] : null;
            if (currentlyDisplayedEntry) updatePopup(currentlyDisplayedEntry);
            updateUI();
            showToast('🔄 Refreshed from cloud', 2000);
        });

        setInterval(saveLocalBackup, 5000);
        hideAppLoader();
        console.log('👕 Outfit Picker ready!');
    }

    // Safety net: never let the intro screen linger if something throws during init.
    window.addEventListener('load', () => setTimeout(hideAppLoader, 1200));

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
