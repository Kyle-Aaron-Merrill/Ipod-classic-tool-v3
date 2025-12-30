/**
 * Cross-platform utility functions for command execution
 * Handles platform-specific command resolution on Windows, macOS, and Linux
 */

import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

const PLATFORM = process.platform;
const IS_WINDOWS = PLATFORM === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

/**
 * Get the appropriate Python command for the current platform
 * Tries: python3 (preferred) -> python (fallback) -> python.exe (Windows)
 * @returns {string} The python command to use
 */
export function getPythonCommand() {
    // Try python3 first (Linux/Mac standard, works on Windows if installed)
    try {
        if (IS_WINDOWS) {
            execSync('python --version', { stdio: 'pipe' });
            return 'python';
        } else {
            execSync('python3 --version', { stdio: 'pipe' });
            return 'python3';
        }
    } catch {
        // Fallback to python if python3 doesn't exist
        try {
            execSync('python --version', { stdio: 'pipe' });
            return 'python';
        } catch {
            // Last resort for Windows
            if (IS_WINDOWS) {
                return 'python.exe';
            }
            throw new Error('Python not found. Please install Python 3 and add it to PATH.');
        }
    }
}

/**
 * Properly escapes and quotes a file path for shell commands
 * Handles spaces and special characters on all platforms
 * @param {string} filePath - The file path to escape
 * @returns {string} The escaped path
 */
export function escapePath(filePath) {
    // Normalize backslashes to forward slashes for consistency
    const normalized = filePath.replace(/\\/g, '/');
    
    if (IS_WINDOWS) {
        // Windows: wrap in double quotes and escape any internal quotes
        return `"${normalized.replace(/"/g, '\\"')}"`;
    } else {
        // Unix-like: wrap in single quotes for maximum safety
        return `'${normalized.replace(/'/g, "'\\''")}'`;
    }
}

/**
 * Escapes arguments for shell execution
 * @param {string} arg - The argument to escape
 * @returns {string} The escaped argument
 */
export function escapeArg(arg) {
    if (!arg) return '""';
    
    if (IS_WINDOWS) {
        return `"${arg.replace(/"/g, '\\"')}"`;
    } else {
        return `'${arg.replace(/'/g, "'\\''")}'`;
    }
}

/**
 * Get platform information for logging/debugging
 * @returns {object} Platform info object
 */
export function getPlatformInfo() {
    return {
        platform: PLATFORM,
        isWindows: IS_WINDOWS,
        isMac: IS_MAC,
        isLinux: IS_LINUX,
        arch: process.arch,
        nodeVersion: process.version
    };
}

/**
 * Check if a command exists on the system
 * @param {string} command - The command to check
 * @returns {boolean} True if command exists
 */
export function commandExists(command) {
    try {
        const checkCmd = IS_WINDOWS ? `where ${command}` : `which ${command}`;
        execSync(checkCmd, { stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

console.log(`[PlatformUtils] Running on ${PLATFORM} (${process.arch})`);
