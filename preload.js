const { contextBridge, ipcRenderer } = require('electron');
const { shell } = require('electron'); // Added shell import for completeness

// Expose ipcRenderer for IPC communication
contextBridge.exposeInMainWorld('ipcRenderer', {
    send: (channel, data) => ipcRenderer.send(channel, data),
    on: (channel, callback) => ipcRenderer.on(channel, (event, ...args) => callback(...args)),
    once: (channel, callback) => ipcRenderer.once(channel, (event, ...args) => callback(...args)),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

contextBridge.exposeInMainWorld('linkAPI', {
    sendLink: (linkUrl) => ipcRenderer.send('link-input:send', linkUrl),
    resetApp: () => ipcRenderer.send('app:reset'),
    clearQueue: () => ipcRenderer.send('clear-queue'),
    onLogUpdate: (callback) => ipcRenderer.on('log-update', (event, linkUrl) => callback(linkUrl)),
    startDownload: () => ipcRenderer.send('download:start'),
    exportCookies: (service) => ipcRenderer.send('export-cookies', service),
    removeLink: (url) => ipcRenderer.send('delete-video-url', url),
    onProgressUpdate: (callback) => ipcRenderer.on('progress-update', (event, data) => callback(data))
});

// Reset acknowledgement
contextBridge.exposeInMainWorld('systemAPI', {
    onAppReset: (callback) => ipcRenderer.on('app:reset-done', (event, data) => callback(data)),
    resetApp: () => ipcRenderer.send('app:reset')
});

/**
 * Sends a message using a whitelisted channel.
 * @param {string} channel - The IPC channel name.
 * @param {any} data - Data payload.
 */
const sendIpc = (channel, data) => {
    // Whitelist channels for main app and setup
    const validSendChannels = ['save-config', 'run-process-link']; 
    if (validSendChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
    }
};

/**
 * Sets up a listener for messages using a whitelisted channel.
 * @param {string} channel - The IPC channel name.
 * @param {function} func - The callback function to execute.
 * @returns {function} An unsubscribe function.
 */
const receiveIpc = (channel, func) => {
    // Whitelist channels for main app and setup
    const validReceiveChannels = ['save-config-reply', 'process-link-result']; 
    if (validReceiveChannels.includes(channel)) {
        // Create subscription wrapper
        const subscription = (event, ...args) => func(...args);
        
        // CRITICAL FIX: Ensure only one listener is active for replies/results
        ipcRenderer.removeAllListeners(channel);
        ipcRenderer.on(channel, subscription);
        
        // Return an unsubscribe function
        return () => ipcRenderer.removeListener(channel, subscription);
    }
    // Return a dummy function if the channel is invalid
    return () => {}; 
};


/**
 * Exposes a secure API (electronAPI) to the renderer process.
 */
contextBridge.exposeInMainWorld('electronAPI', {
    
    // --- 1. Invoke (Two-Way Communication: Renderer -> Main -> Renderer) ---
    
    // Specific Invoke wrappers
    openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
    getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    getConcurrencyInfo: () => ipcRenderer.invoke('get-concurrency-info'),
    getBrowseUrl: (rawLink) => ipcRenderer.invoke('get-browse-url', rawLink),
    onDownloadStatus: (callback) => ipcRenderer.on('download-status', (event, value) => callback(value)),
    removeDownloadListeners: () => ipcRenderer.removeAllListeners('download-status'),
    
    // FIX: Add the missing function for getting the safe download path
    getDownloadPath: () => ipcRenderer.invoke('get-download-path'), 
    
    // --- 2. Send (One-Way Communication: Renderer -> Main) ---
    
    // Specific Send wrappers (Now using the safe local helper `sendIpc`)
    saveConfig: (config) => {
        sendIpc('save-config', config);
    },
    runProcessLink: (data) => {
        // The main process expects an object with { url, service, media }
        sendIpc('run-process-link', data);
    },
    
    // --- 3. Receive (One-Way Communication: Main -> Renderer) ---
    
    // Specific Receive wrappers (Now using the safe local helper `receiveIpc`)
    
    onProcessLinkResult: (callback) => {
        // Returns the unsubscribe function
        return receiveIpc('process-link-result', callback);
    },
    
    onSaveConfigReply: (callback) => {
        // Returns the unsubscribe function
        return receiveIpc('save-config-reply', callback);
    },

    // Open dependency setup window
    openDependencySetup: () => ipcRenderer.send('open-dependency-setup')
});

console.log('Preload script loaded with electronAPI');