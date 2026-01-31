import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { UserPermissions, InsertUserPermissions, userPermissionsSchema } from '@shared/schema';
import { log } from './index';

const PERMISSIONS_FILE = join(process.cwd(), 'data', 'user-permissions.json');

let permissionsCache: UserPermissions[] = [];

function ensureDataDir() {
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    const { mkdirSync } = require('fs');
    mkdirSync(dataDir, { recursive: true });
  }
}

function loadPermissions(): UserPermissions[] {
  try {
    if (existsSync(PERMISSIONS_FILE)) {
      const data = readFileSync(PERMISSIONS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      permissionsCache = Array.isArray(parsed) ? parsed : [];
      log(`[permissions] Loaded ${permissionsCache.length} user permissions from file`, 'permissions');
    } else {
      permissionsCache = [];
    }
  } catch (error: any) {
    log(`[permissions] Error loading permissions: ${error.message}`, 'error');
    permissionsCache = [];
  }
  return permissionsCache;
}

function savePermissions(): void {
  try {
    ensureDataDir();
    writeFileSync(PERMISSIONS_FILE, JSON.stringify(permissionsCache, null, 2));
    log(`[permissions] Saved ${permissionsCache.length} user permissions to file`, 'permissions');
  } catch (error: any) {
    log(`[permissions] Error saving permissions: ${error.message}`, 'error');
  }
}

export function initPermissions(): void {
  loadPermissions();
}

export function getAllUserPermissions(): UserPermissions[] {
  if (permissionsCache.length === 0) {
    loadPermissions();
  }
  return permissionsCache;
}

export function getUserPermissions(userId: string): UserPermissions | undefined {
  if (permissionsCache.length === 0) {
    loadPermissions();
  }
  return permissionsCache.find(p => p.userId === userId);
}

export function getUserPermissionsByUsername(username: string): UserPermissions | undefined {
  if (permissionsCache.length === 0) {
    loadPermissions();
  }
  return permissionsCache.find(p => p.username.toLowerCase() === username.toLowerCase());
}

export function createOrUpdateUserPermissions(input: InsertUserPermissions): UserPermissions {
  if (permissionsCache.length === 0) {
    loadPermissions();
  }

  const now = new Date().toISOString();
  const existingIndex = permissionsCache.findIndex(p => p.userId === input.userId);

  const permissions: UserPermissions = {
    userId: input.userId,
    username: input.username,
    email: input.email,
    isAdmin: input.isAdmin ?? false,
    allowedPlanningAreas: input.allowedPlanningAreas ?? null,
    allowedScenarios: input.allowedScenarios ?? null,
    allowedPlants: input.allowedPlants ?? null,
    allowedTableAccess: input.allowedTableAccess ?? null,
    createdAt: existingIndex >= 0 ? permissionsCache[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    permissionsCache[existingIndex] = permissions;
    log(`[permissions] Updated permissions for user: ${input.username}`, 'permissions');
  } else {
    permissionsCache.push(permissions);
    log(`[permissions] Created permissions for user: ${input.username}`, 'permissions');
  }

  savePermissions();
  return permissions;
}

export function deleteUserPermissions(userId: string): boolean {
  if (permissionsCache.length === 0) {
    loadPermissions();
  }

  const index = permissionsCache.findIndex(p => p.userId === userId);
  if (index >= 0) {
    const removed = permissionsCache.splice(index, 1);
    savePermissions();
    log(`[permissions] Deleted permissions for user: ${removed[0].username}`, 'permissions');
    return true;
  }
  return false;
}

export function isUserAdmin(userId: string): boolean {
  const perms = getUserPermissions(userId);
  return perms?.isAdmin ?? false;
}

export function isUsernameAdmin(username: string): boolean {
  const perms = getUserPermissionsByUsername(username);
  return perms?.isAdmin ?? false;
}
