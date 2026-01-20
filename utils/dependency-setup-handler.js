import { ipcMain } from 'electron';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.dirname(__dirname);
const SETUP_BAT_PATH = path.join(PROJECT_ROOT, 'setup.bat');

export function setupDependencyHandlers(window) {
    // Check if dependencies are installed
    ipcMain.on('check-dependencies', (event) => {
        console.log('[Dependency Check] Checking for installed tools...');
        
        const checkCommand = (cmd, name) => {
            try {
                // Try multiple methods to check for command availability
                let result;
                if (process.platform === 'win32') {
                    // On Windows, try 'where' first, then use shell check
                    try {
                        result = execSync(`where ${cmd}`, { stdio: 'pipe', shell: true, timeout: 5000 }).toString().trim();
                    } catch (e1) {
                        // Fallback: try to get version directly
                        result = execSync(`${cmd} --version`, { stdio: 'pipe', shell: true, timeout: 5000 }).toString().trim();
                    }
                } else {
                    result = execSync(`which ${cmd}`, { stdio: 'pipe', timeout: 5000 }).toString().trim();
                }
                
                console.log(`[Dependency Check] ✓ ${name} found at: ${result.split('\n')[0]}`);
                event.reply('setup-status', cmd, 'success', 'Installed');
                return true;
            } catch (e) {
                console.log(`[Dependency Check] ✗ ${name} not found: ${e.message}`);
                event.reply('setup-status', cmd, 'error', 'Not found');
                return false;
            }
        };

        checkCommand('node', 'Node.js');
        checkCommand('npm', 'npm');
        checkCommand('python', 'Python');
    });

    // Run setup.bat
    ipcMain.on('run-setup-bat', (event) => {
        console.log(`[Setup] Starting setup process...`);
        console.log(`[Setup] SETUP_BAT_PATH: ${SETUP_BAT_PATH}`);
        console.log(`[Setup] setup.bat exists: ${fs.existsSync(SETUP_BAT_PATH)}`);
        
        // Copy setup.bat to temp location if it's in asar (packaged app)
        let executableBatPath = SETUP_BAT_PATH;
        if (SETUP_BAT_PATH.includes('.asar')) {
            const tempBat = path.join(os.tmpdir(), 'ipod-setup.bat');
            console.log(`[Setup] Copying setup.bat from asar to: ${tempBat}`);
            fs.copyFileSync(SETUP_BAT_PATH, tempBat);
            executableBatPath = tempBat;
        }
        
        if (!fs.existsSync(executableBatPath)) {
            const errorMsg = `setup.bat not found at ${executableBatPath}`;
            console.error(`[Setup Error] ${errorMsg}`);
            event.reply('setup-output', `❌ ERROR: ${errorMsg}`, 'error');
            event.reply('setup-complete', false, errorMsg);
            return;
        }

        event.reply('setup-output', `▶️  Running setup script...`, 'info');
        event.reply('setup-output', `📍 Location: ${executableBatPath}`, 'info');
        event.reply('setup-output', `🔧 Starting installation process...`, 'info');
        event.reply('setup-output', '', 'info');

        try {
            // For packaged apps, we need shell: true and a real CWD (not asar path)
            const tempDir = os.tmpdir();
            console.log(`[Setup] About to spawn setup.bat: ${executableBatPath}`);
            console.log(`[Setup] CWD: ${tempDir}`);
            console.log(`[Setup] PROJECT_ROOT: ${PROJECT_ROOT}`);
            
            const setupProcess = spawn(executableBatPath, [PROJECT_ROOT], {
                shell: true,
                cwd: tempDir,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: false,
                env: { ...process.env, PATH: process.env.PATH }
            });
            
            console.log(`[Setup] Process spawned with PID: ${setupProcess.pid}`);
            
            if (!setupProcess.pid) {
                throw new Error('Failed to spawn process - no PID');
            }

            let totalLines = 0;
            let lastLineTime = Date.now();
            let stdoutReceived = false;
            let stderrReceived = false;

            // Helper to send output - ALWAYS send, even if empty
            function sendOutput(text, type) {
                // Don't filter - send everything
                console.log(`[sendOutput] BEFORE SEND - text type: ${typeof text}, length: ${text ? text.length : 0}, value: "${text ? text.substring(0, 100).replace(/\n/g, '\\n') : 'UNDEFINED_OR_NULL'}"`);
                
                try {
                    console.log(`[sendOutput] Event object: ${event ? 'valid' : 'INVALID'}`);
                    console.log(`[sendOutput] Event.reply: ${event.reply ? 'exists' : 'MISSING'}`);
                    console.log(`[sendOutput] About to call event.reply('setup-output', '${text ? text.substring(0, 50) : ''}...', '${type}')`);
                    
                    const result = event.reply('setup-output', text, type);
                    
                    console.log(`[sendOutput] AFTER SEND - reply returned:`, result, `type sent: ${type}`);
                } catch (err) {
                    console.error(`[sendOutput] ERROR during reply:`, err.message);
                    console.error(`[sendOutput] Stack:`, err.stack);
                }
                
                lastLineTime = Date.now();
            }

            setupProcess.stdout.on('data', (data) => {
                stdoutReceived = true;
                const rawText = data.toString();
                console.log(`[Setup STDOUT] *** DATA RECEIVED *** (${data.length} bytes):`, rawText.substring(0, 300));
                
                // Send ALL output, even empty lines
                totalLines++;
                console.log(`[Setup STDOUT] Sending chunk ${totalLines} via IPC...`);
                sendOutput(rawText, 'info');
            });

            setupProcess.stderr.on('data', (data) => {
                stderrReceived = true;
                const rawText = data.toString();
                console.log(`[Setup STDERR] *** DATA RECEIVED *** (${data.length} bytes):`, rawText.substring(0, 300));
                
                // Send ALL stderr output
                totalLines++;
                console.log(`[Setup STDERR] Sending chunk ${totalLines} via IPC...`);
                sendOutput(rawText, 'error');
            });

            setupProcess.on('error', (err) => {
                console.error(`[Setup] Spawn error:`, err);
                event.reply('setup-output', `❌ Failed to start setup: ${err.message}`, 'error');
                event.reply('setup-complete', false, `Failed to start setup: ${err.message}`);
            });

            setupProcess.on('close', (code) => {
                console.log(`[Setup] Process exited with code: ${code}`);
                console.log(`[Setup] Total lines of output received: ${totalLines}`);
                console.log(`[Setup] stdout received: ${stdoutReceived}, stderr received: ${stderrReceived}`);
                
                if (!stdoutReceived && !stderrReceived) {
                    console.warn(`[Setup] WARNING: No output received from process!`);
                    event.reply('setup-output', '[WARNING] No output captured from setup process', 'warning');
                }
                
                event.reply('setup-output', '', 'info');
                event.reply('setup-output', '', 'info');
                
                if (code === 0) {
                    event.reply('setup-output', '========== ✅ SETUP COMPLETE ==========', 'success');
                    event.reply('setup-output', '✅ All dependencies installed successfully!', 'success');
                    event.reply('setup-output', '', 'info');
                    
                    // Mark setup as completed in config
                    try {
                        const configPath = path.join(os.homedir(), '.ipod-classic-tool', 'config.json');
                        const configDir = path.dirname(configPath);
                        if (!fs.existsSync(configDir)) {
                            fs.mkdirSync(configDir, { recursive: true });
                        }
                        let config = {};
                        if (fs.existsSync(configPath)) {
                            config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
                        }
                        config.setupCompleted = true;
                        config.setupCompletedAt = new Date().toISOString();
                        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
                        console.log('[Setup] Marked setup as completed in config');
                    } catch (configErr) {
                        console.warn('[Setup] Could not save setup completion flag:', configErr.message);
                    }
                    
                    // Update status badges for UI
                    console.log('[Setup] Updating status badges...');
                    event.reply('setup-status', 'node', 'success', 'Installed');
                    event.reply('setup-status', 'npm', 'success', 'Installed');
                    event.reply('setup-status', 'python', 'success', 'Installed');
                    
                    // Final verification
                    setTimeout(() => {
                        try {
                            console.log('[Setup] Verifying installed tools...');
                            const nodeVer = execSync('node --version', { stdio: 'pipe' }).toString().trim();
                            const npmVer = execSync('npm --version', { stdio: 'pipe' }).toString().trim();
                            const pythonVer = execSync('python --version', { stdio: 'pipe' }).toString().trim();
                            
                            console.log(`[Setup] Verified: node ${nodeVer}, npm ${npmVer}, python ${pythonVer}`);
                            event.reply('setup-output', `✅ Verified: ${nodeVer}, npm ${npmVer}, ${pythonVer}`, 'success');
                            console.log('[Setup] Sending setup-complete with success=true');
                            event.reply('setup-complete', true, 'Setup completed successfully! All tools are in PATH. Click Finish to launch the app.');
                        } catch (e) {
                            console.error('[Setup] Verification error:', e.message);
                            event.reply('setup-output', `⚠️ Note: ${e.message}. You may need to restart your computer for changes to take effect.`, 'warning');
                            console.log('[Setup] Sending setup-complete with success=true (warning mode)');
                            event.reply('setup-complete', true, 'Setup appears to have completed. Click Finish to proceed. You may need to restart your computer for changes to take effect.');
                        }
                    }, 1000);
                } else {
                    event.reply('setup-output', `❌ Setup exited with error code ${code}`, 'error');
                    event.reply('setup-output', 'Please check the output above and try running setup.bat manually if needed.', 'error');
                    event.reply('setup-complete', false, `Setup failed with exit code ${code}`);
                }
            });
        } catch (err) {
            console.error(`[Setup] Catch error:`, err);
            event.reply('setup-output', `❌ Unexpected error: ${err.message}`, 'error');
            event.reply('setup-complete', false, `Error: ${err.message}`);
        }
    });

    // Close window
    ipcMain.on('close-dependency-window', () => {
        console.log('[Setup] Close window requested');
        if (window) {
            window.close();
        }
    });

    // Re-check dependencies (manual refresh)
    ipcMain.on('recheck-dependencies', (event) => {
        console.log('[Dependency Check] Manual recheck requested');
        // Trigger the same check as initial load
        event.emit('check-dependencies', event);
    });
}
