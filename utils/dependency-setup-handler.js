import { ipcMain } from 'electron';
import { spawn } from 'child_process';
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
        const { execSync } = require('child_process');
        
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
        if (!fs.existsSync(SETUP_BAT_PATH)) {
            event.reply('setup-output', `ERROR: setup.bat not found at ${SETUP_BAT_PATH}`, 'error');
            event.reply('setup-complete', false, 'setup.bat not found');
            return;
        }

        event.reply('setup-output', `Running: ${SETUP_BAT_PATH}`, 'info');
        event.reply('setup-output', '', 'info');

        const setupProcess = spawn('cmd', ['/c', SETUP_BAT_PATH], {
            shell: true,
            cwd: PROJECT_ROOT
        });

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
            output.split('\n').forEach(line => {
                if (line.trim()) {
                    event.reply('setup-output', line, 'error');
                }
            });
        });

        setupProcess.on('close', (code) => {
            event.reply('setup-output', '', 'info');
            
            if (code === 0) {
                event.reply('setup-output', '========== SETUP COMPLETE ==========', 'success');
                event.reply('setup-output', '✅ All dependencies installed successfully!', 'success');
                
                // Final verification
                setTimeout(() => {
                    try {
                        const { execSync } = require('child_process');
                        execSync('node --version', { stdio: 'pipe' });
                        execSync('npm --version', { stdio: 'pipe' });
                        execSync('python --version', { stdio: 'pipe' });
                        event.reply('setup-complete', true, 'Setup completed successfully! All tools are in PATH. You can now use the app.');
                    } catch (e) {
                        event.reply('setup-complete', false, 'Setup ran but some tools may not be in PATH. Please restart your computer.');
                    }
                }, 1000);
            } else {
                event.reply('setup-output', `⚠️ Setup exited with code ${code}`, 'error');
                event.reply('setup-complete', false, `Setup failed with exit code ${code}`);
            }
        });

        setupProcess.on('error', (err) => {
            event.reply('setup-output', `❌ Failed to start setup: ${err.message}`, 'error');
            event.reply('setup-complete', false, `Failed to start setup: ${err.message}`);
        });
    });

    // Close window
    ipcMain.on('close-dependency-window', () => {
        if (window) {
            window.close();
        }
    });
}
