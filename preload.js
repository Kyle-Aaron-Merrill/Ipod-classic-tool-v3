const { contextBridge, ipcRenderer } = require('electron');

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
    onProgressUpdate: (callback) => ipcRenderer.on('progress-update', (event, data) => callback(data)),
    onDownloadStatus: (callback) => ipcRenderer.on('download-status', (event, value) => callback(value)),
    removeDownloadListeners: () => ipcRenderer.removeAllListeners('download-status')
});

contextBridge.exposeInMainWorld('systemAPI', {
    onAppReset: (callback) => ipcRenderer.on('app:reset-done', (event, data) => callback(data)),
    resetApp: () => ipcRenderer.send('app:reset')
});

const sendIpc = (channel, data) => {
    const validSendChannels = ['save-config', 'run-process-link'];
    if (validSendChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
    }
};

const receiveIpc = (channel, func) => {
    const validReceiveChannels = ['save-config-reply', 'process-link-result'];
    if (validReceiveChannels.includes(channel)) {
        const subscription = (event, ...args) => func(...args);
        ipcRenderer.removeAllListeners(channel);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
    }
    return () => {};
};

contextBridge.exposeInMainWorld('electronAPI', {
    openDownloadsFolder: () => ipcRenderer.invoke('open-downloads-folder'),
    getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
    getConfig: () => ipcRenderer.invoke('get-config'),
    getConcurrencyInfo: () => ipcRenderer.invoke('get-concurrency-info'),
    getBrowseUrl: (rawLink) => ipcRenderer.invoke('get-browse-url', rawLink),
    getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
    saveConfig: (config) => {
        sendIpc('save-config', config);
    },
    runProcessLink: (data) => {
        sendIpc('run-process-link', data);
    },
    onProcessLinkResult: (callback) => {
        return receiveIpc('process-link-result', callback);
    },
    onSaveConfigReply: (callback) => {
        return receiveIpc('save-config-reply', callback);
    },
    openDependencySetup: () => ipcRenderer.send('open-dependency-setup')
});

console.log('Preload script loaded with electronAPI');
