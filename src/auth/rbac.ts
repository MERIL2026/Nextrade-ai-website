import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from './db';
import type { AuthService, PublicAuthUser, PublicSessionInfo } from './service';
import { extractSessionToken } from './router';
import {
  ADMIN_ROLES,
  PERMISSIONS,
  ROLES,
  ROLE_CATALOG,
  ROLE_PERMISSION_MATRIX,
  type Permission,
  type RoleCatalogEntry,
  hasAllPermissions,
  hasPermission,
  hasRole,
  isAdminRole,
  isValidUserRole,
  normalizeUserRole,
  resolveUserPermissions,
} from './rbacShared';

export {
  ADMIN_ROLES,
  PERMISSIONS,
  ROLES,
  ROLE_CATALOG,
  ROLE_PERMISSION_MATRIX,
  hasAllPermissions,
  hasPermission,
  hasRole,
  isAdminRole,
  isValidUserRole,
  normalizeUserRole,
  resolveUserPermissions,
};
export type { Permission, RoleCatalogEntry };

export interface RbacAuthenticatedRequest extends Request {
  auth?: {
    user: PublicAuthUser;
    session: PublicSessionInfo;
    rawToken: string;
    role: UserRole;
    permissions: Permission[];
  };
}

export function requireAuthenticatedUser(authService: AuthService) {
  return async (req: RbacAuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rawToken = extractSessionToken(req);
      const verified = rawToken ? await authService.authenticateSessionToken(rawToken) : null;
      if (!verified || !rawToken) {
        res.status(401).json({
          error: 'Authentication required. Please sign in to continue.',
          code: 'UNAUTHENTICATED',
        });
        return;
      }
      const role = normalizeUserRole(verified.user.role);
      req.auth = {
        user: { ...verified.user, role },
        session: verified.session,
        rawToken,
        role,
        permissions: resolveUserPermissions(role),
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAdminAccess() {
  return (req: RbacAuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required. Please sign in to continue.',
        code: 'UNAUTHENTICATED',
      });
      return;
    }

    const userRole = normalizeUserRole(req.auth.user.role);
    if (!isAdminRole(userRole) || !hasPermission(userRole, PERMISSIONS.ADMIN_CONSOLE_READ)) {
      res.status(403).json({
        error: 'Administrator privileges are required to access this control centre.',
        code: 'FORBIDDEN_ADMIN_ACCESS',
      });
      return;
    }

    next();
  };
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: RbacAuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required. Please sign in to continue.',
        code: 'UNAUTHENTICATED',
      });
      return;
    }

    const userRole = normalizeUserRole(req.auth.user.role);
    if (!hasRole(userRole, allowedRoles)) {
      res.status(403).json({
        error: 'You do not have the required role to perform this action.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: Permission[]) {
  return (req: RbacAuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.auth) {
      res.status(401).json({
        error: 'Authentication required. Please sign in to continue.',
        code: 'UNAUTHENTICATED',
      });
      return;
    }

    const userRole = normalizeUserRole(req.auth.user.role);
    if (!hasAllPermissions(userRole, requiredPermissions)) {
      res.status(403).json({
        error: 'You do not have sufficient permissions to access this resource.',
        code: 'FORBIDDEN_PERMISSION',
      });
      return;
    }

    next();
  };
}
