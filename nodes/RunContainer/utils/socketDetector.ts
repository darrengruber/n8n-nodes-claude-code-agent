/**
 * Docker socket detection utilities
 * Auto-detects Docker socket paths across different platforms and environments
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Common Docker socket paths by platform and environment
 */
export const DOCKER_SOCKET_PATHS = {
    default: '/var/run/docker.sock',
    linux: [
        '/var/run/docker.sock',
        '/run/docker.sock',
        '/var/snap/docker/current/run/docker.sock'
    ],
    macos: [
        '/var/run/docker.sock',
        path.join(os.homedir(), '.docker/run/docker.sock'),
        path.join(os.homedir(), '.colima/default/docker.sock'),
        path.join(os.homedir(), '.colima/colima/docker.sock'),
        '/Users/docker/.docker/run/docker.sock'
    ],
    windows: [
        '//./pipe/docker_engine',
        '\\\\.\\pipe\\docker_engine'
    ]
};

/**
 * Docker socket types
 */
export enum SocketType {
    UNIX_SOCKET = 'unix',
    NAMED_PIPE = 'named_pipe'
}

/**
 * Socket detection result
 */
export interface SocketDetectionResult {
    path: string;
    type: SocketType;
    exists: boolean;
    accessible: boolean;
    source: string;
}

/**
 * Detect the best Docker socket path for the current environment
 *
 * @param preferredPath - Preferred socket path (optional)
 * @returns Best detected socket path
 */
export function detectDockerSocket(preferredPath?: string): SocketDetectionResult {
    const platform = os.platform();

    // If a preferred path is provided and it exists, use it
    if (preferredPath) {
        const result = checkSocketPath(preferredPath);
        if (result.exists && result.accessible) {
            return {
                ...result,
                source: 'preferred'
            };
        }
    }

    // Try platform-specific paths
    const platformPaths = getPlatformSocketPaths(platform);
    for (const socketPath of platformPaths) {
        const result = checkSocketPath(socketPath);
        if (result.exists && result.accessible) {
            return {
                ...result,
                source: 'platform_auto_detect'
            };
        }
    }

    // Fall back to default path even if it doesn't exist
    const defaultPath = DOCKER_SOCKET_PATHS.default;
    return {
        ...checkSocketPath(defaultPath),
        source: 'default_fallback'
    };
}

/**
 * Get platform-specific socket paths
 *
 * @param platform - Node.js platform identifier
 * @returns Array of socket paths for the platform
 */
function getPlatformSocketPaths(platform: NodeJS.Platform): string[] {
    switch (platform) {
        case 'darwin':
            return DOCKER_SOCKET_PATHS.macos;
        case 'linux':
            return DOCKER_SOCKET_PATHS.linux;
        case 'win32':
            return DOCKER_SOCKET_PATHS.windows;
        default:
            return [DOCKER_SOCKET_PATHS.default];
    }
}

/**
 * Check if a socket path exists and is accessible
 *
 * @param socketPath - Path to check
 * @returns Socket check result
 */
function checkSocketPath(socketPath: string): SocketDetectionResult {
    const isWindows = os.platform() === 'win32';

    if (isWindows) {
        return checkNamedPipe(socketPath);
    } else {
        return checkUnixSocket(socketPath);
    }
}

/**
 * Check a Unix socket path
 *
 * @param socketPath - Unix socket path
 * @returns Socket check result
 */
function checkUnixSocket(socketPath: string): SocketDetectionResult {
    try {
        const exists = fs.existsSync(socketPath);
        const accessible = exists && checkFilePermissions(socketPath);

        return {
            path: socketPath,
            type: SocketType.UNIX_SOCKET,
            exists,
            accessible,
            source: 'direct_check'
        };
    } catch (error) {
        return {
            path: socketPath,
            type: SocketType.UNIX_SOCKET,
            exists: false,
            accessible: false,
            source: 'error'
        };
    }
}

/**
 * Check a Windows named pipe
 *
 * @param pipePath - Named pipe path
 * @returns Socket check result
 */
function checkNamedPipe(pipePath: string): SocketDetectionResult {
    try {
        // For Windows named pipes, we can't easily check existence without attempting connection
        // For now, assume it might exist and let Docker client handle the actual connection
        return {
            path: pipePath,
            type: SocketType.NAMED_PIPE,
            exists: true, // Optimistic assumption
            accessible: true,
            source: 'windows_named_pipe'
        };
    } catch (error) {
        return {
            path: pipePath,
            type: SocketType.NAMED_PIPE,
            exists: false,
            accessible: false,
            source: 'error'
        };
    }
}

/**
 * Check if a file/socket has appropriate permissions
 *
 * @param filePath - File path to check
 * @returns True if accessible
 */
function checkFilePermissions(filePath: string): boolean {
    try {
        // Check if we can read the file/socket
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Get all detected Docker sockets with their status
 *
 * @returns Array of socket detection results
 */
export function getAllDockerSockets(): SocketDetectionResult[] {
    const platform = os.platform();
    const paths = getPlatformSocketPaths(platform);
    const results: SocketDetectionResult[] = [];

    for (const socketPath of paths) {
        results.push(checkSocketPath(socketPath));
    }

    // Also check default path if not already included
    if (!paths.includes(DOCKER_SOCKET_PATHS.default)) {
        results.push(checkSocketPath(DOCKER_SOCKET_PATHS.default));
    }

    return results.sort((a, b) => {
        // Sort by accessibility first, then by existence
        if (a.accessible !== b.accessible) {
            return b.accessible ? 1 : -1;
        }
        if (a.exists !== b.exists) {
            return b.exists ? 1 : -1;
        }
        return 0;
    });
}

/**
 * Get environment information for debugging socket detection
 *
 * @returns Environment information object
 */
export function getSocketEnvironmentInfo(): {
    platform: string;
    arch: string;
    homedir: string;
    detectedSockets: SocketDetectionResult[];
} {
    return {
        platform: os.platform(),
        arch: os.arch(),
        homedir: os.homedir(),
        detectedSockets: getAllDockerSockets()
    };
}