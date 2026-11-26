import type { TenantRole } from "@/models/Membership";

export const PERMISSIONS = [
  "tenant:read",
  "tenant:update",
  "tenant:manage_members",
  "property:read",
  "property:create",
  "property:update",
  "property:archive",
  "inventory:read",
  "inventory:manage",
  "inventory:housekeeping",
  "booking:read",
  "booking:create",
  "booking:update",
  "booking:cancel",
  "payment:read",
  "payment:manage",
  "payment:verify",
  "payment:refund",
  "report:read",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  tenant_owner: PERMISSIONS,
  property_manager: [
    "tenant:read",
    "property:read",
    "property:update",
    "inventory:read",
    "inventory:manage",
    "booking:read",
    "booking:create",
    "booking:update",
    "booking:cancel",
    "payment:read",
    "report:read",
  ],
  booking_manager: [
    "property:read",
    "inventory:read",
    "booking:read",
    "booking:create",
    "booking:update",
    "booking:cancel",
  ],
  payment_verifier: [
    "property:read",
    "booking:read",
    "payment:read",
    "payment:verify",
    "report:read",
  ],
  receptionist: [
    "property:read",
    "inventory:read",
    "booking:read",
    "booking:create",
    "booking:update",
  ],
  housekeeping: ["property:read", "inventory:read", "inventory:housekeeping"],
  analyst: ["tenant:read", "property:read", "report:read"],
};

export function hasPermission(
  role: TenantRole,
  permission: Permission
): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function getRolePermissions(role: TenantRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function isTenantRole(value: unknown): value is TenantRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value)
  );
}
