import { ipcMain } from 'electron';
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.dirname(__dirname);
const SETUP_BAT_PATH = path.join(PROJECT_ROOT, 'setup.bat');

export function setupDependencyHandlers(window) {
    // Check if dependencies are installed
    ipcMain.on('check-dependencies', (event) => {
        try {
            execSync('where node', { stdio: 'pipe' });
            event.reply('setup-status', 'node', 'success', 'Installed');
        } catch {
            event.reply('setup-status', 'node', 'error', 'Not found');
        }

        try {
            execSync('where npm', { stdio: 'pipe' });
            event.reply('setup-status', 'npm', 'success', 'Installed');
        } catch {
            event.reply('setup-status', 'npm', 'error', 'Not found');
        }

        try {
            execSync('where python', { stdio: 'pipe' });
            event.reply('setup-status', 'python', 'success', 'Installed');
        } catch {
            event.reply('setup-status', 'python', 'error', 'Not found');
        }
    });

    // Run setup.bat
    ipcMain.on('run-setup-bat', (event) => {
        console.log(`[Dependency Setup] Checking for setup.bat at: ${SETUP_BAT_PATH}`);
        console.log(`[Dependency Setup] setup.bat exists: ${fs.existsSync(SETUP_BAT_PATH)}`);
        
        if (!fs.existsSync(SETUP_BAT_PATH)) {
            const errorMsg = `setup.bat not found at ${SETUP_BAT_PATH}`;
            console.error(`[Dependency Setup Error] ${errorMsg}`);
            event.reply('setup-output', `❌ ERROR: ${errorMsg}`, 'error');
            event.reply('setup-complete', false, errorMsg);
            return;
        }

        event.reply('setup-output', `▶️ Running setup script...`, 'info');
        event.reply('setup-output', `📍 Location: ${SETUP_BAT_PATH}`, 'info');
        event.reply('setup-output', '', 'info');

        const setupProcess = spawn('C:\\Windows\\System32\\cmd.exe', ['/c', SETUP_BAT_PATH], {
            shell: false,
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        console.log(`[Dependency Setup] Process started with PID: ${setupProcess.pid}`);

        let nodeFound = false;
        let npmFound = false;
        let pythonFound = false;

        setupProcess.stdout.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n');

            lines.forEach(line => {
                if (line.trim()) {
                    // Parse status messages
                    if (line.includes('Node.js already installed') || line.includes('Node.js installed and added to PATH')) {
                        nodeFound = true;
                        event.reply('setup-status', 'node', 'success', line.match(/v[\d.]+/)?.[0] || 'Installed');
                    }
                    if (line.includes('npm available')) {
                        npmFound = true;
                        event.reply('setup-status', 'npm', 'success', line.match(/\d+\.\d+\.\d+/)?.[0] || 'Installed');
                    }
                    if (line.includes('Python already installed') || line.includes('Python installed and added to PATH')) {
                        pythonFound = true;
                        event.reply('setup-status', 'python', 'success', line.match(/\d+\.\d+\.\d+/)?.[0] || 'Installed');
                    }

                    // Determine message type
                    let type = 'info';
                    if (line.includes('✓') || line.includes('✅')) type = 'success';
                    else if (line.includes('ERROR') || line.includes('❌')) type = 'error';
                    else if (line.includes('⚠️') || line.includes('Warning')) type = 'warning';

                    event.reply('setup-output', line, type);
                }
            });
        });

        setupProcess.stderr.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    console.error(`[Setup stderr] ${line}`);
                    event.reply('setup-output', `⚠️ ${line}`, 'error');
                }
            });
        });

        setupProcess.on('close', (code) => {
            console.log(`[Setup Process] Closed with exit code: ${code}`);
            event.reply('setup-output', '', 'info');
            
            if (code === 0) {
                event.reply('setup-output', '========== ✅ SETUP COMPLETE ==========', 'success');
                event.reply('setup-output', '✅ All dependencies installed successfully!', 'success');
                
                // Final verification
                setTimeout(() => {
                    try {
                        console.log('[Setup] Verifying tools in PATH...');
                        execSync('node --version', { stdio: 'pipe' });
                        execSync('npm --version', { stdio: 'pipe' });
                        execSync('python --version', { stdio: 'pipe' });
                        console.log('[Setup] All tools verified successfully');
                        event.reply('setup-complete', true, 'Setup completed successfully! All tools are in PATH. You can now use the app.');
                        
                        // Auto-close the dependency window after 3 seconds and proceed with app
                        setTimeout(() => {
                            console.log('[Setup] Closing dependency window...');
                            if (window) {
                                window.close();
                            }
                            // Notify main process to initialize the app
                            ipcMain.emit('dependencies-installed');
                        }, 3000);
                    } catch (e) {
                        console.error('[Setup Verification] Failed:', e.message);
                        event.reply('setup-complete', false, 'Setup ran but some tools may not be in PATH. Please restart your computer.');
                    }
                }, 1000);
            } else {
                const errorMsg = `Setup exited with code ${code}. Check the output above for details.`;
                console.error(`[Setup Error] ${errorMsg}`);
                event.reply('setup-output', `❌ ${errorMsg}`, 'error');
                event.reply('setup-complete', false, errorMsg);
            }
        });

        setupProcess.on('error', (err) => {
            const errorMsg = `Failed to start setup: ${err.message}`;
            console.error('[Setup Error]', err);
            event.reply('setup-output', `❌ ${errorMsg}`, 'error');
            event.reply('setup-complete', false, errorMsg);
        });
    });

    // Close window
    ipcMain.on('close-dependency-window', () => {
        if (window) {
            window.close();
        }
    });
}
