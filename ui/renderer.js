document.addEventListener('DOMContentLoaded', () => {
    // 1. Identify all required UI elements
    const inputElement = document.getElementById('youtube-video-input');
    const logTextarea = document.getElementById('application-log-textarea');
    const queueList = document.getElementById('link-queue-list');
    const downloadButton = document.getElementById('download-video-button');
    const fileProgressLabel = document.getElementById('current-file-progress-label');
    const fileProgressBar = document.getElementById('current-file-progress-bar');
    const batchProgressLabel = document.getElementById('batch-progress-label');
    const batchProgressBar = document.getElementById('batch-progress-bar');

window.linkAPI.onProgressUpdate((data) => {
    if (data.type === 'file') {
        // Update File Bar (0-100)
        fileProgressBar.value = data.value;
        fileProgressLabel.innerText = data.label || `Progress: ${data.value}%`;
    } 
    
    if (data.type === 'batch') {
        // Update Batch Bar
        const percentage = (data.current / data.total) * 100;
        batchProgressBar.value = percentage;
        batchProgressLabel.innerText = `Batch: ${data.current} / ${data.total}`;
    }
    if (data.label === "All tasks finished successfully!") {
        const audio = new Audio('./assets/sounds/download_complete.mp3');
        audio.play();
    }
});



    // 2. Comprehensive Debug Check
    const requiredElements = [
        { name: 'Input Box', element: inputElement, id: '#youtube-video-input' },
        { name: 'Log Textarea', element: logTextarea, id: '#application-log-textarea' },
        { name: 'Queue List Container', element: queueList, id: '#link-queue-list' },
        { name: 'Download Button', element: downloadButton, id: '#download-video-button' }
    ];

    let allElementsFound = true;

    console.log("--- Initializing UI Debug Check ---");
    requiredElements.forEach(item => {
        if (!item.element) {
            console.error(`❌ MISSING ELEMENT: Could not find ${item.name} (Selector: "${item.id}")`);
            allElementsFound = false;
        } else {
            console.log(`✅ FOUND: ${item.name}`);
        }
    });

    if (!allElementsFound) {
        console.error("Critical UI elements are missing. The script will not function correctly.");
        return; // Stop execution if elements are missing to prevent 'null' property errors
    }

    // --- Rest of your existing logic starts here ---
    let linkCount = 0;

    const isValidLink = (link) => {
        return link && (link.startsWith('http://') || link.startsWith('https://')) && link.length > 10;
    };

    // --- Helper: Toggle Column Visibility ---
    const updateQueueVisibility = () => {
        const rightColumn = document.getElementById('right-column');
        const leftColumn = document.getElementById('left-column');
        
        if (queueList.children.length > 0) {
            rightColumn.style.display = 'block';
            // Use full width on small screens so dropping a link doesn't shrink the main column
            if (window.innerWidth <= 600) {
                leftColumn.style.width = '100%';
            } else {
                leftColumn.style.width = '70%'; // Restore layout split on larger screens
            }
        } else {
            rightColumn.style.display = 'none';
            leftColumn.style.width = '100%'; // Make left column full width if queue is empty
        }
    };

    const addLinkToQueueUI = (url) => {
        const card = document.createElement('div');
        card.className = 'queue-card';
        // Shorter preview for queue cards to keep compact on mobile
        const shortUrl = url.length > 30 ? url.substring(0, 27) + '...' : url;

        const safeId = `queue-${shortUrl.replace(/[^a-zA-Z0-9]/g,'-')}`;
        card.dataset.url = url;
        card.id = safeId;
        card.innerHTML = `
            <span class="queue-url" title="${url}">${shortUrl}</span>
            <button class="delete-btn">DEL</button>
        `;

        card.querySelector('.delete-btn').addEventListener('click', () => {
            card.remove();
            if (window.linkAPI && window.linkAPI.removeLink) {
                window.linkAPI.removeLink(url);
            }
            updateQueueVisibility();
            logTextarea.value += `\n[-] Removed from queue: ${url}`;
        });

        queueList.appendChild(card);
        updateQueueVisibility();
    };

    // Track processing order heuristically (first-in processing mapping)
    const processingOrder = [];

    const updateCardStatus = (url, status) => {
        // try to find exact match by data-url
        const card = Array.from(queueList.children).find(c => c.dataset && c.dataset.url === url);
        if (card) {
            const id = card.id || '';
            const statusEl = document.getElementById(`status-${id}`);
            if (statusEl) statusEl.innerText = status;
            // color coding
            if (status === 'processing') statusEl.style.color = '#1e90ff';
            else if (status === 'queued') statusEl.style.color = '#888';
            else if (status === 'completed') statusEl.style.color = 'green';
            else if (status === 'skipped') statusEl.style.color = 'orange';
            else if (status === 'error') statusEl.style.color = 'red';
            return true;
        }
        return false;
    };

    // Download Button Handler
    downloadButton.addEventListener('click', () => {
        window.linkAPI.startDownload();
        downloadButton.textContent = 'Processing Batch...';
        downloadButton.disabled = true;
        setTimeout(() => {
            downloadButton.textContent = 'Download All Tracks';
            downloadButton.disabled = false;
        }, 3000);
    });

    // Input/Drop Logic
    inputElement.addEventListener('input', () => {
        const link = inputElement.value.trim();
        if (isValidLink(link)) {
            addLinkToQueueUI(link);
            window.linkAPI.sendLink(link);
            inputElement.value = '';
        }
    });
    // --- 2. Input/Drop Logic ---
    if (inputElement && logTextarea && queueList) {
        
        // Manual Input / Paste
        inputElement.addEventListener('input', () => {
            const link = inputElement.value.trim();
            if (isValidLink(link)) {
                addLinkToQueueUI(link);
                window.linkAPI.sendLink(link);
                inputElement.value = '';
            }
        });

        // 1. Allow the drop by preventing default browser behavior on the window
    window.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
    });

    // 2. The main Drop handler using your Tidal/Apple/Text logic
    window.addEventListener('drop', (event) => {
        event.preventDefault();
        event.stopPropagation();

        // Standard way to get dropped text/links
        const droppedText = event.dataTransfer.getData('text/plain') || 
                            event.dataTransfer.getData('text/uri-list');
        
        if (!droppedText) return;

        let links = [];

        // Case A: Tidal App Link (Matching your specific Regex)
        if (droppedText.includes('tidal.com')) {
            const tidalMatch = droppedText.match(/https?:\/\/tidal\.com\/(?:browse\/)?(?:track|album|playlist)\/\d+/);
            if (tidalMatch) links.push(tidalMatch[0]);
        } 
        // Case B: Apple Music JSON (Parsing your items object)
        else {
            try {
                const parsedData = JSON.parse(droppedText);
                if (parsedData.items) {
                    links = parsedData.items.map(item => item.url).filter(Boolean);
                }
            } catch (e) {
                // Case C: Raw Text / Multiple Browser Links
                links = droppedText.split('\n').map(l => l.trim()).filter(l => l.length > 10);
            }
        }

        // Process discovered links using your existing UI and API functions
        links.forEach(link => {
            if (isValidLink(link)) {
                addLinkToQueueUI(link);      // Keeps your UI row creation
                window.linkAPI.sendLink(link); // Tells Main process to start
            }
        });

        // Optional: Clear the input box if the drop happened while text was in it
        if (inputElement) inputElement.value = '';
    });

        // --- 3. Listen for Metadata/Main Process Updates ---
        window.linkAPI.onLogUpdate((msg) => {
            linkCount++;
            logTextarea.value += `\n[${new Date().toLocaleTimeString()}] ${msg}`;
            logTextarea.scrollTop = logTextarea.scrollHeight;

            // Parse certain messages to update per-item status labels
            try {
                // STARTING PIPELINE + URL
                if (msg.includes('STARTING PIPELINE') && msg.includes('URL:')) {
                    const urlMatch = msg.match(/URL:\s*(\S+)/);
                    if (urlMatch) {
                        const url = urlMatch[1].trim();
                        processingOrder.push(url);
                        updateCardStatus(url, 'processing');
                    }
                }

                // Steps like [1/7] Manifest: ... or [2/7] 🏷️  Metadata: ...
                const stepMatch = msg.match(/^\[(\d+\/\d+)\]\s+[^:]+:\s*(.*)$/m);
                if (stepMatch) {
                    // Pick the most recently started processing item as target
                    const currentUrl = processingOrder.length ? processingOrder[processingOrder.length - 1] : null;
                    if (currentUrl) updateCardStatus(currentUrl, `processing (${stepMatch[1]})`);
                }

                // SUCCESS lines — mark earliest processing as completed
                if (msg.includes('✅ SUCCESS')) {
                    // Find matching url from processingOrder (prefer exact contained name)
                    let completedUrl = null;
                    if (processingOrder.length) completedUrl = processingOrder.shift();
                    if (completedUrl) updateCardStatus(completedUrl, 'completed');
                }

                // SKIPPED or ERROR
                if (msg.includes('SKIPPING') || msg.includes('skipped')) {
                    const currentUrl = processingOrder.length ? processingOrder.shift() : null;
                    if (currentUrl) updateCardStatus(currentUrl, 'skipped');
                }

                if (msg.includes('❌ ERROR') || msg.toLowerCase().includes('error')) {
                    const currentUrl = processingOrder.length ? processingOrder.shift() : null;
                    if (currentUrl) updateCardStatus(currentUrl, 'error');
                }
            } catch (e) {
                console.warn('Log parsing error:', e);
            }
        });

        // Listen for app reset completion and clear UI state
        if (window.systemAPI && window.systemAPI.onAppReset) {
            window.systemAPI.onAppReset((data) => {
                try {
                    // Clear queue UI
                    while (queueList.firstChild) queueList.removeChild(queueList.firstChild);
                    // Clear logs and progress
                    logTextarea.value = '';
                    fileProgressBar.value = 0;
                    batchProgressBar.value = 0;
                    fileProgressLabel.innerText = 'Progress: 0%';
                    batchProgressLabel.innerText = 'Batch: 0 / 0';
                    updateQueueVisibility();
                    // Notify user in the log area
                    logTextarea.value += `\n[${new Date().toLocaleTimeString()}] App reset completed.`;
                } catch (e) {
                    console.warn('Error applying UI reset:', e);
                }
            });

            // --- Settings / Concurrency UI ---
            const burgerBtn = document.getElementById('burger-btn');
            const settingsMenu = document.getElementById('settings-menu');
            const concurrencyInput = document.getElementById('concurrency-input');
            const concurrencyInfo = document.getElementById('concurrency-info');
            const setMinBtn = document.getElementById('set-min-btn');
            const setDefaultBtn = document.getElementById('set-default-btn');
            const setMaxBtn = document.getElementById('set-max-btn');
            const saveSettingsBtn = document.getElementById('save-settings-btn');

            const closeSettings = () => { settingsMenu.classList.add('hidden'); };
            const openSettings = () => { settingsMenu.classList.remove('hidden'); };

            if (burgerBtn && settingsMenu) {
                burgerBtn.addEventListener('click', async () => {
                    if (settingsMenu.classList.contains('hidden')) {
                        // populate values before showing
                        try {
                            const info = await window.electronAPI.getConcurrencyInfo();
                            const cfg = await window.electronAPI.getConfig();

                            const min = info.min || 1;
                            const max = info.max || (info.cpuCount || 2);
                            const rec = info.recommended || info.default;

                            const current = (cfg && (cfg.concurrency || cfg.maxConcurrency || cfg.downloadConcurrency)) || info.userVal || rec || info.default;

                            concurrencyInput.min = String(min);
                            concurrencyInput.max = String(max);
                            concurrencyInput.value = String(Math.max(min, Math.min(max, current)));

                            concurrencyInfo.innerText = `Min: ${min} — Max: ${max}. Recommended: ${rec}. We choose these based on number of CPU cores (${info.cpuCount}) and available RAM (${info.totalMemGB}GB).`;
                        } catch (e) {
                            concurrencyInfo.innerText = 'Could not retrieve system info.';
                        }
                        // populate other config fields (network, tidal, openai)
                        try {
                            const cfg = await window.electronAPI.getConfig();
                            document.getElementById('ip-input').value = cfg.ip || '';
                            document.getElementById('port-input').value = cfg.port || '';
                            const tidal = cfg.tidal_credentials || {};
                            document.getElementById('tidal-enabled').checked = Boolean(tidal.enabled);
                            document.getElementById('tidal-client-id').value = tidal.client_id || '';
                            document.getElementById('tidal-client-secret').value = tidal.client_secret || '';
                            const oa = cfg.openai_credentials || {};
                            document.getElementById('openai-key').value = oa.api_key || '';
                            document.getElementById('openai-org').value = oa.organization || '';
                            document.getElementById('openai-project').value = oa.project_id || '';
                        } catch (e) {
                            console.warn('Failed populating extra config fields', e);
                        }
                        openSettings();
                    } else {
                        closeSettings();
                    }
                });
            }

            // Reveal toggles for secrets
            const tidalToggle = document.getElementById('tidal-secret-toggle');
            const tidalSecret = document.getElementById('tidal-client-secret');
            const openaiToggle = document.getElementById('openai-key-toggle');
            const openaiKey = document.getElementById('openai-key');

            if (tidalToggle && tidalSecret) {
                // Use inline icon button inside the input — toggle with eye icons
                tidalToggle.addEventListener('click', () => {
                    const isPassword = tidalSecret.type === 'password';
                    tidalSecret.type = isPassword ? 'text' : 'password';
                    tidalToggle.innerText = isPassword ? '🙈' : '👁';
                    tidalToggle.setAttribute('aria-label', isPassword ? 'Hide tidal secret' : 'Show tidal secret');
                });
            }

            if (openaiToggle && openaiKey) {
                openaiToggle.addEventListener('click', () => {
                    const isPassword = openaiKey.type === 'password';
                    openaiKey.type = isPassword ? 'text' : 'password';
                    openaiToggle.innerText = isPassword ? '🙈' : '👁';
                    openaiToggle.setAttribute('aria-label', isPassword ? 'Hide API key' : 'Show API key');
                });
            }

            if (setMinBtn) setMinBtn.addEventListener('click', async () => {
                const info = await window.electronAPI.getConcurrencyInfo();
                concurrencyInput.value = String(info.min || 1);
            });
            if (setDefaultBtn) setDefaultBtn.addEventListener('click', async () => {
                const info = await window.electronAPI.getConcurrencyInfo();
                concurrencyInput.value = String(info.recommended || info.default || 4);
            });
            if (setMaxBtn) setMaxBtn.addEventListener('click', async () => {
                const info = await window.electronAPI.getConcurrencyInfo();
                concurrencyInput.value = String(info.max || info.cpuCount || 4);
            });

            // Clear queue button (clear UI and storage) - set up on page load, not inside settings
            const clearQueueBtn = document.getElementById('clear-queue-btn');
            if (clearQueueBtn) {
                clearQueueBtn.addEventListener('click', () => {
                    console.log('[DEBUG] Clear All button clicked');
                    const ok = confirm('Clear all queued links and remove stored manifests?');
                    if (!ok) return;

                    // Clear UI immediately
                    while (queueList.firstChild) queueList.removeChild(queueList.firstChild);
                    updateQueueVisibility();
                    logTextarea.value += `\n[USER] Cleared queue and requested storage reset.`;
                    console.log('[DEBUG] All links removed from UI.');

                    // Ask main to clear in-memory queue and delete manifests
                    if (window.linkAPI && window.linkAPI.clearQueue) {
                        console.log('[DEBUG] Calling window.linkAPI.clearQueue()');
                        window.linkAPI.clearQueue();
                    } else if (window.linkAPI && window.linkAPI.resetApp) {
                        // Fallback: older API
                        console.log('[DEBUG] Calling window.linkAPI.resetApp()');
                        window.linkAPI.resetApp();
                    } else if (window.systemAPI && window.systemAPI.resetApp) {
                        console.log('[DEBUG] Calling window.systemAPI.resetApp()');
                        window.systemAPI.resetApp();
                    }

                    // Listen for confirmation from main
                    ipcRenderer.once('clear-queue-done', (data) => {
                        console.log('[DEBUG] clear-queue-done received:', data);
                        if (data.success) {
                            logTextarea.value += `\n[MAIN] Queue cleared successfully.`;
                        } else {
                            logTextarea.value += `\n[MAIN] Error clearing queue: ${data.error || 'unknown'}`;
                        }
                    });
                });
            }

            if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', async () => {
                try {
                    const newVal = Number(concurrencyInput.value) || 1;
                    // Validate IP and Port before writing
                    const settingsError = document.getElementById('settings-error');
                    settingsError.style.display = 'none';
                    settingsError.innerText = '';

                    const ipStr = (document.getElementById('ip-input').value || '').trim();
                    const portStr = (document.getElementById('port-input').value || '').trim();

                    // Simple IPv4 validation (allows empty to keep current)
                    const ipv4Regex = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
                    if (ipStr && !ipv4Regex.test(ipStr) && ipStr !== 'localhost') {
                        settingsError.style.display = 'block';
                        settingsError.innerText = 'Invalid IP address. Use IPv4 (e.g. 192.168.0.10) or "localhost".';
                        return;
                    }

                    if (portStr) {
                        const portValCheck = Number(portStr);
                        if (Number.isNaN(portValCheck) || portValCheck < 1 || portValCheck > 65535) {
                            settingsError.style.display = 'block';
                            settingsError.innerText = 'Invalid port. Enter a number between 1 and 65535.';
                            return;
                        }
                    }
                    const cfg = await window.electronAPI.getConfig() || {};
                    // write into `concurrency` key (Simultaneous downloads)
                    cfg.concurrency = Math.max(Number(concurrencyInput.min || 1), Math.min(Number(concurrencyInput.max || newVal), newVal));

                    // Update network
                    cfg.ip = document.getElementById('ip-input').value || cfg.ip;
                    const portVal = Number(document.getElementById('port-input').value);
                    if (!Number.isNaN(portVal) && portVal > 0) cfg.port = portVal;

                    // Update Tidal creds
                    cfg.tidal_credentials = cfg.tidal_credentials || {};
                    cfg.tidal_credentials.enabled = document.getElementById('tidal-enabled').checked;
                    cfg.tidal_credentials.client_id = document.getElementById('tidal-client-id').value || cfg.tidal_credentials.client_id;
                    cfg.tidal_credentials.client_secret = document.getElementById('tidal-client-secret').value || cfg.tidal_credentials.client_secret;

                    // Update OpenAI creds
                    cfg.openai_credentials = cfg.openai_credentials || {};
                    cfg.openai_credentials.api_key = document.getElementById('openai-key').value || cfg.openai_credentials.api_key;
                    cfg.openai_credentials.organization = document.getElementById('openai-org').value || cfg.openai_credentials.organization;
                    cfg.openai_credentials.project_id = document.getElementById('openai-project').value || cfg.openai_credentials.project_id;

                    window.electronAPI.saveConfig(cfg);
                    // Listen for reply once
                    const unsub = window.electronAPI.onSaveConfigReply((reply) => {
                        if (reply && reply.success) {
                            logTextarea.value += `\n[${new Date().toLocaleTimeString()}] Settings saved. Simultaneous downloads set to ${cfg.concurrency}.`;
                            closeSettings();
                        } else {
                            logTextarea.value += `\n[${new Date().toLocaleTimeString()}] Failed to save settings: ${reply?.message || 'unknown'}`;
                        }
                        if (unsub) unsub();
                    });
                } catch (e) {
                    console.error('Failed saving settings', e);
                }
            });
        }

    } else {
        console.error("Critical UI elements missing. Ensure index.html has #youtube-video-input, #application-log-textarea, and #link-queue-list");
    }
});

window.linkAPI.onDownloadStatus((data) => {
    console.log("Status Update Received:", data);

    // Find the UI element for this specific track (e.g., by ID)
    const statusElement = document.getElementById(`status-${data.id}`);
    const rowElement = document.getElementById(`row-${data.id}`);

    if (statusElement) {
        statusElement.innerText = data.status.toUpperCase();
        
        // Change colors based on status
        if (data.status === 'skipped') {
            statusElement.style.color = 'orange';
            rowElement.style.opacity = '0.5'; // Dim the row
        } else if (data.status === 'error') {
            statusElement.style.color = 'red';
        }
    }
});